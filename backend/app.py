import base64
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import io
from PIL import Image, ImageOps

from .config import ARTISTS_DIR, BASE_DIR, DATA_DIR, FRONTEND_DIR, OUTPUTS_DIR, load_config, mask_token, save_config
from .database import (
    add_mix_preset,
    add_snippet,
    batch_delete_gallery,
    batch_favorite_gallery,
    count_gallery,
    create_agent_session,
    delete_agent_session,
    delete_artist,
    delete_gallery_item,
    delete_mix_preset,
    delete_oc_card,
    delete_snippet,
    get_agent_session,
    get_gallery_item,
    init_db,
    list_agent_sessions,
    list_artists,
    list_gallery,
    list_mix_presets,
    list_oc_cards,
    list_snippets,
    save_oc_card,
    sync_outputs_folder,
    toggle_artist_favorite,
    toggle_gallery_favorite,
    update_artist,
    update_gallery_notes,
    update_oc_avatar,
    upsert_artist,
)
from .models_spec import DIRECTOR_EMOTIONS, MODELS_CATALOG, RESOLUTIONS, estimate_generation_cost, get_model_spec
from .nai_client import (
    augment_image,
    fetch_account_status,
    generate_artist_preview_card,
    generate_image,
    get_queue_status,
    parse_vibe_bundle,
    start_roll_queue,
    stop_queue,
    suggest_tags_hybrid,
)
from .png_metadata import extract_nai_metadata
from .prompt_agent import fetch_llm_models, run_prompt_agent, test_llm_connection
from .skills_manager import delete_skill, ensure_builtin_skills, get_skill, list_skills, save_skill
from .studio_agent import stream_studio_agent
from .mcp_tools import MCP_EXAMPLE_ARGS, MCP_TOOLS, execute_mcp_tool
from .prompt_engine import (
    adjust_tag_weight,
    delete_wildcard_file,
    expand_dynamic_prompt,
    get_wildcard_detail,
    lint_prompt,
    list_wildcards,
    save_wildcard_file,
)

OC_AVATARS_DIR = DATA_DIR / "oc_avatars"
OC_AVATARS_DIR.mkdir(parents=True, exist_ok=True)

init_db()
ensure_builtin_skills()

app = FastAPI(title="NAI Studio — Liquid Glass Workbench API", version="2.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_storage_stats() -> Dict[str, Any]:
    out_files = list(OUTPUTS_DIR.rglob("*.png"))
    art_files = list(ARTISTS_DIR.rglob("*.png"))
    total_bytes = sum(f.stat().st_size for f in out_files + art_files if f.exists())
    return {
        "base_dir": str(BASE_DIR),
        "output_dir": str(OUTPUTS_DIR),
        "drive": BASE_DIR.drive,
        "c_drive_used_bytes": 0,
        "gallery_png_count": len(out_files),
        "artist_card_count": len(art_files),
        "total_size_mb": round(total_bytes / (1024 * 1024), 2),
    }


def _sanitize_config_for_client(cfg: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(cfg)
    out["api_token_masked"] = mask_token(cfg.get("api_token", ""))
    out["llm_api_key_masked"] = mask_token(cfg.get("llm_api_key", ""))
    # Never echo raw secret keys to frontend state
    out.pop("api_token", None)
    out.pop("llm_api_key", None)
    return out


@app.get("/api/bootstrap")
async def api_bootstrap(fast: bool = False) -> Dict[str, Any]:
    cfg = load_config()
    account = {"connected": False, "checking": True} if fast else await fetch_account_status(cfg)
    safe_cfg = _sanitize_config_for_client(cfg)
    return {
        "config": safe_cfg,
        "models": MODELS_CATALOG,
        "resolutions": RESOLUTIONS,
        "emotions": DIRECTOR_EMOTIONS,
        "account": account,
        "gallery": list_gallery(limit=24, offset=0),
        "gallery_total": count_gallery(),
        "artists": list_artists(),
        "mix_presets": list_mix_presets(),
        "snippets": list_snippets(),
        "oc_cards": list_oc_cards(),
        "wildcards": list_wildcards(),
        "skills": list_skills(include_content=False),
        "agent_sessions": list_agent_sessions(limit=16),
        "queue": get_queue_status(),
        "storage": _get_storage_stats(),
    }


@app.get("/api/models")
async def api_models() -> Dict[str, Any]:
    return {"models": MODELS_CATALOG, "resolutions": RESOLUTIONS}


@app.get("/api/account")
async def api_account() -> Dict[str, Any]:
    cfg = load_config()
    return await fetch_account_status(cfg)


@app.post("/api/config")
async def api_update_config(body: Dict[str, Any]) -> Dict[str, Any]:
    cfg = load_config()
    account_check_needed = False
    for k in (
        "api_token",
        "base_url",
        "default_model",
        "opus_free_guard",
        "auto_quality_tags",
        "default_uc_preset",
        "output_dir",
        "theme",
        "bg_hex",
        "bg_preset_name",
        "glass_clarity",
        "prompt_workspace_mode",
        "llm_base_url",
        "llm_api_key",
        "llm_model",
        "llm_use_knowledge_agent",
        "llm_context_tokens",
        "llm_max_output_tokens",
    ):
        if k in body and body[k] is not None:
            if k in ("api_token", "llm_api_key") and "..." in str(body[k]):
                continue
            if k in ("api_token", "output_dir"):
                account_check_needed = True
            if k == "llm_context_tokens":
                try:
                    cfg[k] = max(8000, min(1000000, int(body[k])))
                except Exception:
                    continue
                continue
            if k == "llm_max_output_tokens":
                try:
                    cfg[k] = max(2048, min(128000, int(body[k])))
                except Exception:
                    continue
                continue
            cfg[k] = body[k]
    saved = save_config(cfg)
    account = await fetch_account_status(saved) if account_check_needed and not body.get("skip_account_check") else None
    resp: Dict[str, Any] = {
        "config": _sanitize_config_for_client(saved),
        "storage": _get_storage_stats(),
    }
    if account is not None:
        resp["account"] = account
    return resp


@app.post("/api/llm/models")
async def api_llm_models(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    b = body or {}
    try:
        return await fetch_llm_models(
            base_url=b.get("llm_base_url"),
            api_key=b.get("llm_api_key"),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/llm/test")
async def api_llm_test(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    b = body or {}
    try:
        return await test_llm_connection(
            base_url=b.get("llm_base_url"),
            api_key=b.get("llm_api_key"),
            model=b.get("llm_model"),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/prompt/agent")
async def api_prompt_agent(body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return await run_prompt_agent(
            instruction=str(body.get("instruction") or ""),
            model_id=str(body.get("model") or "nai-diffusion-5-full"),
            scope=str(body.get("scope") or "all"),
            existing_blocks=body.get("existing_blocks") if isinstance(body.get("existing_blocks"), dict) else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ================= Studio Agent Sessions, Streaming & Skills =================
@app.get("/api/agent/sessions")
async def api_agent_sessions() -> Dict[str, Any]:
    return {"sessions": list_agent_sessions(limit=24)}


@app.post("/api/agent/sessions")
async def api_create_agent_session(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    b = body or {}
    sess = create_agent_session(
        title=str(b.get("title") or "新创作对话"),
        pinned_skills=b.get("pinned_skills") if isinstance(b.get("pinned_skills"), list) else [],
    )
    return {"ok": True, "session": sess}


@app.get("/api/agent/sessions/{session_id}")
async def api_get_agent_session(session_id: str) -> Dict[str, Any]:
    sess = get_agent_session(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="对话会话不存在")
    return {"ok": True, "session": sess}


@app.delete("/api/agent/sessions/{session_id}")
async def api_delete_agent_session(session_id: str) -> Dict[str, Any]:
    ok = delete_agent_session(session_id)
    return {"ok": ok}


@app.post("/api/agent/chat/stream")
async def api_agent_chat_stream(body: Dict[str, Any]) -> StreamingResponse:
    msg = str(body.get("message") or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="请输入对话内容")
    session_id = str(body.get("session_id") or "").strip() or None
    wb_state = body.get("workbench_state") if isinstance(body.get("workbench_state"), dict) else {}
    pinned = body.get("pinned_skills") if isinstance(body.get("pinned_skills"), list) else None
    return StreamingResponse(
        stream_studio_agent(
            user_message=msg,
            session_id=session_id,
            workbench_state=wb_state,
            pinned_skills=pinned,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/agent/skills")
async def api_list_agent_skills(include_content: bool = False) -> Dict[str, Any]:
    return {"skills": list_skills(include_content=include_content)}


@app.get("/api/agent/skills/{name}")
async def api_get_agent_skill(name: str) -> Dict[str, Any]:
    sk = get_skill(name)
    if not sk:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' 不存在")
    return {"ok": True, "skill": sk}


@app.post("/api/agent/skills")
async def api_save_agent_skill(body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        sk = save_skill(
            name=str(body.get("name") or ""),
            title=str(body.get("title") or ""),
            description=str(body.get("description") or ""),
            content=str(body.get("content") or ""),
            triggers=str(body.get("triggers") or ""),
        )
        return {"ok": True, "skill": sk}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/agent/skills/{name}")
async def api_delete_agent_skill(name: str) -> Dict[str, Any]:
    try:
        ok = delete_skill(name)
        if not ok:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/prompt/lint")
async def api_prompt_lint(body: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(body.get("prompt") or "")
    model_id = str(body.get("model") or "nai-diffusion-5-full")
    return lint_prompt(prompt, model_id)


@app.post("/api/prompt/weight")
async def api_prompt_weight(body: Dict[str, Any]) -> Dict[str, Any]:
    token = str(body.get("token") or "")
    delta = int(body.get("delta") or 1)
    mode = str(body.get("mode") or "brackets")
    model_id = str(body.get("model") or "nai-diffusion-5-full")
    adjusted = adjust_tag_weight(token, delta, mode, model_id)
    return {"original": token, "adjusted": adjusted, "mode": mode}


@app.post("/api/prompt/expand")
async def api_prompt_expand(body: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(body.get("prompt") or "")
    seed = body.get("seed")
    return expand_dynamic_prompt(prompt, seed=int(seed) if seed is not None else None)


@app.get("/api/wildcards")
async def api_list_wildcards() -> Dict[str, Any]:
    return {"wildcards": list_wildcards()}


@app.get("/api/wildcards/{name}")
async def api_get_wildcard(name: str) -> Dict[str, Any]:
    try:
        return {"ok": True, **get_wildcard_detail(name)}
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/api/wildcards")
async def api_save_wildcard(body: Dict[str, Any]) -> Dict[str, Any]:
    name = str(body.get("name") or "").strip()
    content = str(body.get("content") or "")
    try:
        saved = save_wildcard_file(name, content)
        return {"ok": True, **saved, "wildcards": list_wildcards()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/wildcards/{name}")
async def api_delete_wildcard(name: str) -> Dict[str, Any]:
    ok = delete_wildcard_file(name)
    return {"ok": ok, "wildcards": list_wildcards()}


@app.get("/api/snippets")
async def api_list_snippets() -> Dict[str, Any]:
    return {"snippets": list_snippets()}


@app.post("/api/snippets")
async def api_create_snippet(body: Dict[str, Any]) -> Dict[str, Any]:
    label = str(body.get("label") or "").strip()
    tags = str(body.get("tags") or "").strip()
    cat = str(body.get("cat") or "custom").strip()
    if not label or not tags:
        raise HTTPException(status_code=400, detail="请填写常用词组名称和对应 Tags")
    return {"ok": True, "snippet": add_snippet(label, tags, cat)}


@app.delete("/api/snippets/{snippet_id}")
async def api_delete_snippet(snippet_id: int) -> Dict[str, Any]:
    return {"ok": delete_snippet(snippet_id)}


@app.get("/api/oc-cards")
async def api_list_oc_cards() -> Dict[str, Any]:
    return {"oc_cards": list_oc_cards()}


@app.post("/api/oc-cards")
async def api_save_oc_card(body: Dict[str, Any]) -> Dict[str, Any]:
    name = str(body.get("name") or "").strip()
    prompt = str(body.get("prompt") or "").strip()
    if not name or not prompt:
        raise HTTPException(status_code=400, detail="OC 名称与角色 Prompt 不能为空")
    card = save_oc_card(
        name=name,
        prompt=prompt,
        uc=str(body.get("uc") or "").strip(),
        avatar_url=str(body.get("avatar_url") or "").strip(),
        default_x=float(body.get("default_x") if body.get("default_x") is not None else 0.5),
        default_y=float(body.get("default_y") if body.get("default_y") is not None else 0.5),
    )
    return {"ok": True, "card": card}


@app.delete("/api/oc-cards/{card_id}")
async def api_delete_oc_card(card_id: int) -> Dict[str, Any]:
    return {"ok": delete_oc_card(card_id)}


@app.post("/api/oc-cards/{card_id}/avatar")
async def api_set_oc_avatar(card_id: int, body: Dict[str, Any]) -> Dict[str, Any]:
    image_b64 = str(body.get("image_b64") or "").strip()
    image_url = str(body.get("image_url") or "").strip()
    if image_b64:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        raw = base64.b64decode(image_b64)
        im = ImageOps.fit(Image.open(io.BytesIO(raw)).convert("RGB"), (192, 192), Image.Resampling.LANCZOS)
        fname = f"oc_{card_id}_{int(__import__('time').time())}.jpg"
        (OC_AVATARS_DIR / fname).write_bytes(b"")
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=88)
        (OC_AVATARS_DIR / fname).write_bytes(buf.getvalue())
        avatar_url = f"/avatars/{fname}"
    elif image_url:
        avatar_url = image_url
    else:
        raise HTTPException(status_code=400, detail="请提供头像图片或图库地址")
    updated = update_oc_avatar(card_id, avatar_url)
    if not updated:
        raise HTTPException(status_code=404, detail="OC 角色卡不存在")
    return {"ok": True, "card": updated}


@app.get("/api/tags/suggest")
async def api_tags_suggest(
    q: str = Query("", description="Chinese or English tag query"),
    model: str = Query("nai-diffusion-5-full", description="Model ID"),
) -> Dict[str, Any]:
    items = await suggest_tags_hybrid(q, model)
    return {"query": q, "model": model, "tags": items}


@app.post("/api/estimate-cost")
async def api_estimate_cost(body: Dict[str, Any]) -> Dict[str, Any]:
    return estimate_generation_cost(
        model_id=str(body.get("model") or "nai-diffusion-5-full"),
        width=int(body.get("width") or 832),
        height=int(body.get("height") or 1216),
        steps=int(body.get("steps") or 28),
        n_samples=int(body.get("n_samples") or 1),
        has_vibe_raw_encode=bool(body.get("has_vibe_raw_encode")),
        vibe_count=int(body.get("vibe_count") or 0),
        has_precise_ref=bool(body.get("has_precise_ref")),
        is_opus=True,
    )


def _log_api_error(endpoint: str, body: Dict[str, Any], exc: Exception) -> int:
    status_code = getattr(exc, "status_code", 400)
    model = body.get("model", "")
    action = body.get("action") or body.get("req_type") or ""
    dims = f"{body.get('width', '?')}x{body.get('height', '?')}"
    steps = body.get("steps", "?")
    line = f"[NAI-API ERROR] endpoint={endpoint} status={status_code} model={model} action={action} size={dims} steps={steps} detail={exc}\n"
    print(line, flush=True)
    try:
        err_log = Path(__file__).resolve().parent.parent / "tmp" / "api_errors.log"
        err_log.parent.mkdir(parents=True, exist_ok=True)
        with err_log.open("a", encoding="utf-8") as fh:
            import datetime
            fh.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {line}")
    except Exception:
        pass
    return status_code


@app.post("/api/generate")
async def api_generate(body: Dict[str, Any]) -> Dict[str, Any]:
    cfg = load_config()
    try:
        item = await generate_image(body, cfg)
        account = await fetch_account_status(cfg)
        return {"ok": True, "item": item, "account": account, "storage": _get_storage_stats()}
    except Exception as exc:
        code = _log_api_error("/api/generate", body, exc)
        raise HTTPException(status_code=code, detail=str(exc))


@app.post("/api/augment")
async def api_augment(body: Dict[str, Any]) -> Dict[str, Any]:
    cfg = load_config()
    try:
        item = await augment_image(body, cfg)
        account = await fetch_account_status(cfg)
        return {"ok": True, "item": item, "account": account, "storage": _get_storage_stats()}
    except Exception as exc:
        code = _log_api_error("/api/augment", body, exc)
        raise HTTPException(status_code=code, detail=str(exc))


@app.post("/api/vibe/parse")
async def api_vibe_parse(file: UploadFile = File(...), model: str = "nai-diffusion-4-5-full") -> Dict[str, Any]:
    raw = await file.read()
    fname = (file.filename or "").lower()
    if fname.endswith(".naiv4vibe") or fname.endswith(".naiv4vibebundle") or fname.endswith(".json"):
        try:
            parsed = parse_vibe_bundle(raw, model)
            return {"ok": True, "type": "encoded_vibe", "anlas_cost": 0, **parsed}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"解析 .naiv4vibe 文件失败: {exc}")
    else:
        # Image uploaded for Vibe
        spec = get_model_spec(model)
        b64 = base64.b64encode(raw).decode()
        return {
            "ok": True,
            "type": "raw_image",
            "anlas_cost": 0 if spec["vibe_raw_image_free"] else 2,
            "vibes": [{"raw_image": b64, "strength": 0.6, "ie": 0.7}],
        }


@app.post("/api/png/inspect")
async def api_png_inspect(file: Optional[UploadFile] = File(None), body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        if file is not None:
            raw_bytes = await file.read()
        elif body and body.get("image_b64"):
            b64_str = str(body["image_b64"])
            if "," in b64_str:
                b64_str = b64_str.split(",", 1)[1]
            raw_bytes = base64.b64decode(b64_str)
        else:
            raise ValueError("未提供 PNG 文件或 base64 数据")
        meta = extract_nai_metadata(raw_bytes)
        return {"ok": True, "metadata": meta}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"读取 PNG 配方信息失败: {exc}")


@app.post("/api/png/inspect-b64")
async def api_png_inspect_b64(body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        b64_str = str(body.get("image_b64") or "")
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        raw_bytes = base64.b64decode(b64_str)
        meta = extract_nai_metadata(raw_bytes)
        return {"ok": True, "metadata": meta}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"读取 PNG 配方信息失败: {exc}")


@app.get("/api/gallery")
async def api_list_gallery(
    search: str = "",
    model: str = "",
    favorite_only: bool = False,
    sort: str = "newest",
    limit: int = 24,
    offset: int = 0,
) -> Dict[str, Any]:
    items = list_gallery(search=search, model=model, favorite_only=favorite_only, sort=sort, limit=limit, offset=offset)
    total = count_gallery(search=search, model=model, favorite_only=favorite_only)
    return {
        "items": items,
        "total": total,
        "offset": max(0, int(offset)),
        "limit": max(1, int(limit)),
        "has_more": (max(0, int(offset)) + len(items)) < total,
    }


@app.post("/api/gallery/{item_id}/favorite")
async def api_fav_gallery(item_id: int) -> Dict[str, Any]:
    item = toggle_gallery_favorite(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="未找到该图库记录")
    return {"ok": True, "item": item}


@app.delete("/api/gallery/{item_id}")
async def api_del_gallery(item_id: int, delete_file: bool = True) -> Dict[str, Any]:
    ok = delete_gallery_item(item_id, delete_file=delete_file)
    return {"ok": ok, "total": count_gallery(), "storage": _get_storage_stats()}


@app.patch("/api/gallery/{item_id}")
async def api_patch_gallery(item_id: int, body: Dict[str, Any]) -> Dict[str, Any]:
    notes = str(body.get("notes") or "")
    item = update_gallery_notes(item_id, notes)
    if not item:
        raise HTTPException(status_code=404, detail="未找到该图库记录")
    return {"ok": True, "item": item}


@app.post("/api/gallery/sync")
async def api_sync_gallery() -> Dict[str, Any]:
    res = sync_outputs_folder(OUTPUTS_DIR, prune_missing=True)
    total = count_gallery()
    return {"ok": True, **res, "total": total, "storage": _get_storage_stats(), "items": list_gallery(limit=24, offset=0)}


@app.post("/api/gallery/batch-delete")
async def api_batch_del_gallery(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    b = body or {}
    ids = b.get("ids") if isinstance(b.get("ids"), list) else None
    unfav_only = bool(b.get("unfav_only", True))
    delete_file = bool(b.get("delete_file", True))
    removed = batch_delete_gallery(unfav_only=unfav_only, delete_file=delete_file, ids=ids)
    return {"ok": True, "removed": removed, "total": count_gallery(), "storage": _get_storage_stats()}


@app.post("/api/gallery/batch-favorite")
async def api_batch_fav_gallery(body: Dict[str, Any]) -> Dict[str, Any]:
    ids = body.get("ids") if isinstance(body.get("ids"), list) else []
    favorite = bool(body.get("favorite", True))
    updated = batch_favorite_gallery(ids, favorite=favorite)
    return {"ok": True, "updated": updated}


@app.post("/api/queue/start")
async def api_queue_start(body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        st = await start_roll_queue(body)
        return {"ok": True, "queue": st}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/queue/stop")
async def api_queue_stop() -> Dict[str, Any]:
    return {"ok": True, "queue": stop_queue()}


@app.get("/api/queue/status")
async def api_queue_status() -> Dict[str, Any]:
    q = get_queue_status()
    resp: Dict[str, Any] = {
        "ok": True,
        "queue": q,
        "gallery": list_gallery(limit=24, offset=0),
        "gallery_total": count_gallery(),
        "storage": _get_storage_stats(),
    }
    if q.get("queue_kind") == "artist_backfill":
        resp["artists"] = list_artists()
    return resp


@app.get("/api/artists")
async def api_get_artists(
    search: str = "",
    category: str = "",
    favorite_only: bool = False,
    style_tag: str = "",
) -> Dict[str, Any]:
    return {
        "artists": list_artists(
            search=search,
            category=category,
            favorite_only=favorite_only,
            style_tag=style_tag,
        )
    }


@app.post("/api/artists")
async def api_create_artist(body: Dict[str, Any]) -> Dict[str, Any]:
    tag = str(body.get("tag") or "").strip()
    if not tag:
        raise HTTPException(status_code=400, detail="请输入画师 Tag（如 artist:ask_(askzy)）")
    artist = upsert_artist(
        name=str(body.get("name") or ""),
        tag=tag,
        category=str(body.get("category") or "私人收藏"),
        desc=str(body.get("desc") or ""),
        sample_tags=str(body.get("sample_tags") or ""),
        is_custom=True,
        style_tags=body.get("style_tags"),
        post_count=int(body.get("post_count") or 0),
        weight_hint=str(body.get("weight_hint") or ""),
        aliases=str(body.get("aliases") or ""),
        urls=body.get("urls"),
        notes=str(body.get("notes") or ""),
    )
    if body.get("generate_preview", True):
        try:
            artist = await generate_artist_preview_card(
                artist_id=artist["id"],
                tag=artist["tag"],
                sample_tags=artist.get("sample_tags", ""),
                model_id=str(body.get("model") or "nai-diffusion-4-5-full"),
            )
        except Exception as exc:
            return {"ok": True, "artist": artist, "preview_warning": str(exc)}
    return {"ok": True, "artist": artist}


@app.post("/api/artists/{artist_id}/favorite")
async def api_fav_artist(artist_id: int) -> Dict[str, Any]:
    artist = toggle_artist_favorite(artist_id)
    if not artist:
        raise HTTPException(status_code=404, detail="画师不存在")
    return {"ok": True, "artist": artist}


@app.patch("/api/artists/{artist_id}")
async def api_patch_artist(artist_id: int, body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        updated = update_artist(
            artist_id,
            name=body.get("name"),
            tag=body.get("tag"),
            category=body.get("category"),
            desc=body.get("desc"),
            sample_tags=body.get("sample_tags"),
            style_tags=body.get("style_tags"),
            post_count=body.get("post_count"),
            weight_hint=body.get("weight_hint"),
            aliases=body.get("aliases"),
            urls=body.get("urls"),
            notes=body.get("notes"),
        )
    except Exception as exc:
        msg = "该画师 Tag 已存在，请勿与现有画师重复" if "UNIQUE" in str(exc).upper() else str(exc)
        raise HTTPException(status_code=400, detail=msg)
    if not updated:
        raise HTTPException(status_code=404, detail="画师不存在")
    return {"ok": True, "artist": updated}


@app.delete("/api/artists/{artist_id}")
async def api_del_artist(artist_id: int) -> Dict[str, Any]:
    ok = delete_artist(artist_id)
    if not ok:
        raise HTTPException(status_code=404, detail="画师不存在")
    return {"ok": True}


@app.post("/api/artists/{artist_id}/generate-preview")
async def api_gen_artist_preview(artist_id: int, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    artists = [a for a in list_artists() if a["id"] == artist_id]
    if not artists:
        raise HTTPException(status_code=404, detail="画师不存在")
    a = artists[0]
    model_id = str((body or {}).get("model") or "nai-diffusion-4-5-full")
    try:
        updated = await generate_artist_preview_card(artist_id, a["tag"], a.get("sample_tags", ""), model_id=model_id)
        return {"ok": True, "artist": updated}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/mix-presets")
async def api_get_mix_presets() -> Dict[str, Any]:
    return {"presets": list_mix_presets()}


@app.post("/api/mix-presets")
async def api_create_mix_preset(body: Dict[str, Any]) -> Dict[str, Any]:
    name = str(body.get("name") or "").strip()
    items = body.get("items") or []
    if not name or not items:
        raise HTTPException(status_code=400, detail="请输入混搭方案名称并至少选择一位画师")
    preset = add_mix_preset(name, items)
    return {"ok": True, "preset": preset}


@app.delete("/api/mix-presets/{preset_id}")
async def api_del_mix_preset(preset_id: int) -> Dict[str, Any]:
    return {"ok": delete_mix_preset(preset_id)}


@app.get("/api/mcp/info")
async def api_mcp_info() -> Dict[str, Any]:
    server_script = str((BASE_DIR / "mcp_server.py").resolve())
    python_exe = str(Path(sys.executable).resolve())
    return {
        "server_name": "nai-studio-mcp",
        "server_version": "2.3.0",
        "protocol_version": "2024-11-05",
        "python_executable": python_exe,
        "server_script": server_script,
        "tool_count": len(MCP_TOOLS),
        "tools": MCP_TOOLS,
        "example_args": MCP_EXAMPLE_ARGS,
        "client_config": {
            "mcpServers": {
                "nai-studio": {
                    "command": python_exe,
                    "args": [server_script],
                    "env": {"PYTHONUTF8": "1"},
                }
            }
        },
    }


@app.post("/api/mcp/test")
async def api_mcp_test(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes an MCP tool call directly from the UI via the shared MCP dispatcher.
    """
    tool_name = str(body.get("tool") or "nai_account_status")
    args = body.get("arguments") or {}
    if not isinstance(args, dict):
        raise HTTPException(status_code=400, detail="arguments 必须为 JSON 对象")
    try:
        result = await execute_mcp_tool(tool_name, args)
        return {"tool": tool_name, "ok": True, "result": result}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/artists", StaticFiles(directory=str(ARTISTS_DIR)), name="artists")
app.mount("/avatars", StaticFiles(directory=str(OC_AVATARS_DIR)), name="avatars")
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))
