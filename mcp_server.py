#!/usr/bin/env python3
r"""
NAI Studio — Native MCP Server (JSON-RPC 2.0 over stdio)
Exposes NovelAI V5 / V4.5 / V4 / V3 image generation, model-aware prompt linting,
hybrid CN/EN tag search, multi-facet artist catalog, and local gallery inspection to AI Agents.
Strictly stores all files on D:\NAI-Studio (zero C: drive usage).
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Ensure UTF-8 stdio on Chinese Windows consoles (prevents CP936/GBK crashes on Unicode artist/gallery text)
for _stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from backend.mcp_tools import MCP_TOOLS, execute_mcp_tool


async def handle_call_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        res = await execute_mcp_tool(name, args)
        return {
            "content": [{"type": "text", "text": json.dumps(res, ensure_ascii=False, indent=2)}],
            "isError": False,
        }
    except Exception as exc:
        err_payload = {"error": str(exc), "tool": name}
        return {
            "content": [{"type": "text", "text": json.dumps(err_payload, ensure_ascii=False, indent=2)}],
            "isError": True,
        }


def _write_json_line(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


async def main() -> None:
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue

        req_id: Any = None
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_json_line({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Invalid JSON: {exc}"},
            })
            continue

        if not isinstance(msg, dict):
            _write_json_line({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32600, "message": "Invalid Request: expected JSON object"},
            })
            continue

        req_id = msg.get("id")
        is_notification = "id" not in msg or req_id is None
        method = str(msg.get("method") or "")
        params = msg.get("params") if isinstance(msg.get("params"), dict) else {}

        try:
            if is_notification or method.startswith("notifications/"):
                continue

            if method == "initialize":
                client_ver = str(params.get("protocolVersion") or "2024-11-05")
                proto_ver = client_ver if client_ver in ("2024-11-05", "2025-03-26", "2025-06-18") else "2024-11-05"
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": proto_ver,
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "nai-studio-mcp", "version": "2.3.0"},
                    },
                }
            elif method == "ping":
                resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
            elif method == "tools/list":
                resp = {"jsonrpc": "2.0", "id": req_id, "result": {"tools": MCP_TOOLS}}
            elif method == "tools/call":
                tname = str(params.get("name") or "").strip()
                targs = params.get("arguments")
                if targs is not None and not isinstance(targs, dict):
                    resp = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32602, "message": "Invalid params: arguments must be an object"},
                    }
                else:
                    tool_res = await handle_call_tool(tname, targs or {})
                    resp = {"jsonrpc": "2.0", "id": req_id, "result": tool_res}
            else:
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                }
            _write_json_line(resp)
        except Exception as exc:
            if not is_notification:
                _write_json_line({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(exc)},
                })


if __name__ == "__main__":
    asyncio.run(main())
