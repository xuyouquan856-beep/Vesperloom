#!/usr/bin/env python3
r"""
NAI Studio — Native MCP Server (JSON-RPC 2.0 over stdio)
Exposes NovelAI V5 / V4.5 / V4 / V3 image generation, model-aware prompt linting,
hybrid CN/EN tag search, artist catalog & mixer, and local gallery inspection to AI Agents.
Strictly stores all files on D:\NAI-Studio (zero C: drive usage).
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))

from backend.config import load_config
from backend.database import init_db, list_artists, list_gallery, list_oc_cards, save_oc_card, sync_outputs_folder
from backend.nai_client import augment_image, fetch_account_status, generate_image, suggest_tags_hybrid
from backend.png_metadata import extract_nai_metadata
from backend.prompt_engine import expand_dynamic_prompt, lint_prompt

init_db()

MCP_TOOLS = [
    {
        "name": "nai_account_status",
        "description": "查询当前 NovelAI 账号订阅状态（Opus 等级、Anlas 余额、V5 周算力使用比例与恢复倒计时）。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "nai_lint_and_format_prompt",
        "description": "根据指定 NAI 模型（v5 / v4.5 / v4 / v3）检测并规范化提示词（自动转换 SD (tag:1.2) 权重、清理冗余括号、转换普通标签下划线）。",
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
        "description": "调用 NovelAI 官方接口生成图片并自动保存到 D:\\NAI-Studio\\outputs 与本地 SQLite 图库（内置 Opus 0点数免费保护）。",
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
                "sampler": {"type": "string", "default": "k_euler_ancestral"},
                "seed": {"type": "integer", "default": 0},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "nai_list_artists",
        "description": "查询本地画师图鉴与画风分类（支持按风格或画师名检索）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "default": ""},
                "category": {"type": "string", "default": ""},
            },
        },
    },
    {
        "name": "nai_query_gallery",
        "description": "检索本地永久图库中的历史生成作品与完整配方参数。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "default": ""},
                "limit": {"type": "integer", "default": 10},
            },
        },
    },
    {
        "name": "nai_inspect_png",
        "description": "读取任意本地 PNG 图片中的 NovelAI 原生元数据与 Stealth PNG 隐写配方。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "PNG 文件路径"},
            },
            "required": ["file_path"],
        },
    },
    {
        "name": "nai_director_augment",
        "description": "调用 NovelAI Director 工具处理图像（支持 lineart/sketch/colorize/emotion/declutter，Opus 0点数）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "req_type": {"type": "string", "default": "lineart"},
                "image": {"type": "string", "description": "Base64 或 data URL"},
                "prompt": {"type": "string", "default": ""},
                "emotion": {"type": "string", "default": "happy"},
                "defry": {"type": "integer", "default": 0},
            },
            "required": ["req_type", "image"],
        },
    },
    {
        "name": "nai_manage_oc_cards",
        "description": "查询或保存我的 OC 角色设定卡（用于 V4/V4.5/V5 多角色同屏生成）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "default": "list", "description": "list 或 save"},
                "name": {"type": "string", "default": ""},
                "prompt": {"type": "string", "default": ""},
                "uc": {"type": "string", "default": ""},
            },
        },
    },
    {
        "name": "nai_sync_gallery",
        "description": "扫描 D:\\NAI-Studio\\outputs 文件夹并自动补录外部或离线 PNG 元数据到本地图库。",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


async def handle_call_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    cfg = load_config()
    if name == "nai_account_status":
        res = await fetch_account_status(cfg)
    elif name == "nai_lint_and_format_prompt":
        prompt_str = str(args.get("prompt") or "")
        model_str = str(args.get("model") or "nai-diffusion-5-full")
        res = {**lint_prompt(prompt_str, model_str), "dynamic_preview": expand_dynamic_prompt(prompt_str)}
    elif name == "nai_search_tags":
        res = await suggest_tags_hybrid(str(args.get("query") or ""), str(args.get("model") or "nai-diffusion-5-full"), cfg)
    elif name == "nai_generate_image":
        res = await generate_image(args, cfg)
    elif name == "nai_list_artists":
        res = list_artists(search=str(args.get("search") or ""), category=str(args.get("category") or ""))
    elif name == "nai_query_gallery":
        res = list_gallery(search=str(args.get("search") or ""), limit=int(args.get("limit") or 10))
    elif name == "nai_inspect_png":
        p = Path(str(args.get("file_path") or ""))
        res = extract_nai_metadata(p.read_bytes())
    elif name == "nai_director_augment":
        res = await augment_image(args, cfg)
    elif name == "nai_manage_oc_cards":
        act = str(args.get("action") or "list").lower()
        if act == "save" and args.get("name") and args.get("prompt"):
            res = save_oc_card(str(args["name"]), str(args["prompt"]), str(args.get("uc") or ""))
        else:
            res = list_oc_cards()
    elif name == "nai_sync_gallery":
        res = sync_outputs_folder()
    else:
        raise ValueError(f"Unknown tool: {name}")
    return {"content": [{"type": "text", "text": json.dumps(res, ensure_ascii=False, indent=2)}]}


async def main() -> None:
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            req_id = msg.get("id")
            method = msg.get("method")
            params = msg.get("params") or {}

            if method == "initialize":
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "nai-studio-mcp", "version": "2.0.0"},
                    },
                }
            elif method == "tools/list":
                resp = {"jsonrpc": "2.0", "id": req_id, "result": {"tools": MCP_TOOLS}}
            elif method == "tools/call":
                tool_res = await handle_call_tool(params.get("name", ""), params.get("arguments") or {})
                resp = {"jsonrpc": "2.0", "id": req_id, "result": tool_res}
            elif req_id is not None:
                resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
            else:
                continue

            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            if "req_id" in locals() and req_id is not None:
                err_resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(exc)},
                }
                sys.stdout.write(json.dumps(err_resp, ensure_ascii=False) + "\n")
                sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
