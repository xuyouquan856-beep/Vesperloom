import contextlib
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from .config import DB_PATH, OUTPUTS_DIR
from .png_metadata import extract_nai_metadata

INITIAL_ARTISTS: List[Dict[str, Any]] = [
    {
        "name": "ASK (askzy)",
        "tag": "artist:ask_(askzy)",
        "category": "厚涂光影",
        "desc": "浓郁华丽的冷暖对比与丝绸肤质光感，极具古典剧场张力，混搭 0.6–1.0 极佳。",
        "sample_tags": "1girl, solo, silver hair, blue eyes, white dress, sunlight, stained glass, depth of field",
        "favorite": 1,
        "palette": ["#1e3a8a", "#f59e0b"],
    },
    {
        "name": "Ciloranko (치로랑코)",
        "tag": "artist:ciloranko",
        "category": "幻彩插画",
        "desc": "晶莹剔透的眼眸高光、空气感发丝与柔和逆光色彩，二次元现代时尚插画首选。",
        "sample_tags": "1girl, solo, long hair, floating hair, sparkling eyes, serafuku, sunset, lens flare, wind",
        "favorite": 1,
        "palette": ["#ec4899", "#6366f1"],
    },
    {
        "name": "Rella",
        "tag": "artist:rella",
        "category": "清透水彩",
        "desc": "梦幻级水光折射、星空光尘与戏剧性顶光/逆光，极适合空灵意境与水滴氛围。",
        "sample_tags": "1girl, solo, twintails, blue hair, starry sky, water drop, backlighting, sparkles, ocean",
        "favorite": 1,
        "palette": ["#0284c7", "#38bdf8"],
    },
    {
        "name": "Mika Pikazo",
        "tag": "artist:mika_pikazo",
        "category": "幻彩插画",
        "desc": "高饱和绚丽色块碰撞与极具活力的边缘色散高光，建议以 0.4–0.7 权重混入提亮画面。",
        "sample_tags": "1girl, solo, multicolored hair, smile, dynamic angle, sparkles, chromatic aberration",
        "favorite": 1,
        "palette": ["#f43f5e", "#06b6d4"],
    },
    {
        "name": "WLOP",
        "tag": "artist:wlop",
        "category": "厚涂光影",
        "desc": "史诗电影感油画厚涂笔触、金属珠宝反光与丁达尔体积圣光。",
        "sample_tags": "1girl, solo, crown, white dress, tyndall effect, cinematic lighting, impasto, wind",
        "favorite": 1,
        "palette": ["#0f172a", "#d97706"],
    },
    {
        "name": "Anmi",
        "tag": "artist:anmi",
        "category": "日系轻小说",
        "desc": "清亮通透的少女日常感、水润腮红与灵动肢体线条，色彩明快柔和。",
        "sample_tags": "1girl, solo, sundress, light smile, dappled sunlight, flower field, wind",
        "favorite": 1,
        "palette": ["#fb7185", "#fde047"],
    },
    {
        "name": "Tidsean (TID)",
        "tag": "artist:tidsean",
        "category": "厚涂光影",
        "desc": "细腻立体的半厚涂光影、精致五官雕塑感与高质感材质渲染。",
        "sample_tags": "1girl, solo, silver hair, detailed eyes, upper body, rim lighting, bokeh",
        "favorite": 0,
        "palette": ["#312e81", "#818cf8"],
    },
    {
        "name": "Loundraw",
        "tag": "artist:loundraw",
        "category": "清透水彩",
        "desc": "新海诚式透明感青春电影空气光效，大景深云海、天台与夏日微风。",
        "sample_tags": "1girl, solo, school uniform, rooftop, cloudy sky, sunlight, lens flare, wind",
        "favorite": 0,
        "palette": ["#0369a1", "#bae6fd"],
    },
    {
        "name": "Kantoku (监督)",
        "tag": "artist:kantoku",
        "category": "日系轻小说",
        "desc": "标志性水润大眼、格纹百褶裙与鲜明高对比青春日常感。",
        "sample_tags": "1girl, solo, short hair, serafuku, smile, classroom, sunlight",
        "favorite": 0,
        "palette": ["#2563eb", "#f97316"],
    },
    {
        "name": "LM7 (opium)",
        "tag": "artist:lm7_(opium)",
        "category": "赛博冷调",
        "desc": "冷峻废土机能风、克制低饱和灰调搭配锐利霓虹点缀。",
        "sample_tags": "1girl, solo, white hair, cyberpunk, glowing eyes, ruins, rain",
        "favorite": 0,
        "palette": ["#1e293b", "#2dd4bf"],
    },
    {
        "name": "Huke",
        "tag": "artist:huke",
        "category": "赛博冷调",
        "desc": "粗犷颗粒感暗黑机械美学与高反差冷蓝光效。",
        "sample_tags": "1girl, solo, black hair, twintails, blue eyes, glowing, dark background",
        "favorite": 0,
        "palette": ["#090d16", "#3b82f6"],
    },
    {
        "name": "Redjuice",
        "tag": "artist:redjuice",
        "category": "赛博冷调",
        "desc": "未来感科幻光泽、半透明花瓣结晶与精密细节层次。",
        "sample_tags": "1girl, solo, pink hair, floating petals, chromatic aberration, cinematic lighting",
        "favorite": 0,
        "palette": ["#701a75", "#38bdf8"],
    },
    {
        "name": "Ke-ta",
        "tag": "artist:ke-ta",
        "category": "厚涂光影",
        "desc": "柔滑细腻的肌肤高光与温润色彩过渡，适合精修人物特写。",
        "sample_tags": "1girl, solo, blonde hair, frills, white dress, soft lighting, upper body",
        "favorite": 0,
        "palette": ["#7c2d12", "#fde68a"],
    },
    {
        "name": "Tiv",
        "tag": "artist:tiv",
        "category": "日系轻小说",
        "desc": "温柔纤细的线条与淡雅治愈系色彩，极适合日常与冬日微光。",
        "sample_tags": "1girl, solo, long hair, cardigan, snow, light smile, bokeh",
        "favorite": 0,
        "palette": ["#475569", "#93c5fd"],
    },
    {
        "name": "Morikura En (森仓圆)",
        "tag": "artist:morikura_en",
        "category": "日系轻小说",
        "desc": "清纯自然的少女神态、柔和晨光与细腻制服褶皱。",
        "sample_tags": "1girl, solo, ponytail, school uniform, morning, sunlight, looking at viewer",
        "favorite": 0,
        "palette": ["#0284c7", "#fef08a"],
    },
    {
        "name": "Nixeu",
        "tag": "artist:nixeu",
        "category": "哥特幻想",
        "desc": "优雅暗金与绯红丝绒质感，神圣冷艳的幻想肖像构图。",
        "sample_tags": "1girl, solo, red eyes, silver hair, gothic lolita,oker, cinematic lighting",
        "favorite": 0,
        "palette": ["#450a0a", "#f59e0b"],
    },
]

INITIAL_MIX_PRESETS: List[Dict[str, Any]] = [
    {
        "name": "晶透水光映画 (Rella + Ciloranko + ASK)",
        "items": [
            {"tag": "artist:rella", "name": "Rella", "weight": 0.9},
            {"tag": "artist:ciloranko", "name": "Ciloranko", "weight": 0.7},
            {"tag": "artist:ask_(askzy)", "name": "ASK", "weight": 0.5},
        ],
    },
    {
        "name": "电影感丝绸厚涂 (ASK + WLOP + Tidsean)",
        "items": [
            {"tag": "artist:ask_(askzy)", "name": "ASK", "weight": 1.0},
            {"tag": "artist:wlop", "name": "WLOP", "weight": 0.6},
            {"tag": "artist:tidsean", "name": "Tidsean", "weight": 0.5},
        ],
    },
    {
        "name": "新海诚透明感夏日 (Loundraw + Anmi + Mika)",
        "items": [
            {"tag": "artist:loundraw", "name": "Loundraw", "weight": 0.9},
            {"tag": "artist:anmi", "name": "Anmi", "weight": 0.7},
            {"tag": "artist:mika_pikazo", "name": "Mika Pikazo", "weight": 0.35},
        ],
    },
]

INITIAL_SNIPPETS: List[Dict[str, Any]] = [
    {"label": "电影逆光", "tags": "cinematic lighting, backlighting, rim lighting, lens flare", "cat": "lighting"},
    {"label": "晶透水滴", "tags": "water drop, sparkles, chromatic aberration, depth of field", "cat": "atmosphere"},
    {"label": "逢魔暮色", "tags": "twilight, sunset, golden hour, dappled sunlight, bokeh", "cat": "atmosphere"},
    {"label": "飘逸微风", "tags": "wind, floating hair, floating petals, dynamic angle", "cat": "motion"},
    {"label": "精致眼眸", "tags": "detailed eyes, sparkling eyes, looking at viewer, light smile", "cat": "detail"},
]


INITIAL_OC_CARDS: List[Dict[str, Any]] = [
    {
        "name": "银发水手服少女 (露娜)",
        "prompt": "girl, silver hair, long hair, blue eyes, ahoge, serafuku, navy sailor collar, red neckerchief, detailed eyes",
        "uc": "lowres, bad anatomy, extra arms",
        "default_x": 0.3,
        "default_y": 0.5,
        "favorite": 1,
    },
    {
        "name": "黑发哥特大小姐 (丝忒拉)",
        "prompt": "girl, black hair, twintails, red eyes, gothic lolita dress, frills, hair ribbon, cool expression",
        "uc": "lowres, bad anatomy, messy hair",
        "default_x": 0.7,
        "default_y": 0.5,
        "favorite": 1,
    },
]


@contextlib.contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS gallery (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                rel_path TEXT NOT NULL,
                model TEXT NOT NULL,
                model_short TEXT NOT NULL,
                action TEXT DEFAULT 'generate',
                prompt TEXT NOT NULL,
                uc TEXT DEFAULT '',
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                steps INTEGER NOT NULL,
                scale REAL NOT NULL,
                cfg_rescale REAL DEFAULT 0.0,
                sampler TEXT NOT NULL,
                scheduler TEXT NOT NULL,
                seed INTEGER NOT NULL,
                characters_json TEXT DEFAULT '[]',
                artist_mix_json TEXT DEFAULT '[]',
                generation_time REAL DEFAULT 0.0,
                favorite INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS artists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                tag TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                desc TEXT DEFAULT '',
                sample_tags TEXT DEFAULT '',
                style_tags_json TEXT DEFAULT '[]',
                post_count INTEGER DEFAULT 0,
                weight_hint TEXT DEFAULT '',
                aliases TEXT DEFAULT '',
                urls_json TEXT DEFAULT '[]',
                notes TEXT DEFAULT '',
                preview_url TEXT DEFAULT '',
                favorite INTEGER DEFAULT 0,
                is_custom INTEGER DEFAULT 0,
                palette_json TEXT DEFAULT '["#2563eb","#38bdf8"]',
                created_at INTEGER NOT NULL
            )
            """
        )
        # Idempotent schema migration for existing studio.db artist dossiers
        existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(artists)").fetchall()}
        migrations = [
            ("style_tags_json", "TEXT DEFAULT '[]'"),
            ("post_count", "INTEGER DEFAULT 0"),
            ("weight_hint", "TEXT DEFAULT ''"),
            ("aliases", "TEXT DEFAULT ''"),
            ("urls_json", "TEXT DEFAULT '[]'"),
            ("notes", "TEXT DEFAULT ''"),
        ]
        for col_name, col_def in migrations:
            if col_name not in existing_cols:
                conn.execute(f"ALTER TABLE artists ADD COLUMN {col_name} {col_def}")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mix_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                items_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS prompt_snippets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label TEXT NOT NULL,
                tags TEXT NOT NULL,
                cat TEXT DEFAULT 'general'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS oc_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                avatar_url TEXT DEFAULT '',
                prompt TEXT NOT NULL,
                uc TEXT DEFAULT '',
                default_x REAL DEFAULT 0.5,
                default_y REAL DEFAULT 0.5,
                favorite INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_gallery_model_fav ON gallery(model, favorite, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_gallery_rel_path ON gallery(rel_path)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                pinned_skills_json TEXT DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_events_json TEXT DEFAULT '[]',
                ui_actions_json TEXT DEFAULT '[]',
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_msg_session ON agent_messages(session_id, id ASC)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS a2a_tasks (
                id TEXT PRIMARY KEY,
                context_id TEXT NOT NULL,
                state TEXT NOT NULL,
                brief TEXT NOT NULL,
                result_text TEXT DEFAULT '',
                artifacts_json TEXT DEFAULT '[]',
                history_json TEXT DEFAULT '[]',
                metadata_json TEXT DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_a2a_tasks_updated ON a2a_tasks(updated_at DESC)")

        # Seed artists if empty
        cur = conn.execute("SELECT COUNT(*) as cnt FROM artists")
        if cur.fetchone()["cnt"] == 0:
            now = int(time.time())
            for a in INITIAL_ARTISTS:
                slug = a["tag"].replace("artist:", "").replace("(", "").replace(")", "").replace("/", "_")
                preview_file = Path("D:/NAI-Studio/artists") / f"{slug}.png"
                preview_url = f"/artists/{slug}.png" if preview_file.exists() else ""
                conn.execute(
                    """
                    INSERT OR IGNORE INTO artists (name, tag, category, desc, sample_tags, preview_url, favorite, is_custom, palette_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                    """,
                    (
                        a["name"],
                        a["tag"],
                        a["category"],
                        a["desc"],
                        a["sample_tags"],
                        preview_url,
                        a["favorite"],
                        json.dumps(a["palette"]),
                        now,
                    ),
                )

        # Seed mix presets if empty
        cur = conn.execute("SELECT COUNT(*) as cnt FROM mix_presets")
        if cur.fetchone()["cnt"] == 0:
            now = int(time.time())
            for mp in INITIAL_MIX_PRESETS:
                conn.execute(
                    "INSERT INTO mix_presets (name, items_json, created_at) VALUES (?, ?, ?)",
                    (mp["name"], json.dumps(mp["items"], ensure_ascii=False), now),
                )

        # Seed prompt snippets if empty
        cur = conn.execute("SELECT COUNT(*) as cnt FROM prompt_snippets")
        if cur.fetchone()["cnt"] == 0:
            for sn in INITIAL_SNIPPETS:
                conn.execute(
                    "INSERT INTO prompt_snippets (label, tags, cat) VALUES (?, ?, ?)",
                    (sn["label"], sn["tags"], sn["cat"]),
                )

        # Seed OC cards if empty
        cur = conn.execute("SELECT COUNT(*) as cnt FROM oc_cards")
        if cur.fetchone()["cnt"] == 0:
            now = int(time.time())
            for oc in INITIAL_OC_CARDS:
                conn.execute(
                    "INSERT INTO oc_cards (name, avatar_url, prompt, uc, default_x, default_y, favorite, created_at) VALUES (?, '', ?, ?, ?, ?, ?, ?)",
                    (oc["name"], oc["prompt"], oc["uc"], oc["default_x"], oc["default_y"], oc["favorite"], now),
                )
        conn.commit()


def add_gallery_item(item: Dict[str, Any]) -> Dict[str, Any]:
    now = int(time.time())
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO gallery (
                filename, rel_path, model, model_short, action, prompt, uc,
                width, height, steps, scale, cfg_rescale, sampler, scheduler,
                seed, characters_json, artist_mix_json, generation_time, favorite, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["filename"],
                item["rel_path"],
                item.get("model", "nai-diffusion-5-full"),
                item.get("model_short", "V5 Full"),
                item.get("action", "generate"),
                item.get("prompt", ""),
                item.get("uc", ""),
                int(item.get("width", 832)),
                int(item.get("height", 1216)),
                int(item.get("steps", 28)),
                float(item.get("scale", 5.0)),
                float(item.get("cfg_rescale", 0.0)),
                item.get("sampler", "k_euler_ancestral"),
                item.get("scheduler", "karras"),
                int(item.get("seed", 0)),
                json.dumps(item.get("characters", []), ensure_ascii=False),
                json.dumps(item.get("artist_mix", []), ensure_ascii=False),
                float(item.get("generation_time", 0.0)),
                int(item.get("favorite", 0)),
                item.get("notes", ""),
                now,
            ),
        )
        conn.commit()
        new_id = cur.lastrowid
    return get_gallery_item(new_id)


def _like_pattern(q: str) -> str:
    escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _gallery_where_clause(search: str = "", model: str = "", favorite_only: bool = False) -> tuple[str, List[Any]]:
    sql = " WHERE 1=1"
    params: List[Any] = []
    if search.strip():
        sql += " AND (prompt LIKE ? ESCAPE '\\' OR uc LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR model_short LIKE ? ESCAPE '\\' OR artist_mix_json LIKE ? ESCAPE '\\' OR CAST(seed AS TEXT) LIKE ? ESCAPE '\\')"
        q = _like_pattern(search)
        params.extend([q, q, q, q, q, q])
    if model.strip() and model != "all":
        sql += " AND model = ?"
        params.append(model.strip())
    if favorite_only:
        sql += " AND favorite = 1"
    return sql, params


def _row_to_gallery(row: sqlite3.Row) -> Dict[str, Any]:
    d = dict(row)
    d["characters"] = json.loads(d.pop("characters_json", "[]") or "[]")
    d["artist_mix"] = json.loads(d.pop("artist_mix_json", "[]") or "[]")
    d["favorite"] = bool(d.get("favorite"))
    d["image_url"] = f"/outputs/{d['rel_path']}"
    return d


def get_gallery_item(item_id: int) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM gallery WHERE id = ?", (item_id,)).fetchone()
        return _row_to_gallery(row) if row else None


def count_gallery(
    search: str = "",
    model: str = "",
    favorite_only: bool = False,
) -> int:
    where, params = _gallery_where_clause(search=search, model=model, favorite_only=favorite_only)
    with get_conn() as conn:
        row = conn.execute(f"SELECT COUNT(*) FROM gallery{where}", params).fetchone()
        return int(row[0] if row else 0)


GALLERY_SORT_MAP = {
    "newest": "id DESC",
    "oldest": "id ASC",
    "fav_first": "favorite DESC, id DESC",
    "fastest": "generation_time ASC, id DESC",
    "slowest": "generation_time DESC, id DESC",
}


def list_gallery(
    search: str = "",
    model: str = "",
    favorite_only: bool = False,
    limit: int = 100,
    offset: int = 0,
    sort: str = "newest",
) -> List[Dict[str, Any]]:
    where, params = _gallery_where_clause(search=search, model=model, favorite_only=favorite_only)
    order_by = GALLERY_SORT_MAP.get(sort, "id DESC")
    sql = f"SELECT * FROM gallery{where} ORDER BY {order_by} LIMIT ? OFFSET ?"
    params.extend([max(1, int(limit)), max(0, int(offset))])
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_gallery(r) for r in rows]


def toggle_gallery_favorite(item_id: int) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        conn.execute("UPDATE gallery SET favorite = CASE WHEN favorite = 1 THEN 0 ELSE 1 END WHERE id = ?", (item_id,))
        conn.commit()
    return get_gallery_item(item_id)


def update_gallery_notes(item_id: int, notes: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        conn.execute("UPDATE gallery SET notes = ? WHERE id = ?", (notes, item_id))
        conn.commit()
    return get_gallery_item(item_id)


def _safe_unlink_output(rel_path: str) -> None:
    if not rel_path:
        return
    try:
        base_out = OUTPUTS_DIR.resolve()
        target = (base_out / rel_path).resolve()
        if target.is_relative_to(base_out) and target.is_file():
            target.unlink()
    except Exception:
        pass


def delete_gallery_item(item_id: int, delete_file: bool = True) -> bool:
    item = get_gallery_item(item_id)
    if not item:
        return False
    with get_conn() as conn:
        conn.execute("DELETE FROM gallery WHERE id = ?", (item_id,))
        conn.commit()
    if delete_file:
        _safe_unlink_output(item.get("rel_path", ""))
    return True


def batch_delete_gallery(
    unfav_only: bool = True,
    delete_file: bool = True,
    ids: Optional[List[int]] = None,
) -> int:
    with get_conn() as conn:
        if ids is not None:
            clean_ids = [int(x) for x in ids if str(x).isdigit()]
            if not clean_ids:
                return 0
            placeholders = ",".join("?" for _ in clean_ids)
            rows = conn.execute(f"SELECT id, rel_path FROM gallery WHERE id IN ({placeholders})", clean_ids).fetchall()
            conn.execute(f"DELETE FROM gallery WHERE id IN ({placeholders})", clean_ids)
        elif unfav_only:
            rows = conn.execute("SELECT id, rel_path FROM gallery WHERE favorite = 0").fetchall()
            conn.execute("DELETE FROM gallery WHERE favorite = 0")
        else:
            rows = conn.execute("SELECT id, rel_path FROM gallery").fetchall()
            conn.execute("DELETE FROM gallery")
        conn.commit()
    if delete_file:
        for r in rows:
            _safe_unlink_output(r["rel_path"])
    return len(rows)


def batch_favorite_gallery(ids: List[int], favorite: bool = True) -> int:
    clean_ids = [int(x) for x in ids if str(x).isdigit()]
    if not clean_ids:
        return 0
    placeholders = ",".join("?" for _ in clean_ids)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE gallery SET favorite = ? WHERE id IN ({placeholders})",
            [1 if favorite else 0, *clean_ids],
        )
        conn.commit()
        return int(cur.rowcount or 0)


def sync_outputs_folder(outputs_root: Optional[Path] = None, prune_missing: bool = True) -> Dict[str, Any]:
    root = (outputs_root or OUTPUTS_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        existing_rows = conn.execute("SELECT id, rel_path FROM gallery").fetchall()

    existing_paths = {r["rel_path"] for r in existing_rows}
    pruned_missing = 0
    if prune_missing and existing_rows:
        missing_ids: List[int] = []
        for r in existing_rows:
            rel = str(r["rel_path"] or "")
            if not rel:
                missing_ids.append(r["id"])
                continue
            target = (root / rel).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                missing_ids.append(r["id"])
        if missing_ids:
            with get_conn() as conn:
                placeholders = ",".join("?" for _ in missing_ids)
                conn.execute(f"DELETE FROM gallery WHERE id IN ({placeholders})", missing_ids)
                conn.commit()
            pruned_missing = len(missing_ids)

    added_count = 0
    for png_path in sorted(root.rglob("*.png")):
        try:
            rel_path = png_path.relative_to(root).as_posix()
            if rel_path in existing_paths:
                continue
            meta = extract_nai_metadata(png_path.read_bytes())
            from .models_spec import get_model_spec
            spec = get_model_spec(meta.get("model", "nai-diffusion-5-full"))
            add_gallery_item({
                "filename": png_path.name,
                "rel_path": rel_path,
                "model": spec["id"],
                "model_short": spec["short_name"],
                "action": "imported",
                "prompt": meta.get("prompt") or png_path.stem,
                "uc": meta.get("uc") or "",
                "width": meta.get("width") or 832,
                "height": meta.get("height") or 1216,
                "steps": meta.get("steps") or 28,
                "scale": meta.get("scale") or 5.0,
                "cfg_rescale": meta.get("cfg_rescale") or 0.0,
                "sampler": meta.get("sampler") or "k_euler_ancestral",
                "scheduler": meta.get("scheduler") or "karras",
                "seed": meta.get("seed") or 0,
                "characters": meta.get("characters") or [],
                "notes": "本地目录扫描自动入库",
            })
            added_count += 1
        except Exception:
            continue
    return {
        "scanned": True,
        "added_count": added_count,
        "imported": added_count,
        "pruned_missing": pruned_missing,
    }


def _normalize_str_list(val: Any) -> List[str]:
    if isinstance(val, list):
        items = [str(x).strip() for x in val if str(x).strip()]
    elif isinstance(val, str):
        items = [x.strip() for x in re.split(r"[,，/|]+", val) if x.strip()]
    else:
        items = []
    seen = set()
    out: List[str] = []
    for x in items:
        k = x.lower()
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out


def _safe_json_list(raw: Any, fallback: List[str]) -> List[str]:
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        return parsed if isinstance(parsed, list) else list(fallback)
    except Exception:
        return list(fallback)


def _row_to_artist(row: sqlite3.Row) -> Dict[str, Any]:
    d = dict(row)
    d["favorite"] = bool(d["favorite"])
    d["is_custom"] = bool(d["is_custom"])
    d["palette"] = _safe_json_list(d.pop("palette_json", '["#2563eb","#38bdf8"]'), ["#2563eb", "#38bdf8"])
    d["style_tags"] = _safe_json_list(d.pop("style_tags_json", "[]"), [])
    d["urls"] = _safe_json_list(d.pop("urls_json", "[]"), [])
    d["post_count"] = int(d.get("post_count") or 0)
    d["weight_hint"] = str(d.get("weight_hint") or "")
    d["aliases"] = str(d.get("aliases") or "")
    d["notes"] = str(d.get("notes") or "")
    return d


def list_artists(
    search: str = "",
    category: str = "",
    favorite_only: bool = False,
    style_tag: str = "",
) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM artists WHERE 1=1"
    params: List[Any] = []
    if search.strip():
        tokens = [tok for tok in re.split(r"[\s,，/|]+", search.strip()) if tok]
        for tok in tokens[:6]:
            q = _like_pattern(tok)
            sql += (
                " AND (name LIKE ? ESCAPE '\\' OR tag LIKE ? ESCAPE '\\' OR desc LIKE ? ESCAPE '\\' "
                "OR category LIKE ? ESCAPE '\\' OR COALESCE(style_tags_json,'') LIKE ? ESCAPE '\\' "
                "OR COALESCE(sample_tags,'') LIKE ? ESCAPE '\\' OR COALESCE(aliases,'') LIKE ? ESCAPE '\\' "
                "OR COALESCE(notes,'') LIKE ? ESCAPE '\\')"
            )
            params.extend([q, q, q, q, q, q, q, q])
    if category.strip() and category != "all":
        sql += " AND category = ?"
        params.append(category.strip())
    if style_tag.strip() and style_tag != "all":
        sq = _like_pattern(style_tag.strip())
        sql += " AND COALESCE(style_tags_json,'') LIKE ? ESCAPE '\\'"
        params.append(sq)
    if favorite_only:
        sql += " AND favorite = 1"
    sql += " ORDER BY favorite DESC, id ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_artist(r) for r in rows]


def update_artist(
    artist_id: int,
    name: Optional[str] = None,
    tag: Optional[str] = None,
    category: Optional[str] = None,
    desc: Optional[str] = None,
    sample_tags: Optional[str] = None,
    style_tags: Optional[Any] = None,
    post_count: Optional[int] = None,
    weight_hint: Optional[str] = None,
    aliases: Optional[str] = None,
    urls: Optional[Any] = None,
    notes: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
        if not row:
            return None
        new_name = (name if name is not None else row["name"]).strip() or row["name"]
        new_tag = (tag if tag is not None else row["tag"]).strip() or row["tag"]
        if not new_tag.startswith("artist:"):
            new_tag = f"artist:{new_tag}"
        new_cat = (category if category is not None else row["category"]).strip() or row["category"]
        new_desc = (desc if desc is not None else row["desc"]).strip()
        new_sample = (sample_tags if sample_tags is not None else row["sample_tags"]).strip()
        new_style_tags_json = (
            json.dumps(_normalize_str_list(style_tags), ensure_ascii=False)
            if style_tags is not None
            else (row["style_tags_json"] or "[]")
        )
        new_post_count = int(post_count) if post_count is not None else int(row["post_count"] or 0)
        new_weight_hint = (weight_hint if weight_hint is not None else (row["weight_hint"] or "")).strip()
        new_aliases = (aliases if aliases is not None else (row["aliases"] or "")).strip()
        new_urls_json = (
            json.dumps(_normalize_str_list(urls), ensure_ascii=False)
            if urls is not None
            else (row["urls_json"] or "[]")
        )
        new_notes = (notes if notes is not None else (row["notes"] or "")).strip()
        conn.execute(
            """
            UPDATE artists
            SET name = ?, tag = ?, category = ?, desc = ?, sample_tags = ?,
                style_tags_json = ?, post_count = ?, weight_hint = ?,
                aliases = ?, urls_json = ?, notes = ?
            WHERE id = ?
            """,
            (
                new_name,
                new_tag,
                new_cat,
                new_desc,
                new_sample,
                new_style_tags_json,
                new_post_count,
                new_weight_hint,
                new_aliases,
                new_urls_json,
                new_notes,
                artist_id,
            ),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
        return _row_to_artist(updated) if updated else None


def delete_artist(artist_id: int) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT id, preview_url FROM artists WHERE id = ?", (artist_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM artists WHERE id = ?", (artist_id,))
        conn.commit()
    return True


def toggle_artist_favorite(artist_id: int) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        conn.execute("UPDATE artists SET favorite = CASE WHEN favorite = 1 THEN 0 ELSE 1 END WHERE id = ?", (artist_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
        return _row_to_artist(row) if row else None


def upsert_artist(
    name: str,
    tag: str,
    category: str = "私人收藏",
    desc: str = "",
    sample_tags: str = "",
    preview_url: str = "",
    is_custom: bool = True,
    style_tags: Optional[Any] = None,
    post_count: int = 0,
    weight_hint: str = "",
    aliases: str = "",
    urls: Optional[Any] = None,
    notes: str = "",
) -> Dict[str, Any]:
    clean_tag = tag.strip()
    if not clean_tag.startswith("artist:"):
        clean_tag = f"artist:{clean_tag}"
    now = int(time.time())
    st_json = json.dumps(_normalize_str_list(style_tags), ensure_ascii=False) if style_tags is not None else "[]"
    u_json = json.dumps(_normalize_str_list(urls), ensure_ascii=False) if urls is not None else "[]"
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM artists WHERE tag = ?", (clean_tag,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE artists
                SET name = COALESCE(NULLIF(?, ''), name),
                    category = COALESCE(NULLIF(?, ''), category),
                    desc = COALESCE(NULLIF(?, ''), desc),
                    preview_url = COALESCE(NULLIF(?, ''), preview_url),
                    style_tags_json = CASE WHEN ? != '[]' THEN ? ELSE style_tags_json END,
                    post_count = CASE WHEN ? > 0 THEN ? ELSE post_count END,
                    weight_hint = COALESCE(NULLIF(?, ''), weight_hint),
                    aliases = COALESCE(NULLIF(?, ''), aliases),
                    urls_json = CASE WHEN ? != '[]' THEN ? ELSE urls_json END,
                    notes = COALESCE(NULLIF(?, ''), notes)
                WHERE id = ?
                """,
                (
                    name,
                    category,
                    desc,
                    preview_url,
                    st_json,
                    st_json,
                    int(post_count or 0),
                    int(post_count or 0),
                    weight_hint,
                    aliases,
                    u_json,
                    u_json,
                    notes,
                    existing["id"],
                ),
            )
            aid = existing["id"]
        else:
            cur = conn.execute(
                """
                INSERT INTO artists (
                    name, tag, category, desc, sample_tags,
                    style_tags_json, post_count, weight_hint, aliases, urls_json, notes,
                    preview_url, favorite, is_custom, palette_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    name or clean_tag.replace("artist:", ""),
                    clean_tag,
                    category or "私人收藏",
                    desc or "用户自定义收录画师标准预览卡",
                    sample_tags,
                    st_json,
                    int(post_count or 0),
                    weight_hint,
                    aliases,
                    u_json,
                    notes,
                    preview_url,
                    1 if is_custom else 0,
                    json.dumps(["#3b82f6", "#06b6d4"]),
                    now,
                ),
            )
            aid = cur.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM artists WHERE id = ?", (aid,)).fetchone()
        return _row_to_artist(row)


def update_artist_preview(artist_id: int, preview_url: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        conn.execute("UPDATE artists SET preview_url = ? WHERE id = ?", (preview_url, artist_id))
        conn.commit()
        row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
        return _row_to_artist(row) if row else None


def list_mix_presets() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM mix_presets ORDER BY id DESC").fetchall()
        return [{"id": r["id"], "name": r["name"], "items": json.loads(r["items_json"]), "created_at": r["created_at"]} for r in rows]


def add_mix_preset(name: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    now = int(time.time())
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO mix_presets (name, items_json, created_at) VALUES (?, ?, ?)",
            (name, json.dumps(items, ensure_ascii=False), now),
        )
        conn.commit()
        return {"id": cur.lastrowid, "name": name, "items": items, "created_at": now}


def delete_mix_preset(preset_id: int) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM mix_presets WHERE id = ?", (preset_id,))
        conn.commit()
    return True


def list_snippets() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM prompt_snippets ORDER BY id ASC").fetchall()
        return [dict(r) for r in rows]


def add_snippet(label: str, tags: str, cat: str = "custom") -> Dict[str, Any]:
    with get_conn() as conn:
        cur = conn.execute("INSERT INTO prompt_snippets (label, tags, cat) VALUES (?, ?, ?)", (label.strip(), tags.strip(), cat))
        conn.commit()
        return {"id": cur.lastrowid, "label": label.strip(), "tags": tags.strip(), "cat": cat}


def delete_snippet(snippet_id: int) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM prompt_snippets WHERE id = ?", (snippet_id,))
        conn.commit()
    return True


def list_oc_cards() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM oc_cards ORDER BY favorite DESC, id DESC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["favorite"] = bool(d.get("favorite"))
            out.append(d)
        return out


def save_oc_card(name: str, prompt: str, uc: str = "", avatar_url: str = "", default_x: float = 0.5, default_y: float = 0.5) -> Dict[str, Any]:
    now = int(time.time())
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO oc_cards (name, avatar_url, prompt, uc, default_x, default_y, favorite, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
            (name.strip(), avatar_url.strip(), prompt.strip(), uc.strip(), float(default_x), float(default_y), now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM oc_cards WHERE id = ?", (cur.lastrowid,)).fetchone()
        d = dict(row)
        d["favorite"] = bool(d.get("favorite"))
        return d


def update_oc_avatar(card_id: int, avatar_url: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        conn.execute("UPDATE oc_cards SET avatar_url = ? WHERE id = ?", (avatar_url.strip(), card_id))
        conn.commit()
        row = conn.execute("SELECT * FROM oc_cards WHERE id = ?", (card_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["favorite"] = bool(d.get("favorite"))
        return d


def delete_oc_card(card_id: int) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM oc_cards WHERE id = ?", (card_id,))
        conn.commit()
    return True


def create_agent_session(title: str = "新创作对话", session_id: Optional[str] = None, pinned_skills: Optional[List[str]] = None) -> Dict[str, Any]:
    import uuid
    sid = (session_id or f"s_{uuid.uuid4().hex[:12]}").strip()
    now = int(time.time())
    skills = pinned_skills or []
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO agent_sessions (id, title, pinned_skills_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (sid, (title or "新创作对话").strip()[:80], json.dumps(skills, ensure_ascii=False), now, now),
        )
        conn.commit()
    return {"id": sid, "title": (title or "新创作对话").strip()[:80], "pinned_skills": skills, "created_at": now, "updated_at": now}


def list_agent_sessions(limit: int = 20) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT ?",
            (max(1, int(limit)),),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["pinned_skills"] = json.loads(d.pop("pinned_skills_json", "[]") or "[]")
            except Exception:
                d["pinned_skills"] = []
            out.append(d)
        return out


def get_agent_session(session_id: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM agent_sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["pinned_skills"] = json.loads(d.pop("pinned_skills_json", "[]") or "[]")
        except Exception:
            d["pinned_skills"] = []
        msgs = conn.execute(
            "SELECT * FROM agent_messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        d["messages"] = []
        for m in msgs:
            md = dict(m)
            try:
                md["tool_events"] = json.loads(md.pop("tool_events_json", "[]") or "[]")
            except Exception:
                md["tool_events"] = []
            try:
                md["ui_actions"] = json.loads(md.pop("ui_actions_json", "[]") or "[]")
            except Exception:
                md["ui_actions"] = []
            d["messages"].append(md)
        return d


def append_agent_message(
    session_id: str,
    role: str,
    content: str,
    tool_events: Optional[List[Dict[str, Any]]] = None,
    ui_actions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    now = int(time.time())
    te = tool_events or []
    ua = ui_actions or []
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO agent_messages (session_id, role, content, tool_events_json, ui_actions_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, role, content, json.dumps(te, ensure_ascii=False), json.dumps(ua, ensure_ascii=False), now),
        )
        conn.execute("UPDATE agent_sessions SET updated_at = ? WHERE id = ?", (now, session_id))
        conn.commit()
        return {
            "id": cur.lastrowid,
            "session_id": session_id,
            "role": role,
            "content": content,
            "tool_events": te,
            "ui_actions": ua,
            "created_at": now,
        }


def update_agent_session_meta(session_id: str, title: Optional[str] = None, pinned_skills: Optional[List[str]] = None) -> None:
    now = int(time.time())
    with get_conn() as conn:
        if title is not None:
            conn.execute("UPDATE agent_sessions SET title = ?, updated_at = ? WHERE id = ?", (title.strip()[:80], now, session_id))
        if pinned_skills is not None:
            conn.execute(
                "UPDATE agent_sessions SET pinned_skills_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(pinned_skills, ensure_ascii=False), now, session_id),
            )
        conn.commit()


def delete_agent_session(session_id: str) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM agent_messages WHERE session_id = ?", (session_id,))
        cur = conn.execute("DELETE FROM agent_sessions WHERE id = ?", (session_id,))
        conn.commit()
        return bool(cur.rowcount)


def replace_agent_session_messages(session_id: str, summary_text: str) -> Dict[str, Any]:
    now = int(time.time())
    with get_conn() as conn:
        before_cnt = conn.execute(
            "SELECT COUNT(*) FROM agent_messages WHERE session_id = ?", (session_id,)
        ).fetchone()[0]
        conn.execute("DELETE FROM agent_messages WHERE session_id = ?", (session_id,))
        cur = conn.execute(
            """
            INSERT INTO agent_messages (session_id, role, content, tool_events_json, ui_actions_json, created_at)
            VALUES (?, 'assistant', ?, '[]', '[]', ?)
            """,
            (session_id, summary_text, now),
        )
        conn.execute("UPDATE agent_sessions SET updated_at = ? WHERE id = ?", (now, session_id))
        conn.commit()
        return {
            "before_count": int(before_cnt or 0),
            "after_count": 1,
            "summary_msg_id": cur.lastrowid,
        }


# ================= A2A External Agent Tasks =================
def _row_to_a2a_task(row: sqlite3.Row) -> Dict[str, Any]:
    d = dict(row)
    for src, dst, default in (
        ("artifacts_json", "artifacts", []),
        ("history_json", "history", []),
        ("metadata_json", "metadata", {}),
    ):
        try:
            d[dst] = json.loads(d.pop(src, None) or json.dumps(default))
        except Exception:
            d[dst] = default
    return d


def create_a2a_task(
    task_id: str,
    context_id: str,
    brief: str,
    state: str = "submitted",
    history: Optional[List[Dict[str, Any]]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    now = int(time.time())
    hist = history or []
    meta = metadata or {}
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO a2a_tasks (id, context_id, state, brief, result_text, artifacts_json, history_json, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, '', '[]', ?, ?, ?, ?)
            """,
            (
                task_id,
                context_id,
                state,
                str(brief or "")[:2000],
                json.dumps(hist, ensure_ascii=False),
                json.dumps(meta, ensure_ascii=False),
                now,
                now,
            ),
        )
        conn.commit()
    return get_a2a_task(task_id) or {
        "id": task_id,
        "context_id": context_id,
        "state": state,
        "brief": brief,
        "result_text": "",
        "artifacts": [],
        "history": hist,
        "metadata": meta,
        "created_at": now,
        "updated_at": now,
    }


def update_a2a_task(
    task_id: str,
    *,
    state: Optional[str] = None,
    result_text: Optional[str] = None,
    artifacts: Optional[List[Dict[str, Any]]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    now = int(time.time())
    sets = ["updated_at = ?"]
    params: List[Any] = [now]
    if state is not None:
        sets.append("state = ?")
        params.append(state)
    if result_text is not None:
        sets.append("result_text = ?")
        params.append(result_text)
    if artifacts is not None:
        sets.append("artifacts_json = ?")
        params.append(json.dumps(artifacts, ensure_ascii=False))
    if history is not None:
        sets.append("history_json = ?")
        params.append(json.dumps(history, ensure_ascii=False))
    if metadata is not None:
        sets.append("metadata_json = ?")
        params.append(json.dumps(metadata, ensure_ascii=False))
    params.append(task_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE a2a_tasks SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
    return get_a2a_task(task_id)


def get_a2a_task(task_id: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM a2a_tasks WHERE id = ?", (task_id,)).fetchone()
        return _row_to_a2a_task(row) if row else None


def list_a2a_tasks(limit: int = 20) -> List[Dict[str, Any]]:
    lim = max(1, min(100, int(limit or 20)))
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM a2a_tasks ORDER BY updated_at DESC LIMIT ?", (lim,)).fetchall()
        return [_row_to_a2a_task(r) for r in rows]


