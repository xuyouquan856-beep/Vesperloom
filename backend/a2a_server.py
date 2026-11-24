"""
Standard A2A (Agent2Agent) Server & High-Level Art Director Delegation Kernel for NAI Studio.

Implements:
- Agent Card discovery (/.well-known/agent-card.json & /.well-known/agent.json)
- JSON-RPC 2.0 endpoint (POST /a2a) supporting message/send, message/stream (SSE), tasks/get, tasks/cancel, tasks/list
- Shared high-level delegation kernel `run_delegated_art_task` reused by both A2A and MCP (`nai_delegate_art_task`)
- Defensive guardrails (Bearer Token auth, Opus free guard, max images per external task, plan-only toggle)
"""
from __future__ import annotations

import asyncio
import datetime
import json
import re
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from .config import BASE_DIR, OUTPUTS_DIR, load_config
from .database import (
    create_a2a_task,
    create_agent_session,
    get_a2a_task,
    get_agent_session,
    list_a2a_tasks,
    list_artists,
    update_a2a_task,
)
from .models_spec import get_model_spec
from .nai_client import generate_image
from .prompt_engine import lint_prompt
from .studio_agent import read_creator_memory, stream_studio_agent

A2A_PROTOCOL_VERSION = "0.2.6"
A2A_AGENT_VERSION = "3.0.0"

_ASPECT_MAP: Dict[str, Tuple[int, int]] = {
    "portrait": (832, 1216),
    "竖图": (832, 1216),
    "9:16": (768, 1344),
    "2:3": (832, 1216),
    "3:4": (896, 1152),
    "landscape": (1216, 832),
    "横图": (1216, 832),
    "16:9": (1344, 768),
    "3:2": (1216, 832),
    "4:3": (1152, 896),
    "square": (1024, 1024),
    "方图": (1024, 1024),
    "1:1": (1024, 1024),
}


def _iso_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_aspect_ratio_and_size(
    aspect_ratio: str = "",
    width: Optional[int] = None,
    height: Optional[int] = None,
    opus_guard: bool = True,
) -> Tuple[int, int]:
    """Defensively normalize external Agent aspect ratio or raw dimensions to valid 64px NAI sizes."""
    ar = str(aspect_ratio or "").strip().lower()
    w = int(width) if width else 0
    h = int(height) if height else 0

    if ar and (not w or not h):
        for k, (mw, mh) in _ASPECT_MAP.items():
            if k in ar:
                w, h = mw, mh
                break

    if not w or not h:
        w, h = 832, 1216

    # Align to 64-pixel multiples within NovelAI safe range
    w = max(512, min(2048, (w // 64) * 64))
    h = max(512, min(2048, (h // 64) * 64))

    # Enforce Opus 1,048,576 px free ceiling when opus_guard is enabled
    if opus_guard and (w * h > 1048576):
        scale = (1048576 / float(w * h)) ** 0.5
        w = max(512, (int(w * scale) // 64) * 64)
        h = max(512, (int(h * scale) // 64) * 64)
        while w * h > 1048576 and w > 512:
            w -= 64

    return w, h


def build_agent_card(base_url: str) -> Dict[str, Any]:
    """Build standard A2A Agent Card (/.well-known/agent-card.json)."""
    cfg = load_config()
    root = str(base_url or "http://127.0.0.1:8780").rstrip("/")
    auth_on = bool(cfg.get("external_agent_auth_enabled") and cfg.get("external_agent_token"))
    card: Dict[str, Any] = {
        "name": "NAI Studio Art Director",
        "description": (
            "专业 NovelAI V5 / V4.5 视觉创作与画师混搭 Agent。"
            "外部 Agent 只需用自然语言描述画面目标、风格与用途，NAI Studio 会自动结合用户审美记忆本、"
            "本地画师图鉴与 V5 提示词规范完成构思、配方生成、出图与结构化 Artifact 交付。"
        ),
        "url": f"{root}/a2a",
        "version": A2A_AGENT_VERSION,
        "protocolVersion": A2A_PROTOCOL_VERSION,
        "provider": {
            "organization": "NAI Studio (Local Workbench)",
            "url": root,
        },
        "capabilities": {
            "streaming": True,
            "pushNotifications": False,
            "stateTransitionHistory": True,
        },
        "defaultInputModes": ["text/plain", "image/png", "image/jpeg"],
        "defaultOutputModes": ["text/plain", "application/json", "image/png"],
        "skills": [
            {
                "id": "art-direction",
                "name": "全流程视觉创作与生图委派",
                "description": "根据自然语言画面需求自动挑选画师、编写 NovelAI V5/V4.5 正负面提示词并可选直接生图，返回本地 PNG 路径与完整配方。",
                "tags": ["novelai", "anime", "illustration", "art-direction", "image-generation"],
                "examples": [
                    "画一张 16:9 的赛博雨夜街头横图做网站头图，冷色调、左侧留白",
                    "帮我设计 3 套清透水彩风的雪夜银发少女方案，先不出图",
                ],
            },
            {
                "id": "artist-style-blending",
                "name": "本地画师图鉴检索与黄金配比",
                "description": "基于本地画师库多维风格标签与熟度，推荐并组合画师权重串。",
                "tags": ["artists", "style-mixing", "danbooru"],
                "examples": ["推荐一套厚涂电影感与通透水彩结合的画师混搭"],
            },
            {
                "id": "prompt-lint-and-craft",
                "name": "NovelAI V5 提示词语法体检与精修",
                "description": "将中文大白话或已有提示词转译并体检为规范的 NovelAI V5/V4.5 标签，支持多轮 contextId 精修。",
                "tags": ["prompt-engineering", "lint", "danbooru-tags"],
                "examples": ["把刚才那张图的背景压暗，加强发丝逆光"],
            },
        ],
        "metadata": {
            "mcp_streamable_http_url": f"{root}/mcp",
            "max_images_per_task": int(cfg.get("external_agent_max_images") or 1),
            "opus_free_guard": bool(cfg.get("external_agent_opus_guard", True)),
            "allow_direct_generate": bool(cfg.get("external_agent_allow_generate", True)),
        },
    }
    if auth_on:
        card["securitySchemes"] = {
            "bearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "description": "在 NAI Studio「设置与 Agent → 外部接入」中配置的 Bearer Token",
            }
        }
        card["security"] = [{"bearerAuth": []}]
    return card


def build_external_client_skill_markdown(base_url: str) -> str:
    """Ready-to-copy thin SKILL.md for external CLI/Desktop Agents to collaborate cleanly with NAI Studio."""
    root = str(base_url or "http://127.0.0.1:8780").rstrip("/")
    return f"""---
name: nai-studio-art-director
description: Delegate anime/illustration image creation, prompt crafting, and artist blending to NAI Studio Art Director via MCP or A2A.
---

# NAI Studio 美术总监协作指南（外部 Agent 专用）

当用户需要生成插画、角色立绘、项目封面图、概念图或优化 NovelAI 提示词时，**不要自己手写 NovelAI 底层 Tag 或乱猜画师权重**——直接把创作目标委派给 NAI Studio。

## 1. 职责分工
- **你（调用方）**：当好“甲方/总控”，明确传达画面主体、用途、构图留白、画幅比例（如 `16:9` / `竖图` / `1:1`）以及是否需要立刻生图（`plan_only: true/false`）。
- **NAI Studio（美术总监）**：自动读取用户审美记忆本、检索本地画师图鉴、撰写规范的 NovelAI V5 提示词并执行生图与质量护栏。

## 2. 首选调用方式（MCP）
优先调用高层单入口工具 **`nai_delegate_art_task`**：
- `brief`: 用自然语言清晰描述画面目标与约束。
- `aspect_ratio`: 可选，如 `"16:9"`、`"竖图"`、`"1:1"`。
- `plan_only`: 只需要方案/提示词时传 `true`；需要直接出图传 `false`（默认遵循工作台设置）。
- `context_id`: 多轮修改时，**务必传回上一轮返回的 `context_id`**，以便 NAI Studio 接着原配方微调，避免推倒重来。

## 3. A2A 标准接入地址
- Agent Card: `{root}/.well-known/agent-card.json`
- JSON-RPC Endpoint: `{root}/a2a`（支持 `message/send`、`message/stream`、`tasks/get`、`tasks/cancel`）
- Streamable HTTP MCP: `{root}/mcp`

## 4. 验收与防失控约定
- 收到返回的 `artifacts` 后，优先检查其中的 `file_path`（本地 PNG 路径）与 `recipe`（Prompt/Seed/参数）。
- 如果返回状态为 `input-required`，把追问转达给用户或补充明确约束后再带着同一 `context_id` 继续调用。
"""


def _extract_text_and_images_from_a2a_message(msg: Dict[str, Any]) -> Tuple[str, List[Dict[str, str]], Dict[str, Any]]:
    """Extract plain text brief, inline reference images, and optional structured options from A2A Message."""
    parts = msg.get("parts") if isinstance(msg.get("parts"), list) else []
    texts: List[str] = []
    images: List[Dict[str, str]] = []
    extra_data: Dict[str, Any] = {}

    for p in parts:
        if not isinstance(p, dict):
            continue
        kind = str(p.get("kind") or p.get("type") or "").lower()
        if kind == "text" or ("text" in p and not kind):
            t = str(p.get("text") or "").strip()
            if t:
                texts.append(t)
        elif kind == "data" and isinstance(p.get("data"), dict):
            extra_data.update(p["data"])
        elif kind == "file":
            fobj = p.get("file") if isinstance(p.get("file"), dict) else p
            mime = str(fobj.get("mimeType") or fobj.get("mime_type") or "image/png")
            b64 = str(fobj.get("bytes") or "").strip()
            if b64 and mime.startswith("image/"):
                data_url = b64 if b64.startswith("data:") else f"data:{mime};base64,{b64}"
                images.append({"name": str(fobj.get("name") or "a2a_ref.png"), "data_url": data_url})

    if not texts and isinstance(msg.get("content"), str):
        texts.append(msg["content"].strip())

    return "\n".join(texts).strip(), images[:3], extra_data


def _is_brief_too_vague(brief: str, has_history: bool, has_images: bool) -> bool:
    """Detect ultra-vague one-word briefs when there is no prior context so we ask instead of wasting credits."""
    if has_history or has_images:
        return False
    clean = re.sub(r"[\s，。！？,.!?/\\-]+", "", str(brief or ""))
    if len(clean) >= 4:
        return False
    return True


def _format_a2a_task(row: Dict[str, Any], base_url: str = "http://127.0.0.1:8780") -> Dict[str, Any]:
    """Format DB a2a_tasks row into standard A2A Task object."""
    updated_ts = int(row.get("updated_at") or 0)
    iso_ts = (
        datetime.datetime.fromtimestamp(updated_ts, tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        if updated_ts
        else _iso_now()
    )
    status_obj: Dict[str, Any] = {
        "state": str(row.get("state") or "submitted"),
        "timestamp": iso_ts,
    }
    if row.get("result_text"):
        status_obj["message"] = {
            "role": "agent",
            "messageId": f"msg_{row['id']}",
            "parts": [{"kind": "text", "text": str(row["result_text"])}],
        }
    return {
        "kind": "task",
        "id": row["id"],
        "contextId": row["context_id"],
        "status": status_obj,
        "artifacts": row.get("artifacts") or [],
        "history": row.get("history") or [],
        "metadata": row.get("metadata") or {},
    }


async def run_delegated_art_task(
    brief: str,
    *,
    context_id: Optional[str] = None,
    aspect_ratio: str = "",
    width: Optional[int] = None,
    height: Optional[int] = None,
    model: str = "",
    plan_only: Optional[bool] = None,
    reference_images: Optional[List[Dict[str, str]]] = None,
    base_url: str = "http://127.0.0.1:8780",
    source: str = "a2a",
    task_id: Optional[str] = None,
    on_status: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Core high-level delegation engine used by both A2A Server and MCP `nai_delegate_art_task`.
    Returns a dict with: task_id, context_id, state, summary, recipe, artifacts, generated_images, guardrails.
    """
    cfg = load_config()
    root = str(base_url or "http://127.0.0.1:8780").rstrip("/")
    max_images = max(1, min(4, int(cfg.get("external_agent_max_images") or 1)))
    opus_guard = bool(cfg.get("external_agent_opus_guard", True))
    allow_gen_cfg = bool(cfg.get("external_agent_allow_generate", True))
    effective_allow_gen = allow_gen_cfg and (not bool(plan_only))

    target_model = str(model or cfg.get("default_model") or "nai-diffusion-5-full").strip()
    spec = get_model_spec(target_model)
    w, h = normalize_aspect_ratio_and_size(aspect_ratio, width, height, opus_guard=opus_guard)

    tid = str(task_id or f"task_{uuid.uuid4().hex[:12]}")
    cid = str(context_id or "").strip()
    existing_sess = get_agent_session(cid) if cid else None
    has_history = bool(existing_sess and (existing_sess.get("messages") or []))

    if not existing_sess:
        sess_title = f"[{source.upper()}] {str(brief or '外部委派创作')[:30]}"
        sess = create_agent_session(sess_title)
        cid = sess["id"]

    user_msg_obj = {
        "role": "user",
        "messageId": f"usr_{uuid.uuid4().hex[:10]}",
        "parts": [{"kind": "text", "text": str(brief or "").strip()}],
    }
    guardrails_meta = {
        "source": source,
        "allow_generate": effective_allow_gen,
        "max_images": max_images,
        "opus_guard": opus_guard,
        "model": spec["id"],
        "width": w,
        "height": h,
    }

    if not get_a2a_task(tid):
        create_a2a_task(
            tid,
            cid,
            brief=str(brief or "").strip(),
            state="submitted",
            history=[user_msg_obj],
            metadata=guardrails_meta,
        )

    async def _emit(state_name: str, note: str):
        update_a2a_task(tid, state=state_name, result_text=note)
        if on_status:
            res = on_status(state_name, note)
            if asyncio.iscoroutine(res):
                await res

    # 1. Ambiguity guardrail: ask instead of hallucinating & wasting credits
    if _is_brief_too_vague(brief, has_history, bool(reference_images)):
        clarify = (
            "需求信息较简略，为避免误耗生图点数，请补充以下任一信息（携带同一 context_id 回复即可继续）：\n"
            "1. **画面主体与场景**：例如“银发少女站在黄昏天台，微风吹起发丝”；\n"
            "2. **期望画风**：例如“清透水彩 / 厚涂电影感 / 赛博霓虹”，或指定本地画师；\n"
            "3. **画幅与模式**：例如 `竖图 832x1216` / `横图 16:9`，以及是否需要立刻生图（`plan_only: false`）。"
        )
        history = [
            user_msg_obj,
            {"role": "agent", "messageId": f"agt_{uuid.uuid4().hex[:10]}", "parts": [{"kind": "text", "text": clarify}]},
        ]
        update_a2a_task(tid, state="input-required", result_text=clarify, history=history, metadata=guardrails_meta)
        return {
            "task_id": tid,
            "context_id": cid,
            "state": "input-required",
            "summary": clarify,
            "recipe": {},
            "artifacts": [],
            "generated_images": [],
            "guardrails": guardrails_meta,
        }

    await _emit("working", "NAI Studio 美术总监已接单，正在分析需求与审美记忆...")

    # 2. Prepare headless workbench context for Studio Agent
    default_steps = min(28, int(spec.get("default_steps") or 28)) if opus_guard else int(spec.get("default_steps") or 28)
    wb_state: Dict[str, Any] = {
        "model": spec["id"],
        "action": "generate",
        "width": w,
        "height": h,
        "steps": default_steps,
        "scale": float(spec.get("default_scale") or 5.0),
        "cfg_rescale": 0.0,
        "sampler": "k_euler_ancestral",
        "scheduler": "karras",
        "seed": 0,
        "seed_locked": False,
        "opus_free_guard": opus_guard,
        "stage_has_image": False,
        "blocks": {"artist": "", "character": "", "lighting": "", "negative": ""},
        "prompt": "",
        "uc": "",
    }

    directive_suffix = (
        "\n\n[外部 Agent 委派约束]"
        f"\n- 目标画幅：{w}x{h}，目标模型：{spec['short_name']} ({spec['id']})"
        f"\n- 本次允许直接生图：{'是（最多 ' + str(max_images) + ' 张）' if effective_allow_gen else '否（仅构思配方与提案，不要触发生图）'}"
        "\n- 请优先调用 patch_prompt_blocks 写入完整四区块提示词；若允许直接生图且需求明确，请调用 trigger_generate_image。"
    )

    llm_ready = bool(str(cfg.get("llm_api_key") or "").strip())
    final_text = ""
    blocks = {"artist": "", "character": "", "lighting": "", "negative": ""}
    params = {"model": spec["id"], "width": w, "height": h, "steps": default_steps, "scale": wb_state["scale"]}
    proposals: List[Dict[str, Any]] = []
    tool_trace: List[str] = []
    wants_generate = False

    if llm_ready:
        agent_mode = "agent"
        async for raw_ev in stream_studio_agent(
            session_id=cid,
            user_message=f"{brief}{directive_suffix}",
            workbench_state=wb_state,
            agent_mode=agent_mode,
            attachments=reference_images or [],
        ):
            etype = ""
            ev: Dict[str, Any] = {}
            if isinstance(raw_ev, dict):
                etype = str(raw_ev.get("type") or "")
                ev = raw_ev
            elif isinstance(raw_ev, str):
                data_lines: List[str] = []
                for ln in raw_ev.splitlines():
                    if ln.startswith("event:"):
                        etype = ln[6:].strip()
                    elif ln.startswith("data:"):
                        data_lines.append(ln[5:].strip())
                if data_lines:
                    try:
                        parsed = json.loads("\n".join(data_lines))
                        if isinstance(parsed, dict):
                            ev = parsed
                            etype = etype or str(parsed.get("type") or "")
                    except Exception:
                        continue
            if not etype:
                continue

            if etype == "delta":
                final_text += str(ev.get("text") or "")
            elif etype in ("tool_start", "tool_call"):
                tname = str(ev.get("name") or "")
                if tname:
                    tool_trace.append(tname)
                    await _emit("working", f"正在执行创作步骤：{tname}...")
            elif etype == "ui_action":
                act = ev.get("action") or {}
                atype = act.get("type")
                payload = act.get("payload") or {}
                if atype == "patch_prompt_blocks":
                    for k in ("artist", "character", "lighting", "negative"):
                        if isinstance(payload.get("blocks"), dict) and k in payload["blocks"]:
                            blocks[k] = str(payload["blocks"][k] or "").strip()
                        elif k in payload:
                            blocks[k] = str(payload[k] or "").strip()
                elif atype in ("set_workbench_params", "update_params"):
                    for pk in ("model", "width", "height", "steps", "scale", "sampler", "scheduler", "seed"):
                        if payload.get(pk) is not None:
                            params[pk] = payload[pk]
                elif atype == "load_oc_character":
                    card_obj = payload.get("card") if isinstance(payload.get("card"), dict) else {}
                    if payload.get("apply_to_character_block", True) and card_obj.get("prompt"):
                        blocks["character"] = str(card_obj["prompt"]).strip()
                elif atype == "proposals":
                    proposals = list(payload.get("proposals") or [])
                elif atype in ("trigger_generate_image", "trigger_generate"):
                    wants_generate = True
            elif etype == "error":
                final_text = final_text or f"内置 Agent 调用受限：{ev.get('message') or '未知错误'}"
    else:
        # Offline deterministic fallback when LLM key is not configured: still produces a clean linted recipe!
        mem_hint = read_creator_memory().strip()
        fav_artists = [a for a in list_artists() if a.get("favorite")][:2]
        artist_str = ", ".join(f"0.85::{a['tag']}::" for a in fav_artists) if fav_artists else ""
        linted = lint_prompt(str(brief or ""), spec["id"])
        blocks["artist"] = artist_str
        blocks["character"] = linted["fixed_prompt"] or str(brief or "").strip()
        blocks["negative"] = (spec.get("uc_presets") or {}).get("heavy", {}).get("tags", "lowres, worst quality")
        final_text = (
            "（离线配方模式：当前未配置 LLM API Key，已按 NAI V5 规范与收藏画师自动整理基础配方）\n"
            f"- 推荐模型：{spec['short_name']} ({w}x{h})\n"
            f"- 画师串：{artist_str or '未指定'}\n"
            f"- 正向词：{blocks['character']}"
            + (f"\n- 已参考审美记忆（{len(mem_hint)} 字）" if mem_hint else "")
        )

    # Assemble combined prompt & UC from blocks
    pos_parts = [blocks[k] for k in ("artist", "character", "lighting") if blocks.get(k)]
    combined_prompt = ", ".join(pos_parts).strip()
    combined_uc = blocks.get("negative", "").strip()

    # Re-apply defensive Opus guard on any updated params
    fin_w, fin_h = normalize_aspect_ratio_and_size(
        "",
        int(params.get("width") or w),
        int(params.get("height") or h),
        opus_guard=opus_guard,
    )
    fin_steps = min(28, int(params.get("steps") or default_steps)) if opus_guard else int(params.get("steps") or default_steps)
    fin_scale = float(params.get("scale") or spec.get("default_scale") or 5.0)
    fin_model = str(params.get("model") or spec["id"])

    generated_images: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []

    # 3. Optional real image generation (strictly bounded by allow_generate & max_images)
    should_generate = effective_allow_gen and wants_generate and bool(combined_prompt) and max_images >= 1
    if should_generate:
        if not str(cfg.get("api_token") or "").strip():
            final_text += "\n\n[提示] 尚未配置 NovelAI API Token，已保留完整配方未扣费出图。"
        else:
            await _emit("working", f"正在调用 NovelAI ({fin_model}, {fin_w}x{fin_h}) 生成作品...")
            try:
                gen_res = await generate_image(
                    {
                        "prompt": combined_prompt,
                        "uc": combined_uc,
                        "model": fin_model,
                        "width": fin_w,
                        "height": fin_h,
                        "steps": fin_steps,
                        "scale": fin_scale,
                        "sampler": str(params.get("sampler") or "k_euler_ancestral"),
                        "scheduler": str(params.get("scheduler") or "karras"),
                        "seed": int(params.get("seed") or 0),
                        "quality_toggle": True,
                        "uc_preset": 0,
                        "opus_free_guard": opus_guard,
                    }
                )
                rel_path = str(gen_res.get("rel_path") or gen_res.get("filename") or "")
                abs_path = str((OUTPUTS_DIR / rel_path).resolve()) if rel_path else ""
                img_url = str(gen_res.get("image_url") or (f"/outputs/{rel_path}" if rel_path else ""))
                img_record = {
                    "id": gen_res.get("id"),
                    "seed": gen_res.get("seed"),
                    "image_url": f"{root}{img_url}" if img_url.startswith("/") else img_url,
                    "file_path": abs_path,
                    "width": fin_w,
                    "height": fin_h,
                    "model": fin_model,
                }
                generated_images.append(img_record)
                artifacts.append(
                    {
                        "artifactId": f"img_{uuid.uuid4().hex[:8]}",
                        "name": "generated_image",
                        "description": f"NovelAI 生成成品图 (Seed #{gen_res.get('seed')})",
                        "parts": [
                            {
                                "kind": "file",
                                "file": {
                                    "name": Path(abs_path).name if abs_path else "artwork.png",
                                    "mimeType": "image/png",
                                    "uri": img_record["image_url"],
                                },
                            }
                        ],
                        "metadata": {"file_path": abs_path, "seed": gen_res.get("seed"), "gallery_id": gen_res.get("id")},
                    }
                )
            except Exception as exc:
                final_text += f"\n\n[生图失败] {exc}"

    recipe_obj: Dict[str, Any] = {
        "model": fin_model,
        "width": fin_w,
        "height": fin_h,
        "steps": fin_steps,
        "scale": fin_scale,
        "blocks": blocks,
        "prompt": combined_prompt,
        "uc": combined_uc,
        "proposals": proposals,
        "generated_images": generated_images,
        "tools_used": tool_trace,
    }

    artifacts.append(
        {
            "artifactId": f"rec_{uuid.uuid4().hex[:8]}",
            "name": "art_recipe",
            "description": "结构化 NovelAI 创作配方与执行结果",
            "parts": [{"kind": "data", "data": recipe_obj}],
        }
    )

    summary_text = final_text.strip() or "已完成创作规划并生成结构化配方。"
    history = [
        user_msg_obj,
        {"role": "agent", "messageId": f"agt_{uuid.uuid4().hex[:10]}", "parts": [{"kind": "text", "text": summary_text}]},
    ]
    update_a2a_task(
        tid,
        state="completed",
        result_text=summary_text,
        artifacts=artifacts,
        history=history,
        metadata={**guardrails_meta, "generated_count": len(generated_images)},
    )

    return {
        "task_id": tid,
        "context_id": cid,
        "state": "completed",
        "summary": summary_text,
        "recipe": recipe_obj,
        "artifacts": artifacts,
        "generated_images": generated_images,
        "guardrails": guardrails_meta,
    }


async def handle_a2a_jsonrpc(body: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    """Handle standard A2A JSON-RPC 2.0 requests (message/send, tasks/get, tasks/cancel, tasks/list)."""
    req_id = body.get("id")
    method = str(body.get("method") or "").strip()
    params = body.get("params") if isinstance(body.get("params"), dict) else {}

    def _ok(result: Any) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": req_id, "result": result}

    def _err(code: int, message: str) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}

    if method in ("message/send", "tasks/send"):
        msg = params.get("message") if isinstance(params.get("message"), dict) else {}
        brief, ref_images, extra = _extract_text_and_images_from_a2a_message(msg)
        meta = params.get("metadata") if isinstance(params.get("metadata"), dict) else {}
        merged_opts = {**meta, **extra}
        context_id = str(msg.get("contextId") or params.get("contextId") or "").strip() or None
        task_id = str(msg.get("taskId") or params.get("id") or "").strip() or None

        res = await run_delegated_art_task(
            brief=brief,
            context_id=context_id,
            aspect_ratio=str(merged_opts.get("aspect_ratio") or ""),
            width=merged_opts.get("width"),
            height=merged_opts.get("height"),
            model=str(merged_opts.get("model") or ""),
            plan_only=merged_opts.get("plan_only"),
            reference_images=ref_images,
            base_url=base_url,
            source="a2a",
            task_id=task_id,
        )
        row = get_a2a_task(res["task_id"])
        return _ok(_format_a2a_task(row, base_url))

    if method == "tasks/get":
        tid = str(params.get("id") or params.get("taskId") or "").strip()
        row = get_a2a_task(tid) if tid else None
        if not row:
            return _err(-32001, f"Task not found: {tid}")
        return _ok(_format_a2a_task(row, base_url))

    if method == "tasks/cancel":
        tid = str(params.get("id") or params.get("taskId") or "").strip()
        row = get_a2a_task(tid) if tid else None
        if not row:
            return _err(-32001, f"Task not found: {tid}")
        if row["state"] in ("completed", "failed", "canceled"):
            return _ok(_format_a2a_task(row, base_url))
        updated = update_a2a_task(tid, state="canceled", result_text="任务已由外部 Agent 取消")
        return _ok(_format_a2a_task(updated or row, base_url))

    if method == "tasks/list":
        limit = int(params.get("limit") or 20)
        rows = list_a2a_tasks(limit=limit)
        return _ok({"tasks": [_format_a2a_task(r, base_url) for r in rows], "total": len(rows)})

    return _err(-32601, f"Method not found: {method}")


async def stream_a2a_jsonrpc_sse(body: Dict[str, Any], base_url: str) -> AsyncGenerator[str, None]:
    """Stream A2A `message/stream` JSON-RPC 2.0 events over Server-Sent Events (SSE)."""
    req_id = body.get("id")
    params = body.get("params") if isinstance(body.get("params"), dict) else {}
    msg = params.get("message") if isinstance(params.get("message"), dict) else {}
    brief, ref_images, extra = _extract_text_and_images_from_a2a_message(msg)
    meta = params.get("metadata") if isinstance(params.get("metadata"), dict) else {}
    merged_opts = {**meta, **extra}
    context_id = str(msg.get("contextId") or params.get("contextId") or "").strip() or None
    task_id = str(msg.get("taskId") or params.get("id") or f"task_{uuid.uuid4().hex[:12]}").strip()

    queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue()

    async def _on_status(state_name: str, note: str):
        await queue.put(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "kind": "status-update",
                    "taskId": task_id,
                    "contextId": context_id or "",
                    "final": False,
                    "status": {
                        "state": state_name,
                        "timestamp": _iso_now(),
                        "message": {"role": "agent", "parts": [{"kind": "text", "text": note}]},
                    },
                },
            }
        )

    async def _runner():
        try:
            res = await run_delegated_art_task(
                brief=brief,
                context_id=context_id,
                aspect_ratio=str(merged_opts.get("aspect_ratio") or ""),
                width=merged_opts.get("width"),
                height=merged_opts.get("height"),
                model=str(merged_opts.get("model") or ""),
                plan_only=merged_opts.get("plan_only"),
                reference_images=ref_images,
                base_url=base_url,
                source="a2a-stream",
                task_id=task_id,
                on_status=_on_status,
            )
            for art in res.get("artifacts") or []:
                await queue.put(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "kind": "artifact-update",
                            "taskId": res["task_id"],
                            "contextId": res["context_id"],
                            "artifact": art,
                        },
                    }
                )
            await queue.put(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "kind": "status-update",
                        "taskId": res["task_id"],
                        "contextId": res["context_id"],
                        "final": True,
                        "status": {
                            "state": res["state"],
                            "timestamp": _iso_now(),
                            "message": {"role": "agent", "parts": [{"kind": "text", "text": res["summary"]}]},
                        },
                    },
                }
            )
        except Exception as exc:
            await queue.put(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(exc)},
                }
            )
        finally:
            await queue.put(None)

    runner_task = asyncio.create_task(_runner())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
    finally:
        if not runner_task.done():
            runner_task.cancel()
