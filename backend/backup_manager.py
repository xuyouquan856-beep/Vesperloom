r"""
NAI Studio — Data Backup, Migration & Safe Restore Manager.
Supports:
- Lightweight JSON export (artists, OC cards, mix presets, snippets, wildcards, skills, non-secret UI prefs)
- Full ZIP migration bundle (JSON + artists/*.png preview cards + oc_avatars/*)
- Dry-run preview before restore
- Automatic pre-restore safety snapshot on D:\NAI-Studio\data\backups
- Merge (idempotent upsert) and Replace (clean overwrite of curated tables) restore modes
Strictly NEVER exports API tokens or LLM keys.
"""
import io
import json
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import ARTISTS_DIR, DATA_DIR, load_config, save_config
from .database import (
    add_mix_preset,
    add_snippet,
    get_conn,
    list_artists,
    list_mix_presets,
    list_oc_cards,
    list_snippets,
    save_oc_card,
    update_artist_preview,
    upsert_artist,
)
from .prompt_engine import get_wildcard_detail, list_wildcards, save_wildcard_file
from .skills_manager import list_skills, save_skill

BACKUPS_DIR = DATA_DIR / "backups"
OC_AVATARS_DIR = DATA_DIR / "oc_avatars"
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
OC_AVATARS_DIR.mkdir(parents=True, exist_ok=True)

BACKUP_SCHEMA_VERSION = 1
MAX_LOCAL_SNAPSHOTS = 15

# Only non-secret user preferences are exported/restored
SAFE_PREF_KEYS = (
    "default_model",
    "opus_free_guard",
    "auto_quality_tags",
    "default_uc_preset",
    "theme",
    "bg_hex",
    "bg_preset_name",
    "glass_clarity",
    "prompt_workspace_mode",
    "llm_model",
    "llm_use_knowledge_agent",
    "llm_context_tokens",
    "llm_max_output_tokens",
)


def build_backup_payload() -> Dict[str, Any]:
    cfg = load_config()
    safe_prefs = {k: cfg[k] for k in SAFE_PREF_KEYS if k in cfg}

    wildcards: List[Dict[str, str]] = []
    for wc in list_wildcards():
        try:
            detail = get_wildcard_detail(wc["name"])
            wildcards.append({"name": detail["name"], "content": detail["content"]})
        except Exception:
            continue

    skills = [
        {
            "name": s["name"],
            "title": s.get("title") or s["name"],
            "description": s.get("description") or "",
            "triggers": s.get("triggers") or "",
            "content": s.get("content") or "",
        }
        for s in list_skills(include_content=True)
    ]

    return {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "app": "NAI Studio",
        "exported_at": int(time.time()),
        "exported_at_iso": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
        "artists": list_artists(),
        "oc_cards": list_oc_cards(),
        "mix_presets": list_mix_presets(),
        "snippets": list_snippets(),
        "wildcards": wildcards,
        "skills": skills,
        "preferences": safe_prefs,
    }


def export_backup_json_bytes() -> Tuple[bytes, str]:
    payload = build_backup_payload()
    stamp = time.strftime("%Y%m%d_%H%M%S", time.localtime())
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return raw, f"nai_studio_backup_{stamp}.json"


def export_backup_zip_bytes() -> Tuple[bytes, str]:
    payload = build_backup_payload()
    stamp = time.strftime("%Y%m%d_%H%M%S", time.localtime())
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("backup.json", json.dumps(payload, ensure_ascii=False, indent=2), compress_type=zipfile.ZIP_DEFLATED)
        if ARTISTS_DIR.exists():
            for p in sorted(ARTISTS_DIR.glob("*")):
                if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                    # Images are already compressed; ZIP_STORED avoids wasted CPU & makes full export 5-10x faster
                    zf.write(p, f"artists/{p.name}", compress_type=zipfile.ZIP_STORED)
        if OC_AVATARS_DIR.exists():
            for p in sorted(OC_AVATARS_DIR.glob("*")):
                if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                    zf.write(p, f"oc_avatars/{p.name}", compress_type=zipfile.ZIP_STORED)
    return buf.getvalue(), f"nai_studio_full_backup_{stamp}.zip"


def _parse_backup_bytes(raw_bytes: bytes, filename: str = "") -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    if not raw_bytes:
        raise ValueError("上传的备份文件为空")

    media_files: Dict[str, bytes] = {}
    is_zip = filename.lower().endswith(".zip") or raw_bytes[:4] == b"PK\x03\x04"

    if is_zip:
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
                names = zf.namelist()
                json_name = "backup.json" if "backup.json" in names else next((n for n in names if n.endswith(".json")), None)
                if not json_name:
                    raise ValueError("ZIP 备份包中未找到 backup.json")
                payload = json.loads(zf.read(json_name).decode("utf-8"))
                for member in names:
                    norm = member.replace("\\", "/").lstrip("/")
                    if ".." in Path(norm).parts:
                        continue
                    if (norm.startswith("artists/") or norm.startswith("oc_avatars/")) and not norm.endswith("/"):
                        if Path(norm).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                            media_files[norm] = zf.read(member)
        except zipfile.BadZipFile:
            raise ValueError("ZIP 文件已损坏或格式无效")
    else:
        try:
            payload = json.loads(raw_bytes.decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"JSON 备份文件解析失败: {exc}")

    if not isinstance(payload, dict) or "schema_version" not in payload:
        raise ValueError("不是有效的 NAI Studio 备份文件（缺少 schema_version）")
    return payload, media_files


def preview_backup_bytes(raw_bytes: bytes, filename: str = "") -> Dict[str, Any]:
    payload, media_files = _parse_backup_bytes(raw_bytes, filename)
    artist_media = sum(1 for k in media_files if k.startswith("artists/"))
    avatar_media = sum(1 for k in media_files if k.startswith("oc_avatars/"))
    return {
        "valid": True,
        "schema_version": payload.get("schema_version"),
        "exported_at_iso": payload.get("exported_at_iso") or "",
        "format": "zip" if media_files or filename.lower().endswith(".zip") else "json",
        "counts": {
            "artists": len(payload.get("artists") or []),
            "oc_cards": len(payload.get("oc_cards") or []),
            "mix_presets": len(payload.get("mix_presets") or []),
            "snippets": len(payload.get("snippets") or []),
            "wildcards": len(payload.get("wildcards") or []),
            "skills": len(payload.get("skills") or []),
            "artist_previews": artist_media,
            "oc_avatars": avatar_media,
        },
        "has_preferences": bool(payload.get("preferences")),
    }


def _prune_old_snapshots() -> None:
    snaps = sorted(BACKUPS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in snaps[MAX_LOCAL_SNAPSHOTS:]:
        try:
            old.unlink()
        except Exception:
            pass


def create_local_snapshot(prefix: str = "manual") -> Dict[str, Any]:
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    payload = build_backup_payload()
    stamp = time.strftime("%Y%m%d_%H%M%S", time.localtime())
    safe_prefix = "".join(ch for ch in prefix if ch.isalnum() or ch in ("_", "-")) or "manual"
    fname = f"{safe_prefix}_{stamp}.json"
    fpath = BACKUPS_DIR / fname
    seq = 1
    while fpath.exists():
        fname = f"{safe_prefix}_{stamp}_{seq}.json"
        fpath = BACKUPS_DIR / fname
        seq += 1
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    fpath.write_bytes(raw)
    _prune_old_snapshots()
    return {
        "filename": fname,
        "size_kb": round(len(raw) / 1024, 1),
        "created_at": int(time.time()),
        "artists_count": len(payload["artists"]),
        "oc_cards_count": len(payload["oc_cards"]),
    }


def list_local_snapshots() -> List[Dict[str, Any]]:
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    out: List[Dict[str, Any]] = []
    for p in sorted(BACKUPS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)[:MAX_LOCAL_SNAPSHOTS]:
        st = p.stat()
        artists_cnt = 0
        try:
            meta = json.loads(p.read_text(encoding="utf-8"))
            artists_cnt = len(meta.get("artists") or [])
        except Exception:
            pass
        out.append({
            "filename": p.name,
            "size_kb": round(st.st_size / 1024, 1),
            "mtime": int(st.st_mtime),
            "mtime_str": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            "artists_count": artists_cnt,
        })
    return out


def restore_backup_bytes(
    raw_bytes: bytes,
    filename: str = "",
    mode: str = "merge",
    restore_preferences: bool = False,
    create_safety_snapshot: bool = True,
) -> Dict[str, Any]:
    norm_mode = "replace" if str(mode).lower() == "replace" else "merge"
    payload, media_files = _parse_backup_bytes(raw_bytes, filename)
    if norm_mode == "replace" and not (payload.get("artists") or []):
        raise ValueError("完整覆盖模式要求备份包含画师数据，以防误清空现有画师库")

    safety_snap = create_local_snapshot("auto_pre_restore") if create_safety_snapshot else None

    if norm_mode == "replace":
        with get_conn() as conn:
            conn.execute("DELETE FROM artists")
            conn.execute("DELETE FROM oc_cards")
            conn.execute("DELETE FROM mix_presets")
            conn.execute("DELETE FROM prompt_snippets")
            conn.commit()

    # 1. Artists (idempotent upsert by tag)
    artists_restored = 0
    for a in payload.get("artists") or []:
        tag = str(a.get("tag") or "").strip()
        name = str(a.get("name") or tag).strip()
        if not tag:
            continue
        upserted = upsert_artist(
            name=name,
            tag=tag,
            category=str(a.get("category") or "私人收藏"),
            desc=str(a.get("desc") or ""),
            sample_tags=str(a.get("sample_tags") or ""),
            preview_url=str(a.get("preview_url") or ""),
            is_custom=bool(a.get("is_custom", True)),
            style_tags=a.get("style_tags") or [],
            post_count=int(a.get("post_count") or 0),
            weight_hint=str(a.get("weight_hint") or ""),
            aliases=str(a.get("aliases") or ""),
            urls=a.get("urls") or [],
            notes=str(a.get("notes") or ""),
        )
        fav_int = 1 if a.get("favorite") else 0
        pal_json = json.dumps(a["palette"], ensure_ascii=False) if isinstance(a.get("palette"), list) else None
        with get_conn() as conn:
            if pal_json:
                conn.execute("UPDATE artists SET favorite = ?, palette_json = ? WHERE id = ?", (fav_int, pal_json, upserted["id"]))
            else:
                conn.execute("UPDATE artists SET favorite = ? WHERE id = ?", (fav_int, upserted["id"]))
            conn.commit()
        artists_restored += 1

    # 2. OC Cards (avoid duplicate names in merge mode)
    existing_oc_names = {str(c["name"]).strip().lower() for c in list_oc_cards()}
    oc_restored = 0
    for c in payload.get("oc_cards") or []:
        cname = str(c.get("name") or "").strip()
        cprompt = str(c.get("prompt") or "").strip()
        if not cname or not cprompt:
            continue
        if norm_mode == "merge" and cname.lower() in existing_oc_names:
            continue
        save_oc_card(
            name=cname,
            prompt=cprompt,
            uc=str(c.get("uc") or ""),
            avatar_url=str(c.get("avatar_url") or ""),
            default_x=float(c.get("default_x") if c.get("default_x") is not None else 0.5),
            default_y=float(c.get("default_y") if c.get("default_y") is not None else 0.5),
        )
        existing_oc_names.add(cname.lower())
        oc_restored += 1

    # 3. Mix Presets
    existing_mix_names = {str(m["name"]).strip().lower() for m in list_mix_presets()}
    mix_restored = 0
    for m in payload.get("mix_presets") or []:
        mname = str(m.get("name") or "").strip()
        mitems = m.get("items") or []
        if not mname or not isinstance(mitems, list) or not mitems:
            continue
        if norm_mode == "merge" and mname.lower() in existing_mix_names:
            continue
        add_mix_preset(mname, mitems)
        existing_mix_names.add(mname.lower())
        mix_restored += 1

    # 4. Snippets
    existing_snip_labels = {str(s["label"]).strip().lower() for s in list_snippets()}
    snip_restored = 0
    for s in payload.get("snippets") or []:
        slbl = str(s.get("label") or "").strip()
        stags = str(s.get("tags") or "").strip()
        if not slbl or not stags:
            continue
        if norm_mode == "merge" and slbl.lower() in existing_snip_labels:
            continue
        add_snippet(slbl, stags, str(s.get("cat") or "custom"))
        existing_snip_labels.add(slbl.lower())
        snip_restored += 1

    # 5. Wildcards
    wc_restored = 0
    for w in payload.get("wildcards") or []:
        wname = str(w.get("name") or "").strip()
        if not wname:
            continue
        try:
            save_wildcard_file(wname, str(w.get("content") or ""))
            wc_restored += 1
        except Exception:
            continue

    # 6. Agent Skills
    skills_restored = 0
    for sk in payload.get("skills") or []:
        sname = str(sk.get("name") or "").strip()
        if not sname:
            continue
        try:
            raw_triggers = sk.get("triggers")
            if raw_triggers is None and isinstance(sk.get("tags"), list):
                raw_triggers = ", ".join(str(t) for t in sk.get("tags") if t)
            save_skill(
                name=sname,
                title=str(sk.get("title") or sname),
                description=str(sk.get("description") or ""),
                triggers=str(raw_triggers or ""),
                content=str(sk.get("content") or ""),
            )
            skills_restored += 1
        except Exception:
            continue

    # 7. Media files from ZIP (artists/* & oc_avatars/*)
    media_restored = 0
    for rel, data in media_files.items():
        fname = Path(rel).name
        if rel.startswith("artists/"):
            target = (ARTISTS_DIR / fname).resolve()
            if target.parent == ARTISTS_DIR.resolve():
                if norm_mode == "replace" or not target.exists():
                    target.write_bytes(data)
                    media_restored += 1
        elif rel.startswith("oc_avatars/"):
            target = (OC_AVATARS_DIR / fname).resolve()
            if target.parent == OC_AVATARS_DIR.resolve():
                if norm_mode == "replace" or not target.exists():
                    target.write_bytes(data)
                    media_restored += 1

    # 8. Optional non-secret UI preferences
    prefs_applied = False
    if restore_preferences and isinstance(payload.get("preferences"), dict):
        safe_patch = {k: payload["preferences"][k] for k in SAFE_PREF_KEYS if k in payload["preferences"]}
        if safe_patch:
            cur_cfg = load_config()
            cur_cfg.update(safe_patch)
            save_config(cur_cfg)
            prefs_applied = True

    return {
        "ok": True,
        "mode": norm_mode,
        "restored": {
            "artists": artists_restored,
            "oc_cards": oc_restored,
            "mix_presets": mix_restored,
            "snippets": snip_restored,
            "wildcards": wc_restored,
            "skills": skills_restored,
            "media_files": media_restored,
            "preferences": prefs_applied,
        },
        "safety_snapshot": safety_snap,
    }


def restore_local_snapshot(snapshot_filename: str, mode: str = "replace") -> Dict[str, Any]:
    fname = Path(str(snapshot_filename or "")).name
    target = (BACKUPS_DIR / fname).resolve()
    if target.parent != BACKUPS_DIR.resolve() or not target.is_file():
        raise FileNotFoundError(f"本地快照不存在: {fname}")
    return restore_backup_bytes(
        target.read_bytes(),
        filename=fname,
        mode=mode,
        restore_preferences=False,
        create_safety_snapshot=True,
    )
