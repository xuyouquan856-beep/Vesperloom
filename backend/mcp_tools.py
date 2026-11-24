"""
Shared MCP tool definitions and async dispatcher for NAI Studio.
Used identically by:
1. mcp_server.py (JSON-RPC 2.0 over stdio for Claude Desktop / Cursor / Antigravity)
2. backend/app.py (/api/mcp/info and /api/mcp/test for live Web UI console)
"""
import base64
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import ARTISTS_DIR, BASE_DIR, OUTPUTS_DIR, load_config
from .database import (
    count_gallery,
    delete_oc_card,
    init_db,
    list_artists,
    list_gallery,
    list_mix_presets,
    list_oc_cards,
    list_snippets,
    save_oc_card,
    sync_outputs_folder,
)
from .models_spec import DIRECTOR_EMOTIONS, MODELS_CATALOG, RESOLUTIONS
from .nai_client import augment_image, fetch_account_status, generate_image, suggest_tags_hybrid
from .png_metadata import extract_nai_metadata
from .prompt_engine import expand_dynamic_prompt, lint_prompt, list_wildcards

init_db()

MCP_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "nai_delegate_art_task",
        "description": "【外部 Agent 首选高阶入口】直接用自然语言将生图、改词或画师搭配需求委派给 NAI Studio 内置「美术总监 Agent」。外部 Agent 无需懂 NovelAI V5 语法或画师权重，服务端会自动读取用户审美记忆、检索本地画师库、执行语法体检并按护栏安全出图，返回结构化配方与本地 PNG 路径。多轮精修时请传回上一轮返回的 context_id。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "brief": {"type": "string", "description": "用自然语言清晰描述画面主体、场景、风格氛围或修改意见"},
                "aspect_ratio": {"type": "string", "default": "", "description": "可选画幅，如 '16:9'、'竖图'、'横图'、'1:1'、'3:4'"},
                "width": {"type": "integer", "description": "可选像素宽度（自动对齐 64 倍数并受 Opus 护栏保护）"},
                "height": {"type": "integer", "description": "可选像素高度（自动对齐 64 倍数并受 Opus 护栏保护）"},
                "model": {"type": "string", "default": "", "description": "可选模型 ID，留空使用工作台默认模型"},
                "plan_only": {"type": "boolean", "default": False, "description": "true 表示仅构思方案与提示词不出图（零点数）；false 则遵循工作台外部生图权限"},
                "context_id": {"type": "string", "default": "", "description": "多轮精修时传回上一轮返回的 context_id，以便接续原配方微调"},
            },
            "required": ["brief"],
        },
    },
    {
        "name": "nai_studio_overview",
        "description": "查询 NAI Studio 本地能力总览（支持模型、分辨率、画师分类与风格标签分布、Wildcards 词库、OC/混搭方案数量及当前脱敏配置）。零点数离线查询。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "nai_account_status",
        "description": "查询当前 NovelAI 账号订阅状态（Opus 等级、Anlas 余额、V5 周算力使用比例与恢复倒计时）。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "nai_lint_and_format_prompt",
        "description": "根据指定 NAI 模型（v5 / v4.5 / v4 / v3）检测、规范化提示词并展开动态语法（{a|b} / __wildcard__）预览。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "待检测或规范化的提示词"},
                "model": {"type": "string", "default": "nai-diffusion-5-full"},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "nai_search_tags",
        "description": "中英文混合搜索 Danbooru 与 NovelAI 官方标签（支持输入中文如“白发”、“水手服”、“丁达尔光”或英文前缀）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "中文或英文搜索词"},
                "model": {"type": "string", "default": "nai-diffusion-5-full"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "nai_generate_image",
        "description": "调用 NovelAI 官方接口生成图片并自动保存到 D:\\NAI-Studio\\outputs 与本地 SQLite 图库（内置 Opus 0点数免费保护）。支持 V4/V4.5/V5 多角色 characters。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "正向提示词"},
                "uc": {"type": "string", "description": "额外负向排除词", "default": ""},
                "model": {"type": "string", "default": "nai-diffusion-5-full"},
                "width": {"type": "integer", "default": 832},
                "height": {"type": "integer", "default": 1216},
                "steps": {"type": "integer", "default": 28},
                "scale": {"type": "number", "default": 5.0},
                "cfg_rescale": {"type": "number", "default": 0.0},
                "sampler": {"type": "string", "default": "k_euler_ancestral"},
                "scheduler": {"type": "string", "default": "karras"},
                "seed": {"type": "integer", "default": 0, "description": "0 表示随机种子"},
                "quality_toggle": {"type": "boolean", "default": True},
                "uc_preset": {"type": "integer", "default": 0},
                "expand_wildcards": {"type": "boolean", "default": True},
                "characters": {
                    "type": "array",
                    "description": "可选：V4/V4.5/V5 多角色分控列表，每项含 prompt/uc/center_x/center_y",
                    "items": {"type": "object"},
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "nai_list_artists",
        "description": "多维度检索本地画师图鉴档案（支持关键词、主分类、多维风格标签、收藏筛选、最低 Danbooru 贴文热度及数量限制）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "default": "", "description": "画师名/Tag/别名/笔记关键词（空格分隔多词）"},
                "category": {"type": "string", "default": "", "description": "主分类（如 厚涂光影、幻彩插画、清透水彩、日系轻小说、萌系赛璐璐、赛博冷调、写实复古）"},
                "style_tag": {"type": "string", "default": "", "description": "多维风格标签（如 平涂赛璐璐、电影级氛围等）"},
                "favorite_only": {"type": "boolean", "default": False},
                "min_posts": {"type": "integer", "default": 0, "description": "最低 Danbooru 贴文数阈值"},
                "limit": {"type": "integer", "default": 30, "description": "返回上限（1-100）"},
            },
        },
    },
    {
        "name": "nai_query_gallery",
        "description": "检索本地永久图库中的历史生成作品、完整配方与磁盘文件路径（支持关键词、模型、仅收藏、分页）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "default": ""},
                "model": {"type": "string", "default": "", "description": "可选：模型短名或 ID 过滤"},
                "favorite_only": {"type": "boolean", "default": False},
                "limit": {"type": "integer", "default": 10},
                "offset": {"type": "integer", "default": 0},
            },
        },
    },
    {
        "name": "nai_inspect_png",
        "description": "读取任意本地 PNG 图片中的 NovelAI 原生元数据与 Stealth PNG 隐写配方；不传 file_path 时自动读取图库最新一张作品。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "default": "", "description": "PNG 文件路径（绝对路径或 outputs 相对路径，留空则读取最新图）"},
            },
        },
    },
    {
        "name": "nai_director_augment",
        "description": "调用 NovelAI Director 工具处理图像（支持 lineart/sketch/colorize/emotion/declutter，Opus 0点数）。image 可传 Base64/data URL 或本地图片路径。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "req_type": {"type": "string", "default": "lineart"},
                "image": {"type": "string", "description": "Base64、data URL 或本地 PNG/WebP/JPG 路径"},
                "prompt": {"type": "string", "default": ""},
                "emotion": {"type": "string", "default": "happy"},
                "defry": {"type": "integer", "default": 0},
            },
            "required": ["req_type", "image"],
        },
    },
    {
        "name": "nai_manage_oc_cards",
        "description": "管理我的 OC 角色设定卡（用于 V4/V4.5/V5 多角色同屏生成）：支持 list / save / delete。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "default": "list", "description": "list、save 或 delete"},
                "card_id": {"type": "integer", "description": "delete 时可传角色卡 ID"},
                "name": {"type": "string", "default": "", "description": "save 必填或 delete 按名称匹配"},
                "prompt": {"type": "string", "default": "", "description": "save 必填：角色正向描述"},
                "uc": {"type": "string", "default": "", "description": "可选：角色专属负向词"},
                "default_x": {"type": "number", "default": 0.5, "description": "默认构图 X (0.1~0.9)"},
                "default_y": {"type": "number", "default": 0.5, "description": "默认构图 Y (0.1~0.9)"},
            },
        },
    },
    {
        "name": "nai_sync_gallery",
        "description": "扫描 D:\\NAI-Studio\\outputs 文件夹并自动补录外部或离线 PNG 元数据到本地图库。",
        "inputSchema": {"type": "object", "properties": {}},
    },
]

MCP_EXAMPLE_ARGS: Dict[str, Dict[str, Any]] = {
    "nai_delegate_art_task": {
        "brief": "帮我构思一张 16:9 冷色调雨夜赛博街景插画，左侧留白，先只出方案与提示词",
        "aspect_ratio": "16:9",
        "plan_only": True,
    },
    "nai_studio_overview": {},
    "nai_account_status": {},
    "nai_lint_and_format_prompt": {
        "prompt": "1girl, (silver_hair:1.2), {[{rooftop}]}, {sunset|night}",
        "model": "nai-diffusion-5-full",
    },
    "nai_search_tags": {"query": "水手服", "model": "nai-diffusion-5-full"},
    "nai_generate_image": {
        "prompt": "1girl, solo, silver hair, blue eyes, serafuku, sunset",
        "model": "nai-diffusion-5-full",
        "width": 832,
        "height": 1216,
    },
    "nai_list_artists": {"category": "厚涂光影", "limit": 10},
    "nai_query_gallery": {"limit": 3},
    "nai_inspect_png": {},
    "nai_director_augment": {"req_type": "lineart", "image": "<base64_or_outputs_rel_path>"},
    "nai_manage_oc_cards": {"action": "list"},
    "nai_sync_gallery": {},
}


def _resolve_existing_local_file(raw_path: str) -> Path:
    cleaned = str(raw_path or "").strip().strip('"').strip("'")
    if not cleaned:
        raise ValueError("file_path 不能为空")
    candidate = Path(cleaned)
    search_order: List[Path] = []
    if candidate.is_absolute():
        search_order.append(candidate)
    else:
        rel_clean = cleaned.lstrip("/\\")
        if rel_clean.lower().startswith("outputs/") or rel_clean.lower().startswith("outputs\\"):
            search_order.append(BASE_DIR / rel_clean)
        search_order.append(OUTPUTS_DIR / rel_clean)
        search_order.append(ARTISTS_DIR / rel_clean)
        search_order.append(BASE_DIR / rel_clean)
    for p in search_order:
        if p.exists() and p.is_file():
            return p
    raise FileNotFoundError(f"文件不存在: {search_order[0]}")


def _build_studio_overview(cfg: Dict[str, Any]) -> Dict[str, Any]:
    artists = list_artists()
    cat_counts = Counter(str(a.get("category") or "未分类") for a in artists)
    style_counts = Counter()
    for a in artists:
        for st in a.get("style_tags") or []:
            style_counts[str(st)] += 1
    out_pngs = list(OUTPUTS_DIR.rglob("*.png"))
    art_pngs = list(ARTISTS_DIR.rglob("*.png"))
    total_bytes = sum(f.stat().st_size for f in out_pngs + art_pngs if f.exists())
    return {
        "models": [
            {
                "id": m["id"],
                "name": m["name"],
                "short_name": m["short_name"],
                "badge": m["badge"],
                "supports_multi_char": m["supports_multi_char"],
                "supports_vibe": m["supports_vibe"],
                "supports_precise_ref": m["supports_precise_ref"],
                "default_steps": m["default_steps"],
                "default_scale": m["default_scale"],
            }
            for m in MODELS_CATALOG.values()
        ],
        "resolutions": RESOLUTIONS,
        "director_emotions_count": len(DIRECTOR_EMOTIONS),
        "artists_summary": {
            "total": len(artists),
            "favorites": sum(1 for a in artists if a.get("favorite")),
            "with_preview": sum(1 for a in artists if a.get("preview_url")),
            "categories": dict(cat_counts.most_common()),
            "top_style_tags": dict(style_counts.most_common(24)),
        },
        "wildcards": [w["name"] for w in list_wildcards()],
        "library_counts": {
            "gallery_db": count_gallery(),
            "oc_cards": len(list_oc_cards()),
            "snippets": len(list_snippets()),
            "mix_presets": len(list_mix_presets()),
        },
        "storage": {
            "outputs_dir": str(OUTPUTS_DIR),
            "outputs_png_count": len(out_pngs),
            "artists_preview_count": len(art_pngs),
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        },
        "config_summary": {
            "has_api_token": bool(str(cfg.get("api_token") or "").strip()),
            "opus_free_guard": bool(cfg.get("opus_free_guard", True)),
            "theme": cfg.get("theme", "dark"),
            "prompt_workspace_mode": cfg.get("prompt_workspace_mode", "classic"),
            "agent_enabled": bool(str(cfg.get("llm_api_key") or "").strip()),
            "llm_model": cfg.get("llm_model") or "",
        },
    }


async def execute_mcp_tool(tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
    """Unified async dispatcher for all NAI Studio MCP tools."""
    name = str(tool_name or "").strip()
    args: Dict[str, Any] = dict(arguments) if isinstance(arguments, dict) else {}
    cfg = load_config()

    if name == "nai_studio_overview":
        return _build_studio_overview(cfg)

    if name == "nai_account_status":
        return await fetch_account_status(cfg)

    if name == "nai_lint_and_format_prompt":
        prompt_str = str(args.get("prompt") or "")
        model_str = str(args.get("model") or "nai-diffusion-5-full")
        return {**lint_prompt(prompt_str, model_str), "dynamic_preview": expand_dynamic_prompt(prompt_str)}

    if name == "nai_search_tags":
        query = str(args.get("query") or "").strip() or "白发"
        model_str = str(args.get("model") or "nai-diffusion-5-full")
        return await suggest_tags_hybrid(query, model_str, cfg)

    if name == "nai_delegate_art_task":
        from .a2a_server import run_delegated_art_task
        brief = str(args.get("brief") or "").strip()
        if not brief:
            raise ValueError("nai_delegate_art_task 需要提供非空 brief（画面需求描述）")
        return await run_delegated_art_task(
            brief=brief,
            context_id=str(args.get("context_id") or "").strip() or None,
            aspect_ratio=str(args.get("aspect_ratio") or ""),
            width=args.get("width"),
            height=args.get("height"),
            model=str(args.get("model") or ""),
            plan_only=bool(args.get("plan_only", False)),
            source="mcp",
        )

    if name == "nai_generate_image":
        from .a2a_server import normalize_aspect_ratio_and_size
        if not str(args.get("prompt") or "").strip():
            raise ValueError("nai_generate_image 需要提供非空 prompt；若不想手写 NovelAI 标签，请改用首选入口 nai_delegate_art_task。")
        if not bool(cfg.get("external_agent_allow_generate", True)):
            raise ValueError("当前工作台已关闭外部 Agent 直接生图权限（仅允许方案模式）。请在「设置与 Agent → 外部接入」开启，或使用 nai_delegate_art_task(plan_only=true)。")
        opus_guard = bool(cfg.get("external_agent_opus_guard", True))
        req_args = dict(args)
        w, h = normalize_aspect_ratio_and_size(
            str(req_args.pop("aspect_ratio", "") or ""),
            req_args.get("width"),
            req_args.get("height"),
            opus_guard=opus_guard,
        )
        req_args["width"] = w
        req_args["height"] = h
        if opus_guard and int(req_args.get("steps") or 28) > 28:
            req_args["steps"] = 28
        req_args["opus_free_guard"] = opus_guard
        item = await generate_image(req_args, cfg)
        if isinstance(item, dict) and item.get("rel_path"):
            p = (OUTPUTS_DIR / item["rel_path"]).resolve()
            item.setdefault("file_path", str(p))
            item.setdefault("image_url", f"/outputs/{item['rel_path']}")
        return item

    if name == "nai_list_artists":
        search = str(args.get("search") or "")
        category = str(args.get("category") or "")
        style_tag = str(args.get("style_tag") or "")
        favorite_only = bool(args.get("favorite_only", False))
        min_posts = max(0, int(args.get("min_posts") or 0))
        limit = max(1, min(100, int(args.get("limit") or 30)))
        artists = list_artists(
            search=search,
            category=category,
            favorite_only=favorite_only,
            style_tag=style_tag,
        )
        if min_posts > 0:
            artists = [a for a in artists if int(a.get("post_count") or 0) >= min_posts]
        artists.sort(
            key=lambda a: (1 if a.get("favorite") else 0, int(a.get("post_count") or 0), -int(a.get("id") or 0)),
            reverse=True,
        )
        sliced = artists[:limit]
        return {
            "total_matched": len(artists),
            "returned": len(sliced),
            "artists": sliced,
        }

    if name == "nai_query_gallery":
        search = str(args.get("search") or "")
        model = str(args.get("model") or "")
        favorite_only = bool(args.get("favorite_only", False))
        limit = max(1, min(50, int(args.get("limit") or 10)))
        offset = max(0, int(args.get("offset") or 0))
        rows = list_gallery(
            search=search,
            model=model,
            favorite_only=favorite_only,
            limit=limit,
            offset=offset,
        )
        enriched = []
        for r in rows:
            rel = str(r.get("rel_path") or "")
            p = (OUTPUTS_DIR / rel).resolve() if rel else None
            enriched.append({
                **r,
                "image_url": f"/outputs/{rel}" if rel else "",
                "file_path": str(p) if p else "",
                "exists_on_disk": bool(p and p.is_file()),
            })
        return enriched

    if name == "nai_inspect_png":
        fpath = str(args.get("file_path") or "").strip()
        if fpath:
            p = _resolve_existing_local_file(fpath)
            return {
                "file_path": str(p),
                **extract_nai_metadata(p.read_bytes()),
            }
        latest = list_gallery(limit=1)
        if not latest:
            return {"info": "图库暂无本地 PNG 可检测"}
        p = (OUTPUTS_DIR / latest[0]["rel_path"]).resolve()
        if not p.is_file():
            return {"info": "最新图片磁盘文件不存在", "file_path": str(p)}
        return {
            "file_path": str(p),
            **extract_nai_metadata(p.read_bytes()),
        }

    if name == "nai_director_augment":
        raw_img = str(args.get("image") or "").strip()
        if not raw_img:
            raise ValueError("nai_director_augment 需要提供 image（Base64/data URL 或本地图片路径）")
        req_args = dict(args)
        # Allow external MCP agents to pass a local file path directly without inline Base64 bloat
        if not raw_img.startswith("data:") and len(raw_img) < 512 and (
            "/" in raw_img or "\\" in raw_img or raw_img.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
        ):
            p = _resolve_existing_local_file(raw_img)
            req_args["image"] = base64.b64encode(p.read_bytes()).decode("ascii")
        return await augment_image(req_args, cfg)

    if name == "nai_manage_oc_cards":
        act = str(args.get("action") or "list").strip().lower()
        if act == "list":
            return list_oc_cards()
        if act == "save":
            oc_name = str(args.get("name") or "").strip()
            oc_prompt = str(args.get("prompt") or "").strip()
            if not oc_name or not oc_prompt:
                raise ValueError("action='save' 需要同时提供非空 name 和 prompt")
            return save_oc_card(
                name=oc_name,
                prompt=oc_prompt,
                uc=str(args.get("uc") or ""),
                default_x=float(args.get("default_x") if args.get("default_x") is not None else 0.5),
                default_y=float(args.get("default_y") if args.get("default_y") is not None else 0.5),
            )
        if act == "delete":
            card_id = args.get("card_id")
            if card_id is None and args.get("name"):
                target = str(args.get("name")).strip().lower()
                matched = [c for c in list_oc_cards() if str(c.get("name") or "").strip().lower() == target]
                if not matched:
                    raise FileNotFoundError(f"未找到名为 '{args.get('name')}' 的 OC 角色卡")
                card_id = matched[0]["id"]
            if card_id is None:
                raise ValueError("action='delete' 需要提供 card_id 或 name")
            delete_oc_card(int(card_id))
            return {"ok": True, "deleted_id": int(card_id)}
        raise ValueError(f"不支持的 action: {act}（仅支持 list / save / delete）")

    if name == "nai_sync_gallery":
        return sync_outputs_folder(OUTPUTS_DIR)

    raise ValueError(f"未知的 MCP 工具: {name}。常规创作建议优先调用 nai_delegate_art_task。")


MCP_RESOURCES: List[Dict[str, Any]] = [
    {
        "uri": "nai://studio/guide",
        "name": "NAI Studio External Agent Guide",
        "description": "外部 Agent 与 NAI Studio 协作指南（职责分工、首选工具与多轮精修约定）",
        "mimeType": "text/markdown",
    },
    {
        "uri": "nai://studio/overview",
        "name": "NAI Studio Capabilities Overview",
        "description": "当前本地模型、分辨率、画师图鉴与词库总览 JSON",
        "mimeType": "application/json",
    },
    {
        "uri": "nai://studio/creator-memory",
        "name": "Creator Aesthetic Memory",
        "description": "用户跨会话个人审美记忆本（偏好与忌讳）",
        "mimeType": "text/markdown",
    },
]

MCP_PROMPTS: List[Dict[str, Any]] = [
    {
        "name": "art_director_brief",
        "description": "生成标准美术委派 Brief，交由 NAI Studio 美术总监执行",
        "arguments": [
            {"name": "goal", "description": "画面主题与用途", "required": True},
            {"name": "aspect_ratio", "description": "期望画幅（如 16:9 / 竖图 / 1:1）", "required": False},
        ],
    }
]


def read_mcp_resource(uri: str, base_url: str = "http://127.0.0.1:8780") -> Dict[str, Any]:
    u = str(uri or "").strip()
    if u == "nai://studio/guide":
        from .a2a_server import build_external_client_skill_markdown
        return {"uri": u, "mimeType": "text/markdown", "text": build_external_client_skill_markdown(base_url)}
    if u == "nai://studio/overview":
        import json as _json
        return {"uri": u, "mimeType": "application/json", "text": _json.dumps(_build_studio_overview(load_config()), ensure_ascii=False, indent=2)}
    if u == "nai://studio/creator-memory":
        from .studio_agent import read_creator_memory
        return {"uri": u, "mimeType": "text/markdown", "text": read_creator_memory() or "（暂未填写个人审美记忆）"}
    raise FileNotFoundError(f"未知的 MCP Resource URI: {u}")


def get_mcp_prompt(name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    args = arguments or {}
    if name == "art_director_brief":
        goal = str(args.get("goal") or "一张二次元插画").strip()
        ar = str(args.get("aspect_ratio") or "竖图").strip()
        return {
            "description": "向 NAI Studio 美术总监委派创作任务的标准提示模板",
            "messages": [
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": (
                            f"请调用 nai_delegate_art_task 工具完成以下视觉创作需求：\n"
                            f"- 画面目标：{goal}\n"
                            f"- 期望画幅：{ar}\n"
                            f"- 要求：不要自己手写 NovelAI 标签，直接把目标交给 NAI Studio 美术总监处理，"
                            f"并在完成后检查返回的 artifacts（file_path 与 recipe）。"
                        ),
                    },
                }
            ],
        }
    raise ValueError(f"未知的 MCP Prompt: {name}")

