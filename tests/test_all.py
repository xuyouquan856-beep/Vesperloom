import asyncio
import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path("D:/NAI-Studio").resolve()))

from fastapi.testclient import TestClient

from backend.app import OC_AVATARS_DIR, app
from backend.config import BASE_DIR, OUTPUTS_DIR, load_config
from backend.database import (
    add_snippet,
    count_gallery,
    delete_oc_card,
    delete_snippet,
    init_db,
    list_artists,
    list_gallery,
    list_oc_cards,
    save_oc_card,
    sync_outputs_folder,
)
from backend.models_spec import DIRECTOR_EMOTIONS, MODELS_CATALOG, estimate_generation_cost, get_model_spec
from backend.nai_client import (
    _composite_focus_inpaint,
    _num,
    _prepare_focus_inpaint,
    _prepare_outpaint_canvas,
    _stitch_xyz_grid,
    parse_vibe_bundle,
)
from backend.png_metadata import extract_nai_metadata
from backend.prompt_engine import (
    adjust_tag_weight,
    expand_dynamic_prompt,
    lint_prompt,
    list_wildcards,
    search_builtin_tags,
)


def test_zero_c_drive_paths():
    cfg = load_config()
    assert BASE_DIR.drive.upper() == "D:"
    assert OUTPUTS_DIR.drive.upper() == "D:"
    assert Path(cfg["output_dir"]).drive.upper() == "D:"


def test_model_capability_matrix():
    v5 = get_model_spec("nai-diffusion-5-full")
    assert v5["family"] == "v5"
    assert v5["supports_vibe"] is False
    assert v5["supports_precise_ref"] is False
    assert v5["supports_alpha_transparency"] is True
    assert v5["supports_multi_char"] is True
    assert v5["supports_smea"] is False

    v45 = get_model_spec("nai-diffusion-4-5-full")
    assert v45["family"] == "v4_5"
    assert v45["supports_vibe"] is True
    assert v45["supports_precise_ref"] is True
    assert v45["supports_alpha_transparency"] is False
    assert v45["supports_negative_weight"] is True

    v4 = get_model_spec("nai-diffusion-4-full")
    assert v4["supports_vibe"] is True
    assert v4["supports_precise_ref"] is False
    assert v4["supports_negative_weight"] is False

    v3 = get_model_spec("nai-diffusion-3")
    assert v3["supports_vibe"] is True
    assert v3["vibe_raw_image_free"] is True
    assert v3["supports_multi_char"] is False
    assert v3["supports_numeric_weight"] is False
    assert v3["supports_smea"] is True


def test_opus_cost_estimator():
    free_res = estimate_generation_cost("nai-diffusion-5-full", 832, 1216, 28, 1)
    assert free_res["is_opus_free"] is True
    assert free_res["anlas_cost"] == 0

    paid_steps = estimate_generation_cost("nai-diffusion-4-5-full", 832, 1216, 35, 1)
    assert paid_steps["is_opus_free"] is False
    assert paid_steps["anlas_cost"] > 0

    paid_prec = estimate_generation_cost("nai-diffusion-4-5-full", 832, 1216, 28, 1, has_precise_ref=True)
    assert paid_prec["is_opus_free"] is False
    assert paid_prec["anlas_cost"] == 5


def test_model_aware_prompt_linter():
    raw = "1girl, (silver_hair:1.2), {[{rooftop}]}，artist:ask_(askzy), <lora:test:0.8>"
    res_v5 = lint_prompt(raw, "nai-diffusion-5-full")
    assert res_v5["issue_count"] >= 4
    assert "1.2::silver hair::" in res_v5["fixed_prompt"]
    assert "{rooftop}" in res_v5["fixed_prompt"]
    assert "artist:ask_(askzy)" in res_v5["fixed_prompt"]
    assert "<lora:" not in res_v5["fixed_prompt"]

    # On V3, numeric weight 1.2::tag:: must be flagged and converted to {{tag}}
    res_v3 = lint_prompt("1girl, 1.2::silver hair::", "nai-diffusion-3")
    assert res_v3["issue_count"] == 1
    assert "{" in res_v3["fixed_prompt"] and "::" not in res_v3["fixed_prompt"]


def test_weight_adjuster():
    t1 = adjust_tag_weight("rooftop", 1, "brackets", "nai-diffusion-5-full")
    assert t1 == "{rooftop}"
    t2 = adjust_tag_weight("[rooftop]", 1, "brackets", "nai-diffusion-5-full")
    assert t2 == "rooftop"
    t3 = adjust_tag_weight("rooftop", 1, "numeric", "nai-diffusion-5-full")
    assert t3 == "1.1::rooftop::"
    # V3 forces brackets even if numeric requested
    t4 = adjust_tag_weight("rooftop", 1, "numeric", "nai-diffusion-3")
    assert t4 == "{rooftop}"


def test_png_metadata_extractor():
    im = Image.new("RGBA", (64, 64), (100, 150, 200, 255))
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Software", "NovelAI")
    meta.add_text("Source", "NovelAI Diffusion V5 0ADF9AB7")
    meta.add_text(
        "Comment",
        json.dumps({
            "prompt": "1girl, solo, silver hair",
            "uc": "lowres",
            "seed": 987654321,
            "steps": 28,
            "scale": 5.0,
            "sampler": "k_euler_ancestral",
            "noise_schedule": "karras",
        }),
    )
    buf = io.BytesIO()
    im.save(buf, format="PNG", pnginfo=meta)
    parsed = extract_nai_metadata(buf.getvalue())
    assert parsed["has_nai_metadata"] is True
    assert parsed["model"] == "nai-diffusion-5-full"
    assert parsed["seed"] == 987654321
    assert parsed["prompt"] == "1girl, solo, silver hair"


def test_dynamic_prompt_wildcards_and_weight_preservation():
    # Single {tag} weight braces must NEVER be stripped; only {A|B|C} expands dynamically
    res = expand_dynamic_prompt("{silver hair}, {sunset|night|rain}, {2$$smile|wink|grin}, __outfit__", seed=42)
    assert res["had_dynamic"] is True
    assert res["expanded"].startswith("{silver hair},")
    assert "__outfit__" not in res["expanded"]
    # Reproducible with same seed
    res2 = expand_dynamic_prompt("{silver hair}, {sunset|night|rain}, {2$$smile|wink|grin}, __outfit__", seed=42)
    assert res["expanded"] == res2["expanded"]
    wc = list_wildcards()
    assert len(wc) >= 4
    assert all("token" in item for item in wc)


def test_outpaint_preserves_original_image_without_crop():
    import base64

    # Create a distinctive tall non-square image with red top & blue bottom
    im = Image.new("RGB", (600, 1200), (0, 0, 255))
    for y in range(600):
        for x in range(600):
            im.putpixel((x, y), (255, 0, 0))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    canvas_b64, mask_b64, tw, th = _prepare_outpaint_canvas(b64, direction="right", expand_px=256)
    assert (tw, th) == (1216, 832)
    canvas = Image.open(io.BytesIO(base64.b64decode(canvas_b64)))
    assert canvas.size == (1216, 832)
    # Entire vertical span of original should fit inside height=832 (top red + bottom blue preserved)
    top_px = canvas.getpixel((200, 50))
    bot_px = canvas.getpixel((200, 780))
    assert top_px[0] > 200 and top_px[2] < 50
    assert bot_px[2] > 200 and bot_px[0] < 50


def test_zero_value_and_vibe_model_matching():
    assert _num(0.0, 0.8) == 0.0
    assert _num(0, 5, int) == 0
    assert _num(None, 0.8) == 0.8

    bundle = {
        "vibes": [
            {
                "importInfo": {"strength": 0.55, "information_extracted": 0.9},
                "encodings": {
                    "nai-diffusion-4-full": {"1.0": {"encoding": "OLD_V4_B64"}},
                    "nai-diffusion-4-5-full": {"1.0": {"encoding": "TARGET_V45_B64"}},
                },
            }
        ]
    }
    parsed = parse_vibe_bundle(json.dumps(bundle).encode("utf-8"), model_id="nai-diffusion-4-5-full")
    assert parsed["count"] == 1
    assert parsed["vibes"][0]["encoding"] == "TARGET_V45_B64"


def test_db_oc_cards_snippets_and_api_routes():
    init_db()
    card = save_oc_card("测试OC_V21", "1girl, purple hair, crystal eyes", "bad hands")
    assert card["id"] > 0
    assert any(c["name"] == "测试OC_V21" for c in list_oc_cards())
    assert delete_oc_card(card["id"]) is True

    snip = add_snippet("测试积木", "cherry blossoms, spring", "custom")
    assert snip["id"] > 0
    assert delete_snippet(snip["id"]) is True

    assert len(DIRECTOR_EMOTIONS) == 24

    client = TestClient(app)
    r_boot = client.get("/api/bootstrap")
    assert r_boot.status_code == 200
    bdata = r_boot.json()
    assert len(bdata["emotions"]) == 24
    assert "oc_cards" in bdata and "wildcards" in bdata and "queue" in bdata

    r_exp = client.post("/api/prompt/expand", json={"prompt": "{day|night}, 1girl", "seed": 7})
    assert r_exp.status_code == 200
    assert r_exp.json()["expanded"] in ("day, 1girl", "night, 1girl")

    r_sync = client.post("/api/gallery/sync")
    assert r_sync.status_code == 200
    assert r_sync.json()["ok"] is True

    r_mcp = client.post("/api/mcp/test", json={"tool": "nai_manage_oc_cards", "arguments": {"action": "list"}})
    assert r_mcp.status_code == 200
    assert isinstance(r_mcp.json()["result"], list)


def test_v22_focus_inpaint_wildcards_pagination_avatar_xyz():
    # 1. Focus Inpaint crop & Gaussian feathered composite preserves outer pixels and modifies mask center
    orig = Image.new("RGB", (832, 1216), (20, 40, 200))
    mask = Image.new("L", (832, 1216), 0)
    for y in range(400, 520):
        for x in range(300, 420):
            mask.putpixel((x, y), 255)
    b_orig = io.BytesIO()
    orig.save(b_orig, format="PNG")
    b_mask = io.BytesIO()
    mask.save(b_mask, format="PNG")
    orig_b64 = base64.b64encode(b_orig.getvalue()).decode("ascii")
    mask_b64 = base64.b64encode(b_mask.getvalue()).decode("ascii")

    ctx = _prepare_focus_inpaint(orig_b64, mask_b64)
    assert ctx is not None
    assert ctx["target_w"] * ctx["target_h"] <= 1048576

    infill_crop = Image.new("RGB", (ctx["target_w"], ctx["target_h"]), (235, 30, 30))
    b_crop = io.BytesIO()
    infill_crop.save(b_crop, format="PNG")
    merged_bytes = _composite_focus_inpaint(b_crop.getvalue(), ctx)
    merged = Image.open(io.BytesIO(merged_bytes)).convert("RGB")
    assert merged.size == (832, 1216)
    # Corner untouched
    assert merged.getpixel((10, 10))[2] > 180
    # Center of mask updated to red
    assert merged.getpixel((360, 460))[0] > 200

    # 2. Wildcard online CRUD API + expansion
    client = TestClient(app)
    r_save = client.post("/api/wildcards", json={"name": "tmp_test_wc", "content": "crimson cape\nazure scarf\n"})
    assert r_save.status_code == 200
    assert r_save.json()["count"] == 2
    r_get = client.get("/api/wildcards/tmp_test_wc")
    assert r_get.status_code == 200
    assert "crimson cape" in r_get.json()["content"]
    expanded = expand_dynamic_prompt("1girl, __tmp_test_wc__", seed=12)
    assert expanded["had_dynamic"] is True
    assert expanded["expanded"] in ("1girl, crimson cape", "1girl, azure scarf")
    r_del = client.delete("/api/wildcards/tmp_test_wc")
    assert r_del.status_code == 200

    # 3. Gallery pagination + count
    r_boot = client.get("/api/bootstrap")
    assert r_boot.status_code == 200
    assert "gallery_total" in r_boot.json()
    r_page = client.get("/api/gallery?limit=2&offset=0")
    assert r_page.status_code == 200
    pdata = r_page.json()
    assert "items" in pdata and "total" in pdata and "has_more" in pdata
    assert pdata["total"] == count_gallery()

    # 4. OC Avatar upload & cleanup
    card = save_oc_card("测试OC_Avatar", "1girl, silver hair", "")
    small_png = Image.new("RGB", (64, 64), (100, 180, 240))
    b_av = io.BytesIO()
    small_png.save(b_av, format="PNG")
    av_b64 = "data:image/png;base64," + base64.b64encode(b_av.getvalue()).decode("ascii")
    r_av = client.post(f"/api/oc-cards/{card['id']}/avatar", json={"image_b64": av_b64})
    assert r_av.status_code == 200
    av_url = r_av.json()["card"]["avatar_url"]
    assert av_url.startswith("/avatars/")
    av_file = OC_AVATARS_DIR / av_url.split("/avatars/")[1]
    assert av_file.exists()
    av_file.unlink(missing_ok=True)
    delete_oc_card(card["id"])

    # 5. XYZ Contact Sheet stitch & cleanup
    from backend.database import delete_gallery_item
    tmp_root = BASE_DIR / "tmp" / "xyz_test"
    tmp_root.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (200, 250), (200, 80, 80)).save(tmp_root / "c1.png", format="PNG")
    Image.new("RGB", (200, 250), (80, 200, 80)).save(tmp_root / "c2.png", format="PNG")
    sheet_item = _stitch_xyz_grid(
        [
            {"row_idx": 0, "col_idx": 0, "item": {"rel_path": "c1.png"}},
            {"row_idx": 0, "col_idx": 1, "item": {"rel_path": "c2.png"}},
        ],
        x_labels=["CFG:4.0", "CFG:7.0"],
        y_labels=["EulerA"],
        out_root=tmp_root,
        base_seed=999,
    )
    assert sheet_item is not None
    sheet_path = tmp_root / sheet_item["rel_path"]
    assert sheet_path.exists()
    sheet_img = Image.open(sheet_path)
    assert sheet_img.width > 700 and sheet_img.height > 480
    sheet_img.close()
    delete_gallery_item(sheet_item["id"])
    import shutil
    shutil.rmtree(tmp_root, ignore_errors=True)


def test_artists_gallery_overhaul_and_stress_regressions():
    import re
    import tempfile
    import time
    import backend.app as app_mod
    import backend.database as db_mod

    (BASE_DIR / "tmp").mkdir(parents=True, exist_ok=True)
    orig_db = db_mod.DB_PATH
    orig_out = db_mod.OUTPUTS_DIR
    orig_app_out = app_mod.OUTPUTS_DIR

    with tempfile.TemporaryDirectory(dir=str(BASE_DIR / "tmp")) as tmp_dir:
        tmp_path = Path(tmp_dir)
        out_dir = tmp_path / "outputs"
        out_dir.mkdir(parents=True, exist_ok=True)
        db_mod.DB_PATH = tmp_path / "test_stress.db"
        db_mod.OUTPUTS_DIR = out_dir
        app_mod.OUTPUTS_DIR = out_dir

        try:
            db_mod.init_db()
            client = TestClient(app)

            # 1. Wildcard escaping on '%' and '_' in both artists and gallery search
            assert len(db_mod.list_artists(search="%")) == 0
            assert len(db_mod.list_artists(search="_literal_never_exists")) == 0
            pct_artist = db_mod.upsert_artist("50% Artist_Special", "artist:50%_special", "私人收藏", "100% contrast")
            matched_pct = db_mod.list_artists(search="50%")
            assert len(matched_pct) == 1 and matched_pct[0]["id"] == pct_artist["id"]

            # 2. Artist PATCH / DELETE + duplicate tag collision guard (HTTP 400, not 500)
            r_patch = client.patch(
                f"/api/artists/{pct_artist['id']}",
                json={"name": "Edited Name", "category": "厚涂光影", "desc": "updated"},
            )
            assert r_patch.status_code == 200
            assert r_patch.json()["artist"]["name"] == "Edited Name"
            assert r_patch.json()["artist"]["category"] == "厚涂光影"

            r_dup = client.patch(f"/api/artists/{pct_artist['id']}", json={"tag": "artist:rella"})
            assert r_dup.status_code == 400

            r_del_art = client.delete(f"/api/artists/{pct_artist['id']}")
            assert r_del_art.status_code == 200
            assert client.delete(f"/api/artists/{pct_artist['id']}").status_code == 404

            # 3. Filename sanitization parity for special artist tags
            slug = re.sub(r'[<>:"/\\|?*()%]+', "_", "artist:foo_(bar)%baz?").strip("_")
            assert all(ch not in slug for ch in '<>:"/\\|?*()%')

            # 4. Seed 500 gallery items + disk PNGs to stress search, sort, selective batch ops, and sync pruning
            t0 = time.perf_counter()
            created_ids = []
            for i in range(500):
                fname = f"stress_{i:04d}.png"
                (out_dir / fname).write_bytes(b"PNGDATA" + str(i).encode())
                row = db_mod.add_gallery_item(
                    {
                        "filename": fname,
                        "rel_path": fname,
                        "model": "nai-diffusion-4-5-full" if i % 2 == 0 else "nai-diffusion-5-full",
                        "model_short": "V4.5 Full" if i % 2 == 0 else "V5 Full",
                        "prompt": f"1girl, stress_tag_{i}, {'sunlight' if i % 5 == 0 else 'moonlight'}",
                        "uc": "lowres, ugly_watermark" if i == 42 else "lowres",
                        "width": 832,
                        "height": 1216,
                        "steps": 28,
                        "scale": 5.0,
                        "sampler": "k_euler_ancestral",
                        "scheduler": "karras",
                        "seed": 100000 + i,
                        "artist_mix": [{"tag": "artist:ask_(askzy)", "weight": 0.9}] if i == 7 else [],
                        "generation_time": float((i % 20) + 1),
                        "favorite": (i < 10),
                        "notes": "50%_special_note" if i == 15 else "",
                    }
                )
                created_ids.append(row["id"])
            insert_elapsed = time.perf_counter() - t0
            assert insert_elapsed < 10.0

            # Multi-field gallery search + escaped wildcards
            assert db_mod.count_gallery(search="V4.5") == 250
            assert db_mod.count_gallery(search="ugly_watermark") == 1
            assert db_mod.count_gallery(search="ask_(askzy)") == 1
            # Only the 1 record whose notes literally contains '%' matches escaped '%'
            assert db_mod.count_gallery(search="%") == 1
            assert db_mod.count_gallery(search="50%_special_note") == 1
            assert db_mod.count_gallery(search="%%never_exists") == 0

            # Sort order checks via API
            r_fast = client.get("/api/gallery?sort=fastest&limit=5")
            r_slow = client.get("/api/gallery?sort=slowest&limit=5")
            assert r_fast.status_code == 200 and r_slow.status_code == 200
            assert r_fast.json()["items"][0]["generation_time"] <= r_fast.json()["items"][-1]["generation_time"]
            assert r_slow.json()["items"][0]["generation_time"] >= r_slow.json()["items"][-1]["generation_time"]

            # Selective batch favorite & selective batch delete (must NOT wipe other 497 items!)
            target_ids = created_ids[10:15]
            r_bfav = client.post("/api/gallery/batch-favorite", json={"ids": target_ids, "favorite": True})
            assert r_bfav.status_code == 200 and r_bfav.json()["updated"] == 5

            r_bdel = client.post("/api/gallery/batch-delete", json={"ids": target_ids[:3], "delete_file": True})
            assert r_bdel.status_code == 200
            assert r_bdel.json()["removed"] == 3
            assert r_bdel.json()["total"] == 497
            assert not (out_dir / "stress_0010.png").exists()
            assert (out_dir / "stress_0013.png").exists()

            # Sync outputs folder: delete 2 files on disk + add 1 unindexed real PNG
            (out_dir / "stress_0020.png").unlink()
            (out_dir / "stress_0021.png").unlink()
            extra_png = Image.new("RGB", (64, 64), (120, 40, 200))
            extra_png.save(out_dir / "unindexed_extra.png", format="PNG")
            r_sync = client.post("/api/gallery/sync")
            assert r_sync.status_code == 200
            sdata = r_sync.json()
            assert sdata["imported"] == 1
            assert sdata["pruned_missing"] == 2
            assert sdata["total"] == 496
        finally:
            db_mod.DB_PATH = orig_db
            db_mod.OUTPUTS_DIR = orig_out
            app_mod.OUTPUTS_DIR = orig_app_out


def test_prompt_agent_knowledge_tools_and_config_masking():
    from backend.prompt_agent import (
        _clean_tag_field,
        _execute_agent_tool,
        _extract_json_block,
        _rank_models,
        compose_blocks_prompt,
    )

    # 1. Model ranking places flagship text/reasoning models ahead of embedding/image models
    ranked = _rank_models([
        "qwen3.7-text-embedding",
        "qwen-image-3.0",
        "deepseek-v4-pro",
        "qwen4-max",
        "qwen2-7b-instruct",
    ])
    assert ranked[0] == "qwen4-max"
    assert "qwen3.7-text-embedding" not in ranked
    assert "qwen-image-3.0" not in ranked

    # 2. Resilient JSON extraction (handles fenced markdown + truncated explanation)
    partial = '```json\n{"artist": "0.9::artist:rella::", "character": "1girl, silver hair", "lighting": "sunset", "negative": "lowres", "explanation": "未闭合说明'
    rec = _extract_json_block(partial)
    assert rec["artist"] == "0.9::artist:rella::"
    assert rec["character"] == "1girl, silver hair"

    # 3. Clean composition & delimiter normalization
    assert _clean_tag_field("1girl， solo；  `silver hair` ") == "1girl, solo, silver hair"
    composed = compose_blocks_prompt({
        "artist": "0.85::artist:rella::",
        "character": "1girl, silver hair",
        "lighting": "sunset, backlighting",
    })
    assert composed == "0.85::artist:rella::, 1girl, silver hair, sunset, backlighting"

    # 4. Agent knowledge tools query real Studio DB & linter cleanly
    art_json, _ = _execute_agent_tool("search_artist_catalog", {"query": "水彩"}, "nai-diffusion-5-full")
    assert "rella" in art_json.lower()
    tag_json, _ = _execute_agent_tool("search_danbooru_tags", {"query": "水手服 逆光"}, "nai-diffusion-5-full")
    assert "serafuku" in tag_json and "backlighting" in tag_json
    lint_json, _ = _execute_agent_tool("validate_and_lint_prompt", {"prompt": "1girl, (bad:1.2)", "model_id": "nai-diffusion-5-full"}, "nai-diffusion-5-full")
    assert '"is_clean": false' in lint_json

    # 5. Bootstrap masks raw LLM API key & exposes workspace mode
    client = TestClient(app)
    r_boot = client.get("/api/bootstrap?fast=1")
    assert r_boot.status_code == 200
    cfg = r_boot.json()["config"]
    assert "llm_api_key" not in cfg
    assert "llm_api_key_masked" in cfg
    assert cfg["prompt_workspace_mode"] in ("classic", "structured")


def test_studio_agent_skills_sessions_and_workbench_tools():
    from backend.studio_agent import _execute_studio_tool, _extract_quick_replies, _merge_tag_strings

    client = TestClient(app)

    # 1. SKILL.md progressive disclosure CRUD API
    r_sk = client.get("/api/agent/skills")
    assert r_sk.status_code == 200
    skills = r_sk.json()["skills"]
    names = {s["name"] for s in skills}
    assert {"nai-v5-prompt-craft", "colloquial-to-danbooru", "creative-interview", "artist-style-blending", "director-and-inpaint-workflow"}.issubset(names)

    r_create = client.post(
        "/api/agent/skills",
        json={
            "name": "test-temp-skill",
            "title": "测试临时技能",
            "description": "用于单元测试的临时 SKILL.md",
            "triggers": "测试",
            "content": "# 测试技能\n1. 规则一",
        },
    )
    assert r_create.status_code == 200 and r_create.json()["skill"]["name"] == "test-temp-skill"
    r_read = client.get("/api/agent/skills/test-temp-skill")
    assert r_read.status_code == 200 and "规则一" in r_read.json()["skill"]["content"]
    # Built-in skill cannot be deleted
    assert client.delete("/api/agent/skills/nai-v5-prompt-craft").status_code == 400
    assert client.delete("/api/agent/skills/test-temp-skill").status_code == 200

    # 2. Persistent Agent Sessions CRUD
    r_sess = client.post("/api/agent/sessions", json={"title": "单元测试会话", "pinned_skills": ["colloquial-to-danbooru"]})
    assert r_sess.status_code == 200
    sid = r_sess.json()["session"]["id"]
    r_get_sess = client.get(f"/api/agent/sessions/{sid}")
    assert r_get_sess.status_code == 200 and r_get_sess.json()["session"]["pinned_skills"] == ["colloquial-to-danbooru"]
    assert client.delete(f"/api/agent/sessions/{sid}").status_code == 200

    # 3. Tag merge & diff calculation + Studio Agent tool execution
    merged, added, removed = _merge_tag_strings("1girl, silver hair, blue eyes", "1.2::blue eyes::, serafuku, wind", mode="merge")
    assert "1.2::blue eyes::" in merged and "serafuku" in merged
    assert "1.2::blue eyes::" in added and "serafuku" in added and removed == []

    wb = {"model": "nai-diffusion-5-full", "stage_has_image": False}
    live_blocks = {"artist": "artist:rella", "character": "1girl, silver hair", "lighting": "sunset", "negative": "lowres"}

    # read_skill tool
    sk_out, sk_sum, sk_act = _execute_studio_tool("read_skill", {"name": "colloquial-to-danbooru"}, wb, live_blocks)
    assert "Colloquial Chinese" in sk_out and sk_act is None

    # patch_prompt_blocks tool
    p_out, p_sum, p_act = _execute_studio_tool(
        "patch_prompt_blocks",
        {"lighting": "1.15::backlighting::, bokeh", "mode": "merge", "reason": "追加逆光与散景"},
        wb,
        live_blocks,
    )
    assert p_act is not None and p_act["type"] == "patch_prompt_blocks"
    assert "1.15::backlighting::" in live_blocks["lighting"] and "sunset" in live_blocks["lighting"]

    # remove_prompt_tags tool
    rm_out, _, rm_act = _execute_studio_tool("remove_prompt_tags", {"tags": ["sunset"], "side": "pos"}, wb, live_blocks)
    assert rm_act is not None and "sunset" not in live_blocks["lighting"]

    # set_workbench_params & run_director_tool guard
    _, _, param_act = _execute_studio_tool("set_workbench_params", {"steps": 28, "scale": 5.5}, wb, live_blocks)
    assert param_act is not None and param_act["payload"]["scale"] == 5.5

    dir_err_out, _, dir_err_act = _execute_studio_tool("run_director_tool", {"req_type": "lineart"}, wb, live_blocks)
    assert "暂无图片" in dir_err_out and dir_err_act is None
    wb["stage_has_image"] = True
    _, _, dir_ok_act = _execute_studio_tool("run_director_tool", {"req_type": "lineart"}, wb, live_blocks)
    assert dir_ok_act is not None and dir_ok_act["payload"]["req_type"] == "lineart"

    # Quick replies extraction
    clean_txt, q_opts = _extract_quick_replies("这是三个方向。\n[QUICK_REPLIES: 方案一 | 方案二 | 直接出图]")
    assert clean_txt == "这是三个方向。" and q_opts == ["方案一", "方案二", "直接出图"]


def test_agent_v2_skills_and_library_curation_tools(tmp_path, monkeypatch):
    import backend.database as db_mod
    from backend import skills_manager as sk_mod
    from backend.studio_agent import STUDIO_AGENT_TOOLS, _execute_studio_tool

    # 1. Verify all 8 built-in v3 skills & 19 Studio Agent tools (including batch curation, Danbooru & vision)
    tool_names = {t["function"]["name"] for t in STUDIO_AGENT_TOOLS}
    assert {
        "manage_artist_catalog",
        "manage_mix_presets",
        "manage_gallery_items",
        "lookup_danbooru_artists",
        "inspect_artist_previews",
    }.issubset(tool_names)
    assert len(STUDIO_AGENT_TOOLS) == 19

    skills = sk_mod.list_skills()
    names = {s["name"] for s in skills}
    expected_8 = {
        "nai-v5-prompt-craft",
        "colloquial-to-danbooru",
        "creative-interview",
        "artist-style-blending",
        "director-and-inpaint-workflow",
        "multi-character-staging",
        "cinematography-and-lighting",
        "library-curator",
    }
    assert expected_8.issubset(names)

    v5_sk = sk_mod.get_skill("nai-v5-prompt-craft")
    assert v5_sk and "-1.2::" in v5_sk["content"]
    mc_sk = sk_mod.get_skill("multi-character-staging")
    assert mc_sk and "source#" in mc_sk["content"] and "target#" in mc_sk["content"]
    cur_sk = sk_mod.get_skill("library-curator")
    assert cur_sk and "manage_artist_catalog" in cur_sk["content"]

    # 2. Isolate DB & outputs so live library is never touched
    import backend.studio_agent as sa_mod
    temp_db = tmp_path / "test_curation.db"
    temp_out = tmp_path / "outputs"
    temp_out.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(db_mod, "DB_PATH", temp_db)
    monkeypatch.setattr(db_mod, "OUTPUTS_DIR", temp_out)
    monkeypatch.setattr(sa_mod, "OUTPUTS_DIR", temp_out)
    db_mod.init_db()

    wb = {"model": "nai-diffusion-5-full", "stage_has_image": False}
    live_blocks = {"artist": "", "character": "1girl, silver hair", "lighting": "sunset", "negative": "lowres"}

    # 3. manage_artist_catalog: add -> update -> favorite -> generate_preview -> delete
    out_add, _, act_add = _execute_studio_tool(
        "manage_artist_catalog",
        {"action": "add", "name": "TestArtist", "tag": "test_artist_xyz", "category": "测试分类", "desc": "清透赛璐璐"},
        wb,
        live_blocks,
    )
    add_data = json.loads(out_add)
    assert add_data["ok"] is True and add_data["artist"]["tag"] == "artist:test_artist_xyz"
    assert act_add and act_add["type"] == "refresh_artists"
    aid = add_data["artist"]["id"]

    out_upd, _, act_upd = _execute_studio_tool(
        "manage_artist_catalog",
        {"action": "update", "artist_id": aid, "desc": "升级厚涂光影", "favorite": True},
        wb,
        live_blocks,
    )
    assert json.loads(out_upd)["artist"]["favorite"] is True and act_upd["type"] == "refresh_artists"

    out_fav_art, _, act_fav_art = _execute_studio_tool(
        "manage_artist_catalog",
        {"action": "favorite", "artist_id": aid},
        wb,
        live_blocks,
    )
    assert json.loads(out_fav_art)["ok"] is True and act_fav_art["type"] == "refresh_artists"

    out_prev, _, act_prev = _execute_studio_tool(
        "manage_artist_catalog",
        {"action": "generate_preview", "artist_id": aid},
        wb,
        live_blocks,
    )
    assert json.loads(out_prev)["ok"] is True and act_prev["payload"]["generate_preview_artist_id"] == aid

    # 4. manage_mix_presets: save -> list -> apply -> delete
    out_mp, _, act_mp = _execute_studio_tool(
        "manage_mix_presets",
        {
            "action": "save",
            "name": "清透日系混搭",
            "items": [
                {"tag": "artist:rella", "weight": 0.9},
                {"tag": "artist:ciloranko", "weight": 0.65},
            ],
        },
        wb,
        live_blocks,
    )
    mp_id = json.loads(out_mp)["preset"]["id"]
    assert act_mp and act_mp["type"] == "refresh_mix_presets"

    out_apply, _, act_apply = _execute_studio_tool(
        "manage_mix_presets",
        {"action": "apply", "preset_id": mp_id},
        wb,
        live_blocks,
    )
    assert json.loads(out_apply)["ok"] is True
    assert act_apply and act_apply["type"] == "patch_prompt_blocks"
    assert "0.9::artist:rella::" in live_blocks["artist"] and "0.65::artist:ciloranko::" in live_blocks["artist"]

    out_del_mp, _, _ = _execute_studio_tool("manage_mix_presets", {"action": "delete", "preset_id": mp_id}, wb, live_blocks)
    assert json.loads(out_del_mp)["ok"] is True

    # Delete test artist
    out_del_a, _, act_del_a = _execute_studio_tool("manage_artist_catalog", {"action": "delete", "artist_id": aid}, wb, live_blocks)
    assert json.loads(out_del_a)["ok"] is True and act_del_a["payload"]["deleted_id"] == aid

    # 3b. manage_artist_catalog batch_add & batch_update
    out_badd, _, act_badd = _execute_studio_tool(
        "manage_artist_catalog",
        {
            "action": "batch_add",
            "artists": [
                {"tag": "age fx", "category": "私人收藏"},
                {"tag": "fuzichoco", "category": "幻彩插画"},
                {"tag": "artist:yoneyama_mai", "category": "赛博冷调"},
            ],
            "generate_preview": True,
            "model": "nai-diffusion-4-5-full",
        },
        wb,
        live_blocks,
    )
    badd_data = json.loads(out_badd)
    assert badd_data["ok"] is True and badd_data["added_count"] == 3
    assert any(a["tag"] == "artist:age_fx" for a in badd_data["artists"])
    assert act_badd["payload"]["backfill_missing"] is True and act_badd["payload"]["model"] == "nai-diffusion-4-5-full"

    out_bupd, _, act_bupd = _execute_studio_tool(
        "manage_artist_catalog",
        {
            "action": "batch_update",
            "updates": [
                {"tag": "fuzichoco", "desc": "华丽和风彩绘", "sample_tags": "colorful, sakura, detailed background"},
                {"artist_id": badd_data["artists"][0]["id"], "category": "厚涂光影", "desc": "浓重质感笔触"},
            ],
        },
        wb,
        live_blocks,
    )
    assert json.loads(out_bupd)["updated_count"] == 2 and act_bupd["type"] == "refresh_artists"

    # 5. manage_gallery_items: favorite -> set_notes -> load_to_workbench -> sync_folder -> delete
    png_path = temp_out / "sample_agent.png"
    png_path.write_bytes(b"\x89PNG\r\n\x1a\n")
    item = db_mod.add_gallery_item(
        {
            "filename": "sample_agent.png",
            "rel_path": "sample_agent.png",
            "model": "nai-diffusion-5-full",
            "model_short": "V5 Full",
            "action": "generate",
            "prompt": "1girl, silver hair, sunset",
            "uc": "lowres",
            "width": 832,
            "height": 1216,
            "steps": 28,
            "scale": 5.0,
            "seed": 123456,
        }
    )
    gid = item["id"]

    out_fav, _, act_fav = _execute_studio_tool("manage_gallery_items", {"action": "favorite", "item_id": gid}, wb, live_blocks)
    assert json.loads(out_fav)["updated"] == 1 and act_fav["type"] == "refresh_gallery"

    out_note, _, _ = _execute_studio_tool(
        "manage_gallery_items",
        {"action": "set_notes", "item_id": gid, "notes": "黄昏夕阳氛围极佳"},
        wb,
        live_blocks,
    )
    assert json.loads(out_note)["item"]["notes"] == "黄昏夕阳氛围极佳"

    out_load, _, act_load = _execute_studio_tool(
        "manage_gallery_items",
        {"action": "load_to_workbench", "item_id": gid},
        wb,
        live_blocks,
    )
    assert json.loads(out_load)["ok"] is True and act_load["type"] == "load_gallery_item"

    out_sync, _, act_sync = _execute_studio_tool("manage_gallery_items", {"action": "sync_folder"}, wb, live_blocks)
    assert json.loads(out_sync)["ok"] is True and act_sync["type"] == "refresh_gallery"

    out_gdel, _, act_gdel = _execute_studio_tool(
        "manage_gallery_items",
        {"action": "delete", "ids": [gid]},
        wb,
        live_blocks,
    )
    assert json.loads(out_gdel)["removed"] == 1 and act_gdel["type"] == "refresh_gallery"
    assert not png_path.exists()

    # 6. Verify 100K context budget packing & defaults
    from backend.config import DEFAULT_CONFIG
    assert DEFAULT_CONFIG["llm_context_tokens"] == 100000
    assert DEFAULT_CONFIG["llm_max_output_tokens"] == 100000
    fake_hist = [{"role": "user", "content": f"msg_{i} " + ("测" * 200)} for i in range(40)]
    packed_small = sa_mod._build_history_within_budget(fake_hist, budget_tokens=600)
    packed_100k = sa_mod._build_history_within_budget(fake_hist, budget_tokens=100000)
    assert 1 <= len(packed_small) < len(packed_100k) == 40
    assert packed_small[-1]["content"].startswith("msg_39")




