import json
import re
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from .config import load_config
from .database import (
    append_agent_message,
    create_agent_session,
    get_agent_session,
    list_artists,
    list_gallery,
    list_oc_cards,
    list_snippets,
    update_agent_session_meta,
)
from .models_spec import DIRECTOR_EMOTIONS, MODELS_CATALOG, get_model_spec
from .prompt_agent import _clean_base_url, _clean_tag_field, _get_llm_client
from .prompt_engine import lint_prompt, search_builtin_tags
from .skills_manager import get_skill, list_skills

STUDIO_AGENT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "read_skill",
            "description": "Load the full Markdown instructions of a workspace SKILL.md on demand (Progressive Disclosure).",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill slug name from <available_skills>."}
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_artist_catalog",
            "description": "Search NAI Studio's local artist catalog (curated + custom) by keyword, style mood, category, or favorites.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Chinese or English keyword."},
                    "category": {"type": "string", "description": "Optional category (厚涂光影, 清透水彩, 幻彩插画, 日系轻小说, 赛博冷调, 私人收藏)."},
                    "favorite_only": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_danbooru_tags",
            "description": "Search verified English Danbooru/NovelAI tags matching a Chinese or English visual concept.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Concept or space-separated concepts (e.g. '水手服 逆光')."}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_oc_and_snippets",
            "description": "List saved OC character cards and reusable prompt snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_gallery",
            "description": "Search the user's local generated gallery history by prompt, model, notes, or favorites.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {"type": "string"},
                    "favorite_only": {"type": "boolean"},
                    "limit": {"type": "integer", "default": 6},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_model_rules",
            "description": "Inspect exact NovelAI model capabilities, numeric weight support, quality tags, and UC presets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_id": {"type": "string"}
                },
                "required": ["model_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_and_lint_prompt",
            "description": "Run NAI Studio's official syntax linter on a prompt string to detect errors or warnings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "model_id": {"type": "string"},
                },
                "required": ["prompt", "model_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "patch_prompt_blocks",
            "description": "Directly edit one or more of the 4 workbench prompt blocks (artist, character, lighting, negative) in real time. Use mode='merge' to append/deduplicate colloquial additions onto existing tags, or mode='replace' to rewrite specified blocks cleanly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "artist": {"type": "string", "description": "Artist mix tags ONLY (e.g. '0.85::artist:rella::, 0.65::artist:ciloranko::'). Omit to leave unchanged."},
                    "character": {"type": "string", "description": "Subject, hair, eyes, expression, pose, outfit tags. Omit to leave unchanged."},
                    "lighting": {"type": "string", "description": "Framing, scene, weather, lighting, atmosphere, quality tags. Omit to leave unchanged."},
                    "negative": {"type": "string", "description": "Undesired content (UC) tags. Omit to leave unchanged."},
                    "mode": {"type": "string", "enum": ["merge", "replace"], "default": "merge"},
                    "reason": {"type": "string", "description": "Short Chinese summary of what changed."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_prompt_tags",
            "description": "Remove specific unwanted tags from the positive prompt blocks or negative prompt (UC) in real time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tag strings to remove."},
                    "side": {"type": "string", "enum": ["pos", "uc"], "default": "pos"},
                    "reason": {"type": "string"},
                },
                "required": ["tags"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_workbench_params",
            "description": "Modify live workbench generation parameters (model, resolution, steps, CFG scale, cfg_rescale, sampler, scheduler, seed, variety_plus, alpha_transparency, auto_quality, batch_count).",
            "parameters": {
                "type": "object",
                "properties": {
                    "model": {"type": "string", "enum": list(MODELS_CATALOG.keys())},
                    "width": {"type": "integer"},
                    "height": {"type": "integer"},
                    "steps": {"type": "integer"},
                    "scale": {"type": "number"},
                    "cfg_rescale": {"type": "number"},
                    "sampler": {"type": "string"},
                    "scheduler": {"type": "string"},
                    "seed": {"type": "integer"},
                    "variety_plus": {"type": "boolean"},
                    "alpha_transparency": {"type": "boolean"},
                    "auto_quality": {"type": "boolean"},
                    "batch_count": {"type": "integer"},
                    "reason": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_workbench_mode",
            "description": "Switch the workbench canvas mode between text-to-image ('generate'), image-to-image ('img2img'), local inpainting ('infill'), and outpainting ('outpaint').",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["generate", "img2img", "infill", "outpaint"]},
                    "i2i_strength": {"type": "number", "description": "Optional img2img strength 0.1-0.99."},
                    "outpaint_direction": {"type": "string", "enum": ["right", "left", "top", "bottom", "center"]},
                    "reason": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "load_oc_character",
            "description": "Load a saved OC character card by name or id into the character block and/or multi-character slot.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {"type": "string"},
                    "apply_to_character_block": {"type": "boolean", "default": True},
                },
                "required": ["name_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_director_tool",
            "description": "Run NovelAI Director post-processing on the current canvas artwork (0 Anlas): lineart, sketch, colorize, emotion (24 presets), or declutter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "req_type": {"type": "string", "enum": ["lineart", "sketch", "colorize", "emotion", "declutter"]},
                    "emotion": {"type": "string", "enum": [e["id"] for e in DIRECTOR_EMOTIONS]},
                    "defry": {"type": "integer", "minimum": 0, "maximum": 5, "default": 0},
                    "prompt": {"type": "string", "description": "Optional guiding prompt for colorize/emotion."},
                },
                "required": ["req_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_generate_image",
            "description": "Trigger image generation on the workbench using the current live prompts, mode, and parameters. Only invoke when the user asks to generate/draw now.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string"},
                },
            },
        },
    },
]


def _split_tags(text: str) -> List[str]:
    raw = str(text or "")
    parts: List[str] = []
    buf: List[str] = []
    d_curly = 0
    d_sq = 0
    for ch in raw:
        if ch == "{":
            d_curly += 1
        elif ch == "}" and d_curly > 0:
            d_curly -= 1
        elif ch == "[":
            d_sq += 1
        elif ch == "]" and d_sq > 0:
            d_sq -= 1
        elif ch == "," and d_curly == 0 and d_sq == 0:
            seg = "".join(buf).strip()
            if seg:
                parts.append(seg)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _normalize_tag_key(seg: str) -> str:
    s = seg.strip()
    s = re.sub(r"^[\{\[]+|[\}\]]+$", "", s)
    s = re.sub(r"^-?\d+(?:\.\d+)?::|::$", "", s)
    return s.strip().lower()


def _merge_tag_strings(existing: str, addition: str, mode: str = "merge") -> Tuple[str, List[str], List[str]]:
    old_tags = _split_tags(existing)
    new_tags = _split_tags(_clean_tag_field(addition))
    if mode == "replace":
        old_keys = {_normalize_tag_key(t) for t in old_tags}
        new_keys = {_normalize_tag_key(t) for t in new_tags}
        added = [t for t in new_tags if _normalize_tag_key(t) not in old_keys]
        removed = [t for t in old_tags if _normalize_tag_key(t) not in new_keys]
        return ", ".join(new_tags), added, removed

    # Merge mode: keep existing order, replace same-key tag if re-weighted, append truly new tags
    result = list(old_tags)
    idx_by_key = {_normalize_tag_key(t): i for i, t in enumerate(result)}
    added: List[str] = []
    for t in new_tags:
        k = _normalize_tag_key(t)
        if not k:
            continue
        if k in idx_by_key:
            if result[idx_by_key[k]] != t:
                result[idx_by_key[k]] = t
                added.append(t)
        else:
            idx_by_key[k] = len(result)
            result.append(t)
            added.append(t)
    return ", ".join(result), added, []


def _extract_quick_replies(text: str) -> Tuple[str, List[str]]:
    m = re.search(r"\[QUICK_REPLIES:\s*([^\]]+)\]\s*$", text.strip())
    if not m:
        return text.strip(), []
    clean = text[: m.start()].strip()
    opts = [o.strip() for o in m.group(1).split("|") if o.strip()]
    return clean, opts[:4]


def _extract_slash_skills(user_msg: str) -> List[str]:
    return [m.group(1).lower() for m in re.finditer(r"(?:^|\s)/([a-zA-Z0-9_\-\u4e00-\u9fff]+)", user_msg or "")]


def _build_agent_system_prompt(workbench_state: Dict[str, Any], pinned_skills: List[str], slash_skills: List[str]) -> str:
    all_skills = list_skills(include_content=False)
    skills_index = "\n".join(
        f"- `{s['name']}` ({s['title']}): {s['description']} [触发词: {s['triggers']}]"
        for s in all_skills
    )

    eager_names: List[str] = []
    for name in list(pinned_skills) + list(slash_skills):
        if name and name not in eager_names:
            eager_names.append(name)

    eager_sections: List[str] = []
    for name in eager_names:
        sk = get_skill(name)
        if sk:
            eager_sections.append(f"### Active Skill: `{sk['name']}` ({sk['title']})\n{sk['content']}")
    active_skills_block = "\n\n".join(eager_sections) if eager_sections else "(None pre-loaded; call `read_skill(name)` whenever a skill matches the user's intent.)"

    wb_compact = {
        "model": workbench_state.get("model") or "nai-diffusion-5-full",
        "action": workbench_state.get("action") or "generate",
        "prompt_mode": workbench_state.get("prompt_mode") or "structured",
        "width": workbench_state.get("width") or 832,
        "height": workbench_state.get("height") or 1216,
        "steps": workbench_state.get("steps") or 28,
        "scale": workbench_state.get("scale") or 5.0,
        "sampler": workbench_state.get("sampler") or "k_euler_ancestral",
        "scheduler": workbench_state.get("scheduler") or "karras",
        "seed": workbench_state.get("seed") or 0,
        "opus_free_guard": workbench_state.get("opus_free_guard", True),
        "stage_has_image": bool(workbench_state.get("stage_has_image")),
        "blocks": workbench_state.get("blocks") or {},
        "lint_issue_count": workbench_state.get("lint_issue_count", 0),
        "lint_issues": (workbench_state.get("lint_issues") or [])[:5],
    }

    return f"""You are **NAI Studio Copilot Agent**, a mature, engineering-grade NovelAI Diffusion V4.5 / V5 Creative Director & Workbench Operator.

## Core Capabilities & Principles
1. **Real-Time Prompt Detection & Surgical Editing**:
   - You always see the live `<workbench_state>` below.
   - When the user speaks in colloquial Chinese ("给她加点风吹发丝和夕阳逆光", "太暗了提亮一点", "去掉水印", "帮我看看提示词有什么问题"), translate directly into verified English Danbooru/V5 tags and call `patch_prompt_blocks` (prefer `mode="merge"` for incremental edits, `mode="replace"` for full block rewrites) or `remove_prompt_tags`.
   - Never output SD WebUI `(tag:1.2)` syntax, `BREAK`, or Chinese inside prompt tag fields. Respect V4.5/V5 `w::tag::` vs V3 `{{}}`/`[]`.
2. **Interactive Creative Director (When User Has No Ideas)**:
   - If the user says they have no ideas / feel lazy / want inspiration, read skill `creative-interview` (`read_skill("creative-interview")`), propose 3 vivid, contrasting concepts or ask 2 lightweight questions, and let them pick before filling everything.
3. **Direct Workbench Operations**:
   - You can control parameters (`set_workbench_params`), switch canvas modes (`set_workbench_mode` for `img2img`/`infill`/`outpaint`), load OC cards (`load_oc_character`), run Director post-processing (`run_director_tool`: `lineart`, `sketch`, `colorize`, `emotion`, `declutter`), and trigger generation (`trigger_generate_image`, only when asked to draw/generate now).
   - Never claim you changed the workbench or ran a tool unless you actually called the tool!
4. **Progressive Skill Disclosure**:
   - Available skills are listed in `<available_skills>`. When a task clearly fits one, call `read_skill(name)` to load its full playbook before acting.
5. **Concise, Helpful Chinese Replies + Quick Replies**:
   - Keep replies crisp, structured, and natural in Chinese (1–4 short paragraphs or bullets).
   - Optionally end your message with a single line `[QUICK_REPLIES: 简短选项1 | 简短选项2 | 简短选项3]` (2–3 clickable follow-up suggestions) whenever helpful for the next step (e.g. offering options during brainstorming, or suggesting "直接生成图片 | 调整画师风格 | 换成夜景光影").

<available_skills>
{skills_index}
</available_skills>

<active_skills>
{active_skills_block}
</active_skills>

<workbench_state>
{json.dumps(wb_compact, ensure_ascii=False)}
</workbench_state>"""


def _execute_studio_tool(
    name: str,
    args: Dict[str, Any],
    workbench_state: Dict[str, Any],
    live_blocks: Dict[str, str],
) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    """Executes a studio tool and returns (tool_json_for_llm, human_trace_summary, optional_ui_action)."""
    model_id = str(workbench_state.get("model") or "nai-diffusion-5-full")

    if name == "read_skill":
        sname = str(args.get("name") or "").strip()
        sk = get_skill(sname)
        if not sk:
            return json.dumps({"error": f"Skill '{sname}' not found"}, ensure_ascii=False), f"未找到技能 {sname}", None
        return json.dumps(sk, ensure_ascii=False), f"加载技能「{sk['title']}」", None

    if name == "search_artist_catalog":
        q = str(args.get("query") or "").strip()
        cat = str(args.get("category") or "").strip()
        fav = bool(args.get("favorite_only", False))
        artists = list_artists(search=q, category=cat, favorite_only=fav)
        if not artists and q:
            artists = list_artists(favorite_only=True) or list_artists()
        trimmed = [
            {"name": a["name"], "tag": a["tag"], "category": a["category"], "favorite": a["favorite"], "desc": a["desc"]}
            for a in artists[:10]
        ]
        return json.dumps({"artists": trimmed}, ensure_ascii=False), f"检索画师库({q or cat or '推荐'}) -> {len(trimmed)} 位", None

    if name == "search_danbooru_tags":
        q = str(args.get("query") or "").strip()
        hits = search_builtin_tags(q, limit=12)
        if not hits and q:
            seen = set()
            for part in re.split(r"[\s,，、/]+", q):
                if not part.strip():
                    continue
                for item in search_builtin_tags(part.strip(), limit=6):
                    if item["tag"] not in seen:
                        seen.add(item["tag"])
                        hits.append(item)
            hits = hits[:12]
        return json.dumps({"tags": hits}, ensure_ascii=False), f"检索标签词典({q}) -> {len(hits)} 条", None

    if name == "list_oc_and_snippets":
        q = str(args.get("query") or "").strip().lower()
        ocs = list_oc_cards()
        snips = list_snippets()
        if q:
            ocs = [o for o in ocs if q in (o["name"] + " " + o["prompt"]).lower()] or ocs[:4]
            snips = [s for s in snips if q in (s["label"] + " " + s["tags"]).lower()] or snips[:6]
        return (
            json.dumps(
                {
                    "oc_cards": [{"id": o["id"], "name": o["name"], "prompt": o["prompt"], "uc": o["uc"]} for o in ocs[:6]],
                    "snippets": [{"label": s["label"], "tags": s["tags"]} for s in snips[:8]],
                },
                ensure_ascii=False,
            ),
            f"读取 OC({len(ocs[:6])}) 与词条({len(snips[:8])})",
            None,
        )

    if name == "query_gallery":
        search = str(args.get("search") or "")
        fav = bool(args.get("favorite_only", False))
        lim = max(1, min(12, int(args.get("limit") or 6)))
        rows = list_gallery(limit=lim, offset=0, search=search, favorite_only=fav)
        compact = [
            {
                "id": r["id"],
                "model_short": r["model_short"],
                "seed": r["seed"],
                "notes": r["notes"],
                "prompt": r["prompt"][:220],
                "favorite": r["favorite"],
            }
            for r in rows
        ]
        return json.dumps({"items": compact}, ensure_ascii=False), f"查询图库记录 -> {len(compact)} 张", None

    if name == "get_current_model_rules":
        mid = str(args.get("model_id") or model_id)
        spec = get_model_spec(mid)
        payload = {
            "id": spec["id"],
            "name": spec["name"],
            "supports_numeric_weight": spec["supports_numeric_weight"],
            "supports_alpha_transparency": spec.get("supports_alpha_transparency", False),
            "quality_tags": spec["quality_tags"],
            "default_scale": spec["default_scale"],
            "heavy_uc": (spec.get("uc_presets") or {}).get("heavy", {}).get("tags", ""),
        }
        return json.dumps(payload, ensure_ascii=False), f"读取模型规范({spec['short_name']})", None

    if name == "validate_and_lint_prompt":
        prompt_str = str(args.get("prompt") or "")
        mid = str(args.get("model_id") or model_id)
        res = lint_prompt(prompt_str, mid)
        is_clean = res["issue_count"] == 0
        summary = f"语法体检 -> {'通过' if is_clean else str(res['issue_count']) + ' 处问题'}"
        return (
            json.dumps({"is_clean": is_clean, "issues": res["issues"][:6], "fixed_prompt": res["fixed_prompt"]}, ensure_ascii=False),
            summary,
            None,
        )

    if name == "patch_prompt_blocks":
        mode = "replace" if str(args.get("mode") or "merge") == "replace" else "merge"
        reason = str(args.get("reason") or "更新提示词区块").strip()
        changed_blocks: Dict[str, str] = {}
        all_added: List[str] = []
        all_removed: List[str] = []
        block_labels = {"artist": "画师串", "character": "人物", "lighting": "光影", "negative": "负面"}
        touched_names: List[str] = []

        for key in ("artist", "character", "lighting", "negative"):
            if key in args and args[key] is not None:
                merged, added, removed = _merge_tag_strings(live_blocks.get(key, ""), str(args[key]), mode=mode)
                live_blocks[key] = merged
                changed_blocks[key] = merged
                all_added.extend(added)
                all_removed.extend(removed)
                touched_names.append(block_labels[key])

        if not changed_blocks:
            return json.dumps({"ok": False, "error": "No block fields provided"}, ensure_ascii=False), "未指定修改区块", None

        combined_pos = ", ".join(p for p in (live_blocks.get("artist", ""), live_blocks.get("character", ""), live_blocks.get("lighting", "")) if p)
        lint_res = lint_prompt(combined_pos, model_id)
        summary = f"实时写入「{'/'.join(touched_names)}」(+{len(all_added)}" + (f" / -{len(all_removed)}" if all_removed else "") + ")"
        ui_action = {
            "type": "patch_prompt_blocks",
            "summary": reason or summary,
            "payload": {
                "blocks": changed_blocks,
                "mode": mode,
                "added": all_added[:12],
                "removed": all_removed[:12],
                "reason": reason,
            },
        }
        return (
            json.dumps(
                {
                    "ok": True,
                    "updated_blocks": changed_blocks,
                    "added": all_added,
                    "removed": all_removed,
                    "lint_issue_count": lint_res["issue_count"],
                    "lint_issues": lint_res["issues"][:4],
                },
                ensure_ascii=False,
            ),
            summary,
            ui_action,
        )

    if name == "remove_prompt_tags":
        raw_tags = args.get("tags") if isinstance(args.get("tags"), list) else []
        side = "uc" if str(args.get("side") or "pos") == "uc" else "pos"
        reason = str(args.get("reason") or "移除指定标签").strip()
        rm_keys = {_normalize_tag_key(str(t)) for t in raw_tags if str(t).strip()}
        removed_actual: List[str] = []
        changed_blocks: Dict[str, str] = {}
        target_keys = ("negative",) if side == "uc" else ("artist", "character", "lighting")
        for bk in target_keys:
            cur_list = _split_tags(live_blocks.get(bk, ""))
            kept = []
            for seg in cur_list:
                if _normalize_tag_key(seg) in rm_keys:
                    removed_actual.append(seg)
                else:
                    kept.append(seg)
            if len(kept) != len(cur_list):
                live_blocks[bk] = ", ".join(kept)
                changed_blocks[bk] = live_blocks[bk]
        summary = f"移除 {len(removed_actual)} 个标签" if removed_actual else "未匹配到可移除标签"
        ui_action = (
            {
                "type": "patch_prompt_blocks",
                "summary": reason or summary,
                "payload": {"blocks": changed_blocks, "mode": "replace", "added": [], "removed": removed_actual, "reason": reason},
            }
            if changed_blocks
            else None
        )
        return json.dumps({"ok": True, "removed": removed_actual, "updated_blocks": changed_blocks}, ensure_ascii=False), summary, ui_action

    if name == "set_workbench_params":
        allowed = (
            "model", "width", "height", "steps", "scale", "cfg_rescale",
            "sampler", "scheduler", "seed", "variety_plus",
            "alpha_transparency", "auto_quality", "batch_count",
        )
        clean_params = {k: args[k] for k in allowed if k in args and args[k] is not None}
        if not clean_params:
            return json.dumps({"ok": False, "error": "No valid params provided"}, ensure_ascii=False), "无有效参数", None
        # Update local shadow model if switched
        if "model" in clean_params:
            workbench_state["model"] = clean_params["model"]
        desc = ", ".join(f"{k}={v}" for k, v in clean_params.items())
        reason = str(args.get("reason") or f"调整工作台参数: {desc}")
        ui_action = {"type": "set_workbench_params", "summary": reason, "payload": clean_params}
        return json.dumps({"ok": True, "applied": clean_params}, ensure_ascii=False), f"调整参数({desc[:48]})", ui_action

    if name == "set_workbench_mode":
        act = str(args.get("action") or "generate")
        payload: Dict[str, Any] = {"action": act}
        if args.get("i2i_strength") is not None:
            payload["i2i_strength"] = max(0.1, min(0.99, float(args["i2i_strength"])))
        if args.get("outpaint_direction"):
            payload["outpaint_direction"] = str(args["outpaint_direction"])
        mode_cn = {"generate": "文生图", "img2img": "图生图", "infill": "局部重绘", "outpaint": "扩图"}.get(act, act)
        summary = f"切换画布模式 -> {mode_cn}"
        ui_action = {"type": "set_workbench_mode", "summary": str(args.get("reason") or summary), "payload": payload}
        return json.dumps({"ok": True, **payload}, ensure_ascii=False), summary, ui_action

    if name == "load_oc_character":
        key = str(args.get("name_or_id") or "").strip()
        ocs = list_oc_cards()
        match = None
        for o in ocs:
            if str(o["id"]) == key or key.lower() in o["name"].lower():
                match = o
                break
        if not match:
            return json.dumps({"ok": False, "error": f"未找到 OC 角色 '{key}'"}, ensure_ascii=False), f"未找到 OC({key})", None
        apply_char = bool(args.get("apply_to_character_block", True))
        if apply_char:
            merged, _, _ = _merge_tag_strings(live_blocks.get("character", ""), match["prompt"], mode="replace")
            live_blocks["character"] = merged
        ui_action = {
            "type": "load_oc_character",
            "summary": f"载入 OC 角色「{match['name']}」",
            "payload": {"card": match, "apply_to_character_block": apply_char},
        }
        return json.dumps({"ok": True, "card": match}, ensure_ascii=False), f"载入 OC「{match['name']}」", ui_action

    if name == "run_director_tool":
        req_type = str(args.get("req_type") or "lineart")
        if not workbench_state.get("stage_has_image"):
            return (
                json.dumps({"ok": False, "error": "当前中央画布暂无图片，无法执行 Director 处理。请先生成或载入一张图片。"}, ensure_ascii=False),
                "画布为空，跳过 Director",
                None,
            )
        payload = {
            "req_type": req_type,
            "emotion": str(args.get("emotion") or "happy"),
            "defry": max(0, min(5, int(args.get("defry") or 0))),
            "prompt": str(args.get("prompt") or ""),
        }
        type_cn = {"lineart": "提取线稿", "sketch": "转草图", "colorize": "智能上色", "emotion": f"表情微调({payload['emotion']})", "declutter": "去杂物"}.get(req_type, req_type)
        summary = f"执行 Director · {type_cn}"
        ui_action = {"type": "run_director_tool", "summary": summary, "payload": payload}
        return json.dumps({"ok": True, "dispatched": payload}, ensure_ascii=False), summary, ui_action

    if name == "trigger_generate_image":
        reason = str(args.get("reason") or "触发工作台出图")
        ui_action = {"type": "trigger_generate_image", "summary": reason, "payload": {"reason": reason}}
        return json.dumps({"ok": True, "dispatched": True}, ensure_ascii=False), "触发工作台出图", ui_action

    return json.dumps({"error": f"Unknown tool {name}"}, ensure_ascii=False), f"未知工具({name})", None


async def stream_studio_agent(
    user_message: str,
    session_id: Optional[str] = None,
    workbench_state: Optional[Dict[str, Any]] = None,
    pinned_skills: Optional[List[str]] = None,
) -> AsyncIterator[str]:
    """Claude Code / Codex style multi-turn ReAct SSE stream with live tool execution & UI action dispatch."""

    def sse(event_type: str, payload: Dict[str, Any]) -> str:
        return f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n"

    cfg = load_config()
    base_url = _clean_base_url(cfg.get("llm_base_url") or "")
    api_key = str(cfg.get("llm_api_key") or "").strip()
    llm_model = str(cfg.get("llm_model") or "qwen4-max").strip()
    if not base_url or not api_key:
        yield sse("error", {"message": "尚未配置 LLM API Key 或 Base URL，请前往「设置与 Agent」填写并保存。"})
        return

    wb = dict(workbench_state or {})
    blocks_raw = wb.get("blocks") if isinstance(wb.get("blocks"), dict) else {}
    live_blocks: Dict[str, str] = {
        "artist": str(blocks_raw.get("artist") or ""),
        "character": str(blocks_raw.get("character") or ""),
        "lighting": str(blocks_raw.get("lighting") or ""),
        "negative": str(blocks_raw.get("negative") or ""),
    }
    wb["blocks"] = live_blocks

    # Ensure persistent session
    sess = get_agent_session(session_id) if session_id else None
    if not sess:
        auto_title = (user_message or "新创作对话").strip().splitlines()[0][:24]
        created = create_agent_session(title=auto_title, pinned_skills=pinned_skills or [])
        sid = created["id"]
        sess = get_agent_session(sid) or {**created, "messages": []}
    else:
        sid = sess["id"]
        if pinned_skills is not None:
            update_agent_session_meta(sid, pinned_skills=pinned_skills)
            sess["pinned_skills"] = pinned_skills
        if not sess.get("messages") and user_message.strip():
            auto_title = user_message.strip().splitlines()[0][:24]
            update_agent_session_meta(sid, title=auto_title)
            sess["title"] = auto_title

    yield sse("session", {"session_id": sid, "title": sess.get("title", "新创作对话")})

    active_pinned = pinned_skills if pinned_skills is not None else list(sess.get("pinned_skills") or [])
    slash_skills = _extract_slash_skills(user_message)

    # Persist user message
    append_agent_message(sid, "user", user_message)

    # Build OpenAI conversation messages (system + recent history + current user message)
    sys_prompt = _build_agent_system_prompt(wb, active_pinned, slash_skills)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": sys_prompt}]
    for hist in (sess.get("messages") or [])[-14:]:
        if hist.get("role") in ("user", "assistant") and hist.get("content"):
            messages.append({"role": hist["role"], "content": hist["content"]})
    messages.append({"role": "user", "content": user_message})

    client = _get_llm_client()
    endpoint = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "NAI-Studio-Agent/3.0",
    }

    tool_events: List[Dict[str, Any]] = []
    ui_actions: List[Dict[str, Any]] = []
    final_reply = ""

    yield sse("status", {"text": f"{llm_model} 正在分析当前画布与需求..."})

    try:
        for round_idx in range(6):
            req_body: Dict[str, Any] = {
                "model": llm_model,
                "messages": messages,
                "tools": STUDIO_AGENT_TOOLS,
                "tool_choice": "auto" if round_idx < 5 else "none",
                "temperature": 0.5,
                "max_tokens": 2200,
            }
            r = await client.post(endpoint, headers=headers, json=req_body, timeout=75.0)
            if r.status_code == 400 and "tool" in r.text.lower():
                # Graceful fallback if chosen model doesn't support OpenAI tools
                req_body.pop("tools", None)
                req_body.pop("tool_choice", None)
                r = await client.post(endpoint, headers=headers, json=req_body, timeout=75.0)
            if r.status_code != 200:
                raise ValueError(f"LLM 请求失败 (HTTP {r.status_code}): {r.text[:240]}")

            data = r.json()
            msg = (data.get("choices") or [{}])[0].get("message") or {}
            tool_calls = msg.get("tool_calls") or []
            messages.append(msg)

            if not tool_calls:
                final_reply = str(msg.get("content") or "").strip()
                break

            for tc in tool_calls[:6]:
                fn = tc.get("function") or {}
                tname = str(fn.get("name") or "")
                tc_id = str(tc.get("id") or f"call_{round_idx}_{tname}")
                try:
                    targs = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    targs = {}

                yield sse("tool_start", {"id": tc_id, "name": tname, "args": targs})
                out_json, summary, ui_action = _execute_studio_tool(tname, targs, wb, live_blocks)

                ev = {"id": tc_id, "name": tname, "summary": summary, "ok": '"error"' not in out_json}
                tool_events.append(ev)
                yield sse("tool_result", ev)

                if ui_action:
                    ui_actions.append(ui_action)
                    yield sse("ui_action", {"action": ui_action})

                messages.append({"role": "tool", "tool_call_id": tc_id, "content": out_json})

            yield sse("status", {"text": "整合结果并组织回复..."})

        clean_reply, quick_replies = _extract_quick_replies(final_reply or "已完成工作台操作。")
        # Emit reply smoothly in readable chunks so UI renders live progressively
        chunk_size = 24
        for i in range(0, len(clean_reply), chunk_size):
            yield sse("delta", {"text": clean_reply[i : i + chunk_size]})

        append_agent_message(sid, "assistant", clean_reply, tool_events=tool_events, ui_actions=ui_actions)
        yield sse(
            "done",
            {
                "session_id": sid,
                "model": llm_model,
                "reply": clean_reply,
                "tool_events": tool_events,
                "ui_actions": ui_actions,
                "quick_replies": quick_replies,
            },
        )
    except Exception as exc:
        yield sse("error", {"message": str(exc) or "Agent 执行异常"})
