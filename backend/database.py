import contextlib
import json
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
    {"label": "✨ 电影逆光", "tags": "cinematic lighting, backlighting, rim lighting, lens flare", "cat": "lighting"},
    {"label": "💧 晶透水滴", "tags": "water drop, sparkles, chromatic aberration, depth of field", "cat": "atmosphere"},
    {"label": "🌅 逢魔暮色", "tags": "twilight, sunset, golden hour, dappled sunlight, bokeh", "cat": "atmosphere"},
    {"label": "🌬 飘逸微风", "tags": "wind, floating hair, floating petals, dynamic angle", "cat": "motion"},
    {"label": "👁 精致眼眸", "tags": "detailed eyes, sparkling eyes, looking at viewer, light smile", "cat": "detail"},
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
                preview_url TEXT DEFAULT '',
                favorite INTEGER DEFAULT 0,
                is_custom INTEGER DEFAULT 0,
                palette_json TEXT DEFAULT '["#2563eb","#38bdf8"]',
                created_at INTEGER NOT NULL
            )
            """
        )
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
                item["model"],
                item["model_short"],
                item.get("action", "generate"),
                item["prompt"],
                item.get("uc", ""),
                int(item["width"]),
                int(item["height"]),
                int(item["steps"]),
                float(item["scale"]),
                float(item.get("cfg_rescale", 0.0)),
                item["sampler"],
                item["scheduler"],
                int(item["seed"]),
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
    sql = "SELECT COUNT(*) FROM gallery WHERE 1=1"
    params: List[Any] = []
    if search.strip():
        sql += " AND (prompt LIKE ? OR notes LIKE ? OR CAST(seed AS TEXT) LIKE ?)"
        q = f"%{search.strip()}%"
        params.extend([q, q, q])
    if model.strip() and model != "all":
        sql += " AND model = ?"
        params.append(model.strip())
    if favorite_only:
        sql += " AND favorite = 1"
    with get_conn() as conn:
        row = conn.execute(sql, params).fetchone()
        return int(row[0] if row else 0)


def list_gallery(
    search: str = "",
    model: str = "",
    favorite_only: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM gallery WHERE 1=1"
    params: List[Any] = []
    if search.strip():
        sql += " AND (prompt LIKE ? OR notes LIKE ? OR CAST(seed AS TEXT) LIKE ?)"
        q = f"%{search.strip()}%"
        params.extend([q, q, q])
    if model.strip() and model != "all":
        sql += " AND model = ?"
        params.append(model.strip())
    if favorite_only:
        sql += " AND favorite = 1"
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
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


def batch_delete_gallery(unfav_only: bool = True, delete_file: bool = True) -> int:
    with get_conn() as conn:
        if unfav_only:
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


def sync_outputs_folder(outputs_root: Optional[Path] = None) -> Dict[str, Any]:
    root = (outputs_root or OUTPUTS_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        existing_paths = {r["rel_path"] for r in conn.execute("SELECT rel_path FROM gallery").fetchall()}

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
    return {"scanned": True, "added_count": added_count}


def list_artists(search: str = "", category: str = "", favorite_only: bool = False) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM artists WHERE 1=1"
    params: List[Any] = []
    if search.strip():
        q = f"%{search.strip()}%"
        sql += " AND (name LIKE ? OR tag LIKE ? OR desc LIKE ? OR category LIKE ?)"
        params.extend([q, q, q, q])
    if category.strip() and category != "all":
        sql += " AND category = ?"
        params.append(category.strip())
    if favorite_only:
        sql += " AND favorite = 1"
    sql += " ORDER BY favorite DESC, id ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["favorite"] = bool(d["favorite"])
            d["is_custom"] = bool(d["is_custom"])
            d["palette"] = json.loads(d.pop("palette_json", '["#2563eb","#38bdf8"]'))
            result.append(d)
        return result


def toggle_artist_favorite(artist_id: int) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        conn.execute("UPDATE artists SET favorite = CASE WHEN favorite = 1 THEN 0 ELSE 1 END WHERE id = ?", (artist_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["favorite"] = bool(d["favorite"])
        d["is_custom"] = bool(d["is_custom"])
        d["palette"] = json.loads(d.pop("palette_json", '["#2563eb","#38bdf8"]'))
        return d


def upsert_artist(
    name: str,
    tag: str,
    category: str = "私人收藏",
    desc: str = "",
    sample_tags: str = "",
    preview_url: str = "",
    is_custom: bool = True,
) -> Dict[str, Any]:
    clean_tag = tag.strip()
    if not clean_tag.startswith("artist:"):
        clean_tag = f"artist:{clean_tag}"
    now = int(time.time())
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM artists WHERE tag = ?", (clean_tag,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE artists
                SET name = COALESCE(NULLIF(?, ''), name),
                    category = COALESCE(NULLIF(?, ''), category),
                    desc = COALESCE(NULLIF(?, ''), desc),
                    preview_url = COALESCE(NULLIF(?, ''), preview_url)
                WHERE id = ?
                """,
                (name, category, desc, preview_url, existing["id"]),
            )
            aid = existing["id"]
        else:
            cur = conn.execute(
                """
                INSERT INTO artists (name, tag, category, desc, sample_tags, preview_url, favorite, is_custom, palette_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    name or clean_tag.replace("artist:", ""),
                    clean_tag,
                    category or "私人收藏",
                    desc or "用户自定义收录画师标准预览卡",
                    sample_tags or "1girl, solo, silver hair, blue eyes, sunset, detailed eyes",
                    preview_url,
                    1 if is_custom else 0,
                    json.dumps(["#3b82f6", "#06b6d4"]),
                    now,
                ),
            )
            aid = cur.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM artists WHERE id = ?", (aid,)).fetchone()
        d = dict(row)
        d["favorite"] = bool(d["favorite"])
        d["is_custom"] = bool(d["is_custom"])
        d["palette"] = json.loads(d.pop("palette_json", '["#3b82f6","#06b6d4"]'))
        return d


def update_artist_preview(artist_id: int, preview_url: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        conn.execute("UPDATE artists SET preview_url = ? WHERE id = ?", (preview_url, artist_id))
        conn.commit()
        row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["favorite"] = bool(d["favorite"])
        d["is_custom"] = bool(d["is_custom"])
        d["palette"] = json.loads(d.pop("palette_json", '["#3b82f6","#06b6d4"]'))
        return d


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
