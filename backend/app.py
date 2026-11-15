import base64
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import io
from PIL import Image, ImageOps

from .config import ARTISTS_DIR, BASE_DIR, DATA_DIR, FRONTEND_DIR, OUTPUTS_DIR, load_config, mask_token, save_config
from .database import (
    add_mix_preset,
    add_snippet,
    batch_delete_gallery,
    count_gallery,
    delete_gallery_item,
    delete_mix_preset,
    delete_oc_card,
    delete_snippet,
    get_gallery_item,
    init_db,
    list_artists,
    list_gallery,
    list_mix_presets,
    list_oc_cards,
    list_snippets,
    save_oc_card,
    sync_outputs_folder,
    toggle_artist_favorite,
    toggle_gallery_favorite,
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


@app.get("/api/bootstrap")
async def api_bootstrap(fast: bool = False) -> Dict[str, Any]:
    cfg = load_config()
    account = {"connected": False, "checking": True} if fast else await fetch_account_status(cfg)
    safe_cfg = {**cfg, "api_token_masked": mask_token(cfg.get("api_token", ""))}
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
    ):
        if k in body and body[k] is not None:
            if k == "api_token" and "..." in str(body[k]):
                continue
            cfg[k] = body[k]
    saved = save_config(cfg)
    account = await fetch_account_status(saved)
    return {
        "config": {**saved, "api_token_masked": mask_token(saved.get("api_token", ""))},
        "account": account,
        "storage": _get_storage_stats(),
    }


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


@app.post("/api/generate")
async def api_generate(body: Dict[str, Any]) -> Dict[str, Any]:
    cfg = load_config()
    try:
        item = await generate_image(body, cfg)
        account = await fetch_account_status(cfg)
        return {"ok": True, "item": item, "account": account, "storage": _get_storage_stats()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/augment")
async def api_augment(body: Dict[str, Any]) -> Dict[str, Any]:
    cfg = load_config()
    try:
        item = await augment_image(body, cfg)
        account = await fetch_account_status(cfg)
        return {"ok": True, "item": item, "account": account, "storage": _get_storage_stats()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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
    limit: int = 24,
    offset: int = 0,
) -> Dict[str, Any]:
    items = list_gallery(search=search, model=model, favorite_only=favorite_only, limit=limit, offset=offset)
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
    return {"ok": ok, "storage": _get_storage_stats()}


@app.patch("/api/gallery/{item_id}")
async def api_patch_gallery(item_id: int, body: Dict[str, Any]) -> Dict[str, Any]:
    notes = str(body.get("notes") or "")
    item = update_gallery_notes(item_id, notes)
    if not item:
        raise HTTPException(status_code=404, detail="未找到该图库记录")
    return {"ok": True, "item": item}


@app.post("/api/gallery/sync")
async def api_sync_gallery() -> Dict[str, Any]:
    res = sync_outputs_folder(OUTPUTS_DIR)
    total = count_gallery()
    return {"ok": True, **res, "total": total, "storage": _get_storage_stats(), "items": list_gallery(limit=24, offset=0)}


@app.post("/api/gallery/batch-delete")
async def api_batch_del_gallery(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    b = body or {}
    unfav_only = bool(b.get("unfav_only", True))
    delete_file = bool(b.get("delete_file", True))
    removed = batch_delete_gallery(unfav_only=unfav_only, delete_file=delete_file)
    return {"ok": True, "removed": removed, "storage": _get_storage_stats()}


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
async def api_get_artists(search: str = "", category: str = "", favorite_only: bool = False) -> Dict[str, Any]:
    return {"artists": list_artists(search=search, category=category, favorite_only=favorite_only)}


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


@app.post("/api/mcp/test")
async def api_mcp_test(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes an MCP tool call directly from the UI so users can test Agent integration live.
    """
    tool_name = str(body.get("tool") or "nai_account_status")
    args = body.get("arguments") or {}
    cfg = load_config()
    if tool_name == "nai_account_status":
        return {"tool": tool_name, "result": await fetch_account_status(cfg)}
    elif tool_name == "nai_lint_and_format_prompt":
        return {"tool": tool_name, "result": lint_prompt(str(args.get("prompt") or ""), str(args.get("model") or "nai-diffusion-5-full"))}
    elif tool_name == "nai_search_tags":
        return {"tool": tool_name, "result": await suggest_tags_hybrid(str(args.get("query") or "白发"), str(args.get("model") or "nai-diffusion-5-full"), cfg)}
    elif tool_name == "nai_list_artists":
        return {"tool": tool_name, "result": list_artists(search=str(args.get("search") or ""), category=str(args.get("category") or ""))}
    elif tool_name == "nai_query_gallery":
        return {"tool": tool_name, "result": list_gallery(search=str(args.get("search") or ""), limit=int(args.get("limit") or 10))}
    elif tool_name == "nai_generate_image":
        item = await generate_image(args, cfg)
        return {"tool": tool_name, "result": item}
    elif tool_name == "nai_inspect_png":
        fpath = str(args.get("file_path") or "").strip()
        if fpath:
            p = Path(fpath)
            if not p.is_absolute():
                p = BASE_DIR / p
            if not p.exists():
                raise HTTPException(status_code=404, detail=f"文件不存在: {p}")
            return {"tool": tool_name, "result": extract_nai_metadata(p.read_bytes())}
        latest = list_gallery(limit=1)
        if not latest:
            return {"tool": tool_name, "result": {"info": "图库暂无本地 PNG 可检测"}}
        p = OUTPUTS_DIR / latest[0]["rel_path"]
        return {"tool": tool_name, "result": extract_nai_metadata(p.read_bytes()) if p.exists() else {"info": "最新图片磁盘文件不存在"}}
    elif tool_name == "nai_director_augment":
        return {"tool": tool_name, "result": await augment_image(args, cfg)}
    elif tool_name == "nai_manage_oc_cards":
        if str(args.get("action") or "list").lower() == "save" and args.get("name") and args.get("prompt"):
            return {"tool": tool_name, "result": save_oc_card(str(args["name"]), str(args["prompt"]), str(args.get("uc") or ""))}
        return {"tool": tool_name, "result": list_oc_cards()}
    elif tool_name == "nai_sync_gallery":
        return {"tool": tool_name, "result": sync_outputs_folder(OUTPUTS_DIR)}
    else:
        raise HTTPException(status_code=400, detail=f"未知的 MCP 工具: {tool_name}")


app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/artists", StaticFiles(directory=str(ARTISTS_DIR)), name="artists")
app.mount("/avatars", StaticFiles(directory=str(OC_AVATARS_DIR)), name="avatars")
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))
