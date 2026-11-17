import asyncio
import base64
import datetime
import io
import json
import random
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from .config import ARTISTS_DIR, OUTPUTS_DIR, load_config
from .database import add_gallery_item, list_artists, update_artist_preview
from .models_spec import DIRECTOR_EMOTIONS, estimate_generation_cost, get_model_spec
from .prompt_engine import expand_dynamic_prompt, search_builtin_tags

TIER_NAMES = {0: "Free (免费层)", 1: "Tablet", 2: "Scroll", 3: "Opus (最高订阅)"}

_HTTP_CLIENT: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _HTTP_CLIENT
    if _HTTP_CLIENT is None or _HTTP_CLIENT.is_closed:
        _HTTP_CLIENT = httpx.AsyncClient(timeout=90.0)
    return _HTTP_CLIENT


class NaiApiError(ValueError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def _extract_nai_error_detail(r: httpx.Response) -> str:
    try:
        j = r.json()
        msg = j.get("message") or j.get("detail") or j.get("error")
        if msg:
            return str(msg)[:260]
    except Exception:
        pass
    return (r.text or "")[:260]


async def _post_nai_with_retry(
    client: httpx.AsyncClient,
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    op_label: str = "图像生成",
) -> httpx.Response:
    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            r = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            last_exc = exc
            if attempt == 0:
                await asyncio.sleep(1.5)
                continue
            raise NaiApiError(504, f"{op_label}连接 NovelAI 超时 (90s)，请检查网络后重试。")
        except httpx.TransportError as exc:
            last_exc = exc
            if attempt == 0:
                await asyncio.sleep(1.5)
                continue
            raise NaiApiError(502, f"{op_label}网络传输异常: {exc}")

        if r.status_code == 200:
            return r

        detail = _extract_nai_error_detail(r)
        if r.status_code in (429, 502, 503, 504) and attempt == 0:
            await asyncio.sleep(2.0 if r.status_code == 429 else 1.5)
            continue

        if r.status_code in (401, 403):
            raise NaiApiError(r.status_code, f"NovelAI Token 无效或已过期 ({r.status_code})：{detail}")
        if r.status_code == 402:
            raise NaiApiError(402, f"Anlas 点数不足 (402)：{detail}")
        if r.status_code == 429:
            raise NaiApiError(429, f"NovelAI 上游并发/频率受限 (429)：请等待上一任务完全结束 2 秒后再重试（{detail}）")
        if r.status_code >= 500:
            raise NaiApiError(502, f"NovelAI 服务器暂时异常 ({r.status_code})：{detail}")
        raise NaiApiError(400, f"{op_label}被 NovelAI 拒绝 ({r.status_code})：{detail}")

    raise NaiApiError(502, f"{op_label}请求失败: {last_exc}")


def _num(val: Any, default: float, cast=float) -> Any:
    if val is None or val == "":
        return cast(default)
    return cast(val)


def _merge_tags_dedup(prefix_str: str, main_str: str, append_str: str = "") -> str:
    seen = set()
    ordered: List[str] = []
    for chunk in (prefix_str, main_str, append_str):
        for raw_tok in (chunk or "").split(","):
            tok = raw_tok.strip()
            if not tok:
                continue
            norm = tok.lower()
            if norm not in seen:
                seen.add(norm)
                ordered.append(tok)
    return ", ".join(ordered)


def _strip_data_url(b64_str: str) -> str:
    if not b64_str:
        return ""
    if "," in b64_str and b64_str.startswith("data:"):
        return b64_str.split(",", 1)[1].strip()
    return b64_str.strip()


def _prepare_outpaint_canvas(
    image_b64: str,
    direction: str = "right",
    expand_px: int = 256,
) -> Tuple[str, str, int, int]:
    """
    Expands an input image onto a standard Opus-free NovelAI canvas (832x1216, 1216x832, or 1024x1024)
    WITHOUT cropping original pixels (uses ImageOps.contain + seamless placement),
    and generates the white=inpaint / black=keep mask for 'infill'.
    """
    raw = base64.b64decode(_strip_data_url(image_b64))
    im = Image.open(io.BytesIO(raw)).convert("RGB")

    if direction in ("left", "right"):
        target_w, target_h = 1216, 832
    elif direction in ("top", "bottom"):
        target_w, target_h = 832, 1216
    else:
        target_w, target_h = 1024, 1024

    canvas = Image.new("RGB", (target_w, target_h), (128, 128, 128))
    mask = Image.new("RGB", (target_w, target_h), (255, 255, 255))
    draw = ImageDraw.Draw(mask)

    margin = min(max(128, int(expand_px)), 320)
    if direction == "right":
        max_w, max_h = target_w - margin, target_h
        resized = ImageOps.contain(im, (max_w, max_h), Image.Resampling.LANCZOS)
        rw, rh = resized.size
        ox, oy = 0, (target_h - rh) // 2
    elif direction == "left":
        max_w, max_h = target_w - margin, target_h
        resized = ImageOps.contain(im, (max_w, max_h), Image.Resampling.LANCZOS)
        rw, rh = resized.size
        ox, oy = target_w - rw, (target_h - rh) // 2
    elif direction == "bottom":
        max_w, max_h = target_w, target_h - margin
        resized = ImageOps.contain(im, (max_w, max_h), Image.Resampling.LANCZOS)
        rw, rh = resized.size
        ox, oy = (target_w - rw) // 2, 0
    elif direction == "top":
        max_w, max_h = target_w, target_h - margin
        resized = ImageOps.contain(im, (max_w, max_h), Image.Resampling.LANCZOS)
        rw, rh = resized.size
        ox, oy = (target_w - rw) // 2, target_h - rh
    else:
        max_w, max_h = target_w - margin, target_h - margin
        resized = ImageOps.contain(im, (max_w, max_h), Image.Resampling.LANCZOS)
        rw, rh = resized.size
        ox, oy = (target_w - rw) // 2, (target_h - rh) // 2

    canvas.paste(resized, (ox, oy))
    # Feather border 8px inside pasted region so infill blends smoothly without visible seam
    x0 = ox + (8 if ox > 0 else 0)
    y0 = oy + (8 if oy > 0 else 0)
    x1 = ox + rw - (8 if (ox + rw) < target_w else 0)
    y1 = oy + rh - (8 if (oy + rh) < target_h else 0)
    draw.rectangle([x0, y0, max(x0 + 8, x1), max(y0 + 8, y1)], fill=(0, 0, 0))

    cbuf = io.BytesIO()
    canvas.save(cbuf, format="PNG")
    mbuf = io.BytesIO()
    mask.save(mbuf, format="PNG")
    return (
        base64.b64encode(cbuf.getvalue()).decode(),
        base64.b64encode(mbuf.getvalue()).decode(),
        target_w,
        target_h,
    )


def _prepare_focus_inpaint(image_b64: str, mask_b64: str) -> Optional[Dict[str, Any]]:
    """
    Focus Inpaint: When the painted inpaint mask covers a localized region (<55% of canvas),
    crops tightly around the mask with contextual padding, upscales into an Opus-free
    high-detail canvas (832x1216 / 1024x1024 / 1216x832), runs infill at full detail,
    and blends back smoothly onto the original full-res image.
    Returns None if mask spans almost the whole image or is empty.
    """
    orig_im = Image.open(io.BytesIO(base64.b64decode(_strip_data_url(image_b64)))).convert("RGBA")
    orig_mask = Image.open(io.BytesIO(base64.b64decode(_strip_data_url(mask_b64)))).convert("L")
    if orig_mask.size != orig_im.size:
        orig_mask = orig_mask.resize(orig_im.size, Image.Resampling.NEAREST)

    bbox = orig_mask.getbbox()
    if not bbox:
        return None
    ow, oh = orig_im.size
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if (bw * bh) >= 0.55 * (ow * oh):
        return None

    # Expand bbox cleanly with 45% context padding for natural seam transition
    pad_x = max(64, int(bw * 0.45))
    pad_y = max(64, int(bh * 0.45))
    cx = (bbox[0] + bbox[2]) / 2.0
    cy = (bbox[1] + bbox[3]) / 2.0
    crop_w = min(ow, max(256, bw + pad_x * 2))
    crop_h = min(oh, max(256, bh + pad_y * 2))

    # Pick matching Opus-free high-res aspect canvas
    ratio = crop_w / max(1.0, float(crop_h))
    if ratio > 1.18:
        tw, th = 1216, 832
    elif ratio < 0.85:
        tw, th = 832, 1216
    else:
        tw, th = 1024, 1024

    target_ratio = tw / float(th)
    if crop_w / max(1.0, float(crop_h)) > target_ratio:
        crop_h = min(oh, int(round(crop_w / target_ratio)))
    else:
        crop_w = min(ow, int(round(crop_h * target_ratio)))

    x0 = int(max(0, min(ow - crop_w, round(cx - crop_w / 2.0))))
    y0 = int(max(0, min(oh - crop_h, round(cy - crop_h / 2.0))))
    x1 = int(min(ow, x0 + crop_w))
    y1 = int(min(oh, y0 + crop_h))

    crop_im = orig_im.crop((x0, y0, x1, y1)).convert("RGB").resize((tw, th), Image.Resampling.LANCZOS)
    crop_mask = orig_mask.crop((x0, y0, x1, y1)).resize((tw, th), Image.Resampling.NEAREST)
    # Force pure binary white/black mask for clean NAI infill
    crop_mask_bin = crop_mask.point(lambda p: 255 if p > 20 else 0).convert("RGB")

    ibuf = io.BytesIO()
    crop_im.save(ibuf, format="PNG")
    mbuf = io.BytesIO()
    crop_mask_bin.save(mbuf, format="PNG")
    return {
        "crop_image_b64": base64.b64encode(ibuf.getvalue()).decode(),
        "crop_mask_b64": base64.b64encode(mbuf.getvalue()).decode(),
        "target_w": tw,
        "target_h": th,
        "crop_box": (x0, y0, x1, y1),
        "orig_im": orig_im,
        "orig_mask": orig_mask,
    }


def _composite_focus_inpaint(crop_png_bytes: bytes, focus_ctx: Dict[str, Any]) -> bytes:
    x0, y0, x1, y1 = focus_ctx["crop_box"]
    cw, ch = x1 - x0, y1 - y0
    patch = Image.open(io.BytesIO(crop_png_bytes)).convert("RGBA").resize((cw, ch), Image.Resampling.LANCZOS)

    orig_im: Image.Image = focus_ctx["orig_im"].copy()
    orig_mask: Image.Image = focus_ctx["orig_mask"]
    crop_alpha = orig_mask.crop((x0, y0, x1, y1)).point(lambda p: 255 if p > 20 else 0)
    # Soft 6px feather only inside mask border for seamless blend
    crop_alpha = crop_alpha.filter(ImageFilter.GaussianBlur(radius=4))

    orig_im.paste(patch, (x0, y0), crop_alpha)
    out_buf = io.BytesIO()
    orig_im.save(out_buf, format="PNG")
    return out_buf.getvalue()


async def fetch_account_status(cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = cfg or load_config()
    token = (cfg.get("api_token") or "").strip()
    base_url = (cfg.get("base_url") or "https://image.novelai.net").rstrip("/")
    if not token:
        return {"connected": False, "error": "未配置 API Token"}

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{base_url}/user/subscription", headers=headers)
            if r.status_code != 200:
                return {"connected": False, "status_code": r.status_code, "error": r.text[:200]}
            data = r.json()
            tier = int(data.get("tier") or 0)
            active = bool(data.get("active"))
            steps_left = data.get("trainingStepsLeft") or {}
            fixed_anlas = int(steps_left.get("fixedTrainingStepsLeft") or 0)
            purchased_anlas = int(steps_left.get("purchasedTrainingSteps") or 0)
            total_anlas = fixed_anlas + purchased_anlas
            usage = data.get("usage") or {}
            v5_used_pct = int(usage.get("percent") or 0)
            v5_refill_sec = int(usage.get("timeUntilNextPercent") or 0)
            return {
                "connected": True,
                "tier": tier,
                "tier_name": TIER_NAMES.get(tier, f"Tier {tier}"),
                "is_opus": tier == 3 and active,
                "active": active,
                "expires_at": data.get("expiresAt"),
                "anlas": total_anlas,
                "fixed_anlas": fixed_anlas,
                "purchased_anlas": purchased_anlas,
                "v5_usage_percent": v5_used_pct,
                "v5_remaining_percent": max(0, 100 - v5_used_pct),
                "v5_next_percent_seconds": v5_refill_sec,
            }
    except Exception as exc:
        return {"connected": False, "error": str(exc)}


async def suggest_tags_hybrid(query: str, model_id: str = "nai-diffusion-5-full", cfg: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    cfg = cfg or load_config()
    q = (query or "").strip()
    local_matches = search_builtin_tags(q, limit=10)
    if not q:
        return local_matches

    # Also query official NovelAI suggest-tags if query contains ASCII characters
    has_cjk = any("\u4e00" <= ch <= "\u9fff" for ch in q)
    english_query = q
    if has_cjk and local_matches:
        # Use top local match's English word to fetch companion official suggestions
        english_query = local_matches[0]["tag"].split(" ")[0]

    remote_matches: List[Dict[str, Any]] = []
    token = (cfg.get("api_token") or "").strip()
    base_url = (cfg.get("base_url") or "https://image.novelai.net").rstrip("/")
    if token and len(english_query) >= 2 and not any("\u4e00" <= ch <= "\u9fff" for ch in english_query):
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.get(
                    f"{base_url}/ai/generate-image/suggest-tags",
                    params={"model": model_id, "prompt": english_query},
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                )
                if r.status_code == 200:
                    raw_tags = r.json().get("tags") or []
                    for rt in raw_tags[:8]:
                        t_name = str(rt.get("tag") or "").strip()
                        if t_name:
                            remote_matches.append({
                                "tag": t_name,
                                "cn": "NAI 官方词库联想",
                                "cat": "官方词库",
                                "count": int(rt.get("count") or 0),
                                "confidence": float(rt.get("confidence") or 0.0),
                            })
        except Exception:
            pass

    seen = set()
    merged: List[Dict[str, Any]] = []
    for item in local_matches + remote_matches:
        t = item["tag"].lower()
        if t not in seen:
            seen.add(t)
            merged.append(item)
    return merged[:12]


def parse_vibe_bundle(raw_bytes: bytes, model_id: str = "nai-diffusion-4-5-full") -> Dict[str, Any]:
    """
    Parses a .naiv4vibe or .naiv4vibebundle JSON file to extract pre-encoded vibe vectors (0 Anlas cost),
    prioritizing the encoding matching the requested NovelAI model family.
    """
    data = json.loads(raw_bytes.decode("utf-8", errors="replace"))
    vibes = data.get("vibes") if isinstance(data, dict) and "vibes" in data else [data]

    # Map NAI model_id -> known key aliases inside .naiv4vibe encodings
    key_priority = [model_id]
    if "4-5" in model_id:
        key_priority.extend(["v4-5full", "v4-5curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"])
    elif "4" in model_id:
        key_priority.extend(["v4full", "v4curated", "nai-diffusion-4-full", "nai-diffusion-4-curated"])

    extracted: List[Dict[str, Any]] = []
    for v in vibes:
        if not isinstance(v, dict):
            continue
        encodings = v.get("encodings") or {}
        chosen_b64 = ""
        matched_model = ""
        ordered_keys = [k for k in key_priority if k in encodings] + [
            k for k in encodings.keys() if k not in key_priority
        ]
        for mkey in ordered_keys:
            enc_map = encodings.get(mkey)
            if isinstance(enc_map, dict):
                for _ie_key, enc_obj in enc_map.items():
                    if isinstance(enc_obj, dict) and enc_obj.get("encoding"):
                        chosen_b64 = enc_obj["encoding"]
                        matched_model = str(mkey)
                        break
                    elif isinstance(enc_obj, str) and enc_obj:
                        chosen_b64 = enc_obj
                        matched_model = str(mkey)
                        break
            if chosen_b64:
                break
        if chosen_b64:
            imp = v.get("importInfo") or {}
            extracted.append({
                "encoding": chosen_b64,
                "strength": float(_num(imp.get("strength"), 0.6)),
                "ie": float(_num(imp.get("information_extracted"), 1.0)),
                "matched_model": matched_model,
            })
    return {"count": len(extracted), "vibes": extracted}


async def generate_image(req: Dict[str, Any], cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = cfg or load_config()
    token = (cfg.get("api_token") or "").strip()
    base_url = (cfg.get("base_url") or "https://image.novelai.net").rstrip("/")
    if not token:
        raise ValueError("尚未配置 NovelAI Persistent API Token，请在「设置 & Agent」中填入 pst-... Token。")

    model_id = str(req.get("model") or cfg.get("default_model") or "nai-diffusion-5-full")
    spec = get_model_spec(model_id)

    action = str(req.get("action") or "generate")
    width = _num(req.get("width"), 832, int)
    height = _num(req.get("height"), 1216, int)
    steps = _num(req.get("steps"), spec["default_steps"], int)
    scale = _num(req.get("scale"), spec["default_scale"], float)
    cfg_rescale = _num(req.get("cfg_rescale"), 0.0, float)
    sampler = str(req.get("sampler") or spec["default_sampler"])
    scheduler = str(req.get("scheduler") or spec["default_scheduler"])
    n_samples = max(1, _num(req.get("n_samples"), 1, int))

    valid_sampler_ids = {s["id"] for s in spec["samplers"]}
    if sampler not in valid_sampler_ids:
        sampler = spec["default_sampler"]

    seed_in = req.get("seed")
    if seed_in is None or seed_in == "" or int(seed_in) <= 0:
        seed = random.randint(100000000, 2147483647)
    else:
        seed = int(seed_in)

    raw_base_prompt = str(req.get("prompt") or "").strip()
    dyn_main = expand_dynamic_prompt(raw_base_prompt, seed=seed)
    base_prompt = dyn_main["expanded"]

    artist_mix = req.get("artist_mix") or []
    # Format artist mix prefix/suffix according to model capability
    mix_tokens: List[str] = []
    for am in artist_mix:
        atag = str(am.get("tag") or "").strip()
        w = _num(am.get("weight"), 1.0, float)
        if not atag:
            continue
        if spec["supports_numeric_weight"]:
            mix_tokens.append(f"{w:g}::{atag}::" if abs(w - 1.0) >= 0.02 else atag)
        else:
            from .prompt_engine import _weight_to_brackets
            mix_tokens.append(_weight_to_brackets(w, atag))

    full_prompt = base_prompt
    if mix_tokens:
        mix_str = ", ".join(mix_tokens)
        full_prompt = f"{full_prompt}, {mix_str}" if full_prompt else mix_str

    if spec["supports_alpha_transparency"] and req.get("alpha_transparency"):
        if "transparent background" not in full_prompt.lower():
            full_prompt = f"{full_prompt}, transparent background" if full_prompt else "transparent background"

    if req.get("auto_quality_tags", cfg.get("auto_quality_tags", True)):
        qtags = spec["quality_tags"]
        if qtags:
            full_prompt = _merge_tags_dedup(full_prompt, qtags)

    uc_preset_key = str(req.get("uc_preset") or "heavy")
    uc_preset_obj = spec["uc_presets"].get(uc_preset_key) or spec["uc_presets"]["heavy"]
    user_uc = str(req.get("uc") or "").strip()
    preset_uc = uc_preset_obj["tags"]
    full_uc = _merge_tags_dedup(preset_uc, user_uc)

    # Check model feature constraints (strict Frontend-Backend sync)
    vibes = req.get("vibes") or []
    precise_refs = req.get("precise_refs") or []
    if vibes and not spec["supports_vibe"]:
        raise ValueError(spec["unsupported_reasons"].get("vibe", f"当前模型 {spec['short_name']} 不支持 Vibe 参考图"))
    if precise_refs and not spec["supports_precise_ref"]:
        raise ValueError(spec["unsupported_reasons"].get("precise_ref", f"当前模型 {spec['short_name']} 不支持 Precise 精准参考"))

    # Outpaint preparation converts action='outpaint' into action='infill'
    image_b64 = _strip_data_url(str(req.get("image") or ""))
    mask_b64 = _strip_data_url(str(req.get("mask") or ""))
    if action == "outpaint":
        if not image_b64:
            raise ValueError("扩图 (Outpaint) 需要先上传或从画布选择一张基础图像。")
        direction = str(req.get("outpaint_direction") or "right")
        expand_px = int(req.get("outpaint_px") or 256)
        image_b64, mask_b64, width, height = _prepare_outpaint_canvas(image_b64, direction, expand_px)
        req["_is_outpaint_infill"] = True
        action = "infill"

    # Check Opus 0-Anlas Free Guard
    has_raw_vibe_encode = any(bool(v.get("raw_image")) and not v.get("encoding") for v in vibes)
    cost_est = estimate_generation_cost(
        model_id=model_id,
        width=width,
        height=height,
        steps=steps,
        n_samples=n_samples,
        has_vibe_raw_encode=has_raw_vibe_encode,
        vibe_count=len(vibes),
        has_precise_ref=bool(precise_refs),
        is_opus=True,
    )
    if cfg.get("opus_free_guard", True) and not cost_est["is_opus_free"]:
        reason_str = "；".join(cost_est["reasons"])
        raise ValueError(f"【Opus 0点数免费保护已拦截】当前参数预计消耗 {cost_est['anlas_cost']} Anlas（原因：{reason_str}）。请保持步数≤28、尺寸≤1024²、单次1张，或在右上角关闭免费保护锁。")

    target_model = spec["inpaint_model"] if action == "infill" else model_id

    params: Dict[str, Any] = {
        "params_version": spec["params_version"],
        "width": width,
        "height": height,
        "scale": scale,
        "sampler": sampler,
        "steps": steps,
        "n_samples": n_samples,
        "ucPreset": uc_preset_obj["id"],
        "qualityToggle": bool(req.get("auto_quality_tags", True)),
        "autoSmea": False,
        "dynamic_thresholding": bool(req.get("decrisper", False)) if spec["supports_decrisper"] else False,
        "controlnet_strength": 1.0,
        "legacy": False,
        "add_original_image": bool(req.get("add_original_image", True)),
        "cfg_rescale": cfg_rescale,
        "noise_schedule": scheduler,
        "legacy_v3_extend": False,
        "seed": seed,
        "negative_prompt": full_uc,
    }

    if spec["supports_smea"]:
        sm = bool(req.get("sm", False))
        sm_dyn = bool(req.get("sm_dyn", False)) and sm
        params["sm"] = sm
        params["sm_dyn"] = sm_dyn

    if spec["supports_variety_plus"] and req.get("variety_plus"):
        params["skip_cfg_above_sigma"] = spec["skip_cfg_above_sigma"]
    else:
        params["skip_cfg_above_sigma"] = None

    # Multi-character & V4/V4.5/V5 prompt structure
    characters_in = req.get("characters") or []
    char_captions_pos: List[Dict[str, Any]] = []
    char_captions_neg: List[Dict[str, Any]] = []
    use_coords = bool(req.get("use_coords", False))

    if spec["supports_multi_char"]:
        for idx, ch in enumerate(characters_in[: spec["max_characters"]]):
            raw_cp = str(ch.get("prompt") or "").strip()
            if not raw_cp:
                continue
            cp = expand_dynamic_prompt(raw_cp, seed=seed + idx + 1)["expanded"]
            cn = str(ch.get("uc") or "").strip()
            cx = _num(ch.get("x"), 0.5, float)
            cy = _num(ch.get("y"), 0.5, float)
            char_captions_pos.append({
                "char_caption": cp,
                "centers": [{"x": round(cx, 2), "y": round(cy, 2)}],
            })
            char_captions_neg.append({
                "char_caption": cn,
                "centers": [{"x": round(cx, 2), "y": round(cy, 2)}],
            })

        params["v4_prompt"] = {
            "caption": {
                "base_caption": full_prompt,
                "char_captions": char_captions_pos,
            },
            "use_coords": use_coords if char_captions_pos else False,
            "use_order": True,
        }
        params["v4_negative_prompt"] = {
            "caption": {
                "base_caption": full_uc,
                "char_captions": char_captions_neg,
            },
            "legacy_uc": False,
        }

    # Image-to-Image & Inpainting parameters
    if action == "img2img":
        if not image_b64:
            raise ValueError("图生图 (img2img) 需要提供输入图像。")
        params["image"] = image_b64
        params["strength"] = _num(req.get("strength"), 0.65, float)
        params["noise"] = _num(req.get("noise"), 0.0, float)
        params["extra_noise_seed"] = seed
    elif action == "infill":
        if not image_b64 or not mask_b64:
            raise ValueError("局部涂抹重绘 (Inpaint) 需要同时提供底图与遮罩 (Mask)。")
        focus_ctx: Optional[Dict[str, Any]] = None
        if req.get("focus_inpaint", True) and not req.get("_is_outpaint_infill"):
            focus_ctx = _prepare_focus_inpaint(image_b64, mask_b64)
            if focus_ctx:
                image_b64 = focus_ctx["crop_image_b64"]
                mask_b64 = focus_ctx["crop_mask_b64"]
                width = focus_ctx["target_w"]
                height = focus_ctx["target_h"]
                params["width"] = width
                params["height"] = height
        params["image"] = image_b64
        params["mask"] = mask_b64
        params["strength"] = _num(req.get("strength"), 0.75, float)
        params["noise"] = _num(req.get("noise"), 0.0, float)
        params["inpaint_img2img_strength"] = _num(req.get("inpaint_img2img_strength"), 1.0, float)
        params["extra_noise_seed"] = seed
    else:
        focus_ctx = None

    # Vibe Transfer parameters (V3 raw image or V4/V4.5 pre-encoded vibe)
    if vibes and spec["supports_vibe"]:
        ref_imgs: List[str] = []
        ref_ies: List[float] = []
        ref_strs: List[float] = []
        for v in vibes:
            enc = _strip_data_url(str(v.get("encoding") or v.get("raw_image") or ""))
            if not enc:
                continue
            ref_imgs.append(enc)
            ref_ies.append(_num(v.get("ie"), 0.7, float))
            ref_strs.append(_num(v.get("strength"), 0.6, float))
        if ref_imgs:
            params["reference_image_multiple"] = ref_imgs
            params["reference_information_extracted_multiple"] = ref_ies
            params["reference_strength_multiple"] = ref_strs
            if len(ref_imgs) > 1:
                params["normalize_reference_strength_multiple"] = bool(req.get("normalize_vibe_strength", True))

    # Precise Reference (V4.5 only)
    if precise_refs and spec["supports_precise_ref"]:
        d_imgs: List[str] = []
        d_descs: List[Dict[str, Any]] = []
        d_ies: List[float] = []
        d_strs: List[float] = []
        d_sec: List[float] = []
        for pr in precise_refs:
            b64_pr = _strip_data_url(str(pr.get("image") or ""))
            if not b64_pr:
                continue
            mode_cap = str(pr.get("mode") or "character&style")
            d_imgs.append(b64_pr)
            d_descs.append({"caption": {"base_caption": mode_cap, "char_captions": []}, "legacy_uc": False})
            d_ies.append(1.0)
            d_strs.append(_num(pr.get("strength"), 0.8, float))
            d_sec.append(_num(pr.get("fidelity"), 0.2, float))
        if d_imgs:
            params["director_reference_images"] = d_imgs
            params["director_reference_descriptions"] = d_descs
            params["director_reference_information_extracted"] = d_ies
            params["director_reference_strength_values"] = d_strs
            params["director_reference_secondary_strength_values"] = d_sec

    payload = {
        "input": full_prompt,
        "model": target_model,
        "action": action,
        "parameters": params,
    }

    t0 = time.perf_counter()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "*/*",
    }
    client = _get_client()
    r = await _post_nai_with_retry(client, f"{base_url}/ai/generate-image", headers, payload, "图像生成")

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    png_names = [n for n in zf.namelist() if n.lower().endswith(".png")] or zf.namelist()
    if not png_names:
        raise ValueError("NovelAI 返回的数据包中未包含图像文件。")

    elapsed = round(time.perf_counter() - t0, 2)

    # Save ALL PNGs in ZIP to D:\NAI-Studio\outputs\YYYY-MM-DD\
    day_str = datetime.date.today().isoformat()
    out_root = Path(cfg.get("output_dir") or str(OUTPUTS_DIR))
    day_dir = out_root / day_str
    day_dir.mkdir(parents=True, exist_ok=True)

    saved_items: List[Dict[str, Any]] = []
    out_w, out_h = width, height
    for idx, zname in enumerate(png_names):
        png_bytes = zf.read(zname)
        if action == "infill" and "focus_ctx" in locals() and focus_ctx is not None:
            png_bytes = _composite_focus_inpaint(png_bytes, focus_ctx)
            out_w, out_h = focus_ctx["orig_im"].size
        ts = int(time.time() * 1000) + idx
        item_seed = seed + idx
        filename = f"nai_{spec['family']}_{item_seed}_{ts}.png"
        full_path = day_dir / filename
        full_path.write_bytes(png_bytes)
        rel_path = f"{day_str}/{filename}"
        saved_items.append(add_gallery_item({
            "filename": filename,
            "rel_path": rel_path,
            "model": model_id,
            "model_short": spec["short_name"],
            "action": "focus_infill" if ("focus_ctx" in locals() and focus_ctx is not None) else action,
            "prompt": full_prompt,
            "uc": full_uc,
            "width": out_w,
            "height": out_h,
            "steps": steps,
            "scale": scale,
            "cfg_rescale": cfg_rescale,
            "sampler": sampler,
            "scheduler": scheduler,
            "seed": item_seed,
            "characters": characters_in if spec["supports_multi_char"] else [],
            "artist_mix": artist_mix,
            "generation_time": elapsed,
            "notes": req.get("notes") or "",
        }))

    primary = dict(saved_items[0])
    if len(saved_items) > 1:
        primary["batch_items"] = saved_items
    return primary


async def augment_image(req: Dict[str, Any], cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    NovelAI Director Tools (/ai/augment-image):
    lineart, sketch, colorize, emotion, declutter (all 0 Anlas on Opus <=1MP), bg-removal (paid Anlas).
    """
    cfg = cfg or load_config()
    token = (cfg.get("api_token") or "").strip()
    base_url = (cfg.get("base_url") or "https://image.novelai.net").rstrip("/")
    if not token:
        raise ValueError("尚未配置 NovelAI Persistent API Token。")

    req_type = str(req.get("req_type") or "lineart")
    if req_type == "bg-removal" and cfg.get("opus_free_guard", True):
        raise ValueError("【Opus 0点数免费保护已拦截】官方 Director「去背景 (bg-removal)」固定消耗点数；若需 0 点数透明底，请使用 NAI V5 的「原生透明底」功能！其他 Director 工具（提取线稿、转草图、智能上色、表情微调、去杂物）均可 0 点数免费使用。")

    image_b64 = _strip_data_url(str(req.get("image") or ""))
    if not image_b64:
        raise ValueError("Director 工具需要先提供一张画布图像。")

    raw_bytes = base64.b64decode(image_b64)
    im = Image.open(io.BytesIO(raw_bytes))
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    w, h = im.size
    if w * h > 1048576:
        scale_factor = (1048576 / float(w * h)) ** 0.5
        w = max(64, int(w * scale_factor) // 64 * 64)
        h = max(64, int(h * scale_factor) // 64 * 64)
        im = im.resize((w, h), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        image_b64 = base64.b64encode(buf.getvalue()).decode()

    payload: Dict[str, Any] = {
        "req_type": req_type,
        "width": w,
        "height": h,
        "image": image_b64,
    }
    if req_type == "colorize":
        payload["prompt"] = str(req.get("prompt") or "vibrant anime coloring, clean lighting")
        payload["defry"] = _num(req.get("defry"), 0, int)
    elif req_type == "emotion":
        emotion = str(req.get("emotion") or "happy").strip().lower()
        valid_emotions = {e["id"] for e in DIRECTOR_EMOTIONS}
        if emotion not in valid_emotions:
            emotion = "happy"
        prompt_extra = str(req.get("prompt") or "")
        payload["prompt"] = f"{emotion};;{prompt_extra}"
        payload["defry"] = _num(req.get("defry"), 0, int)

    t0 = time.perf_counter()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "*/*",
    }
    client = _get_client()
    r = await _post_nai_with_retry(client, f"{base_url}/ai/augment-image", headers, payload, "Director 工具")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    png_bytes = zf.read(zf.namelist()[0])

    elapsed = round(time.perf_counter() - t0, 2)
    day_str = datetime.date.today().isoformat()
    out_root = Path(cfg.get("output_dir") or str(OUTPUTS_DIR))
    day_dir = out_root / day_str
    day_dir.mkdir(parents=True, exist_ok=True)

    ts = int(time.time() * 1000)
    filename = f"nai_director_{req_type}_{ts}.png"
    full_path = day_dir / filename
    full_path.write_bytes(png_bytes)
    rel_path = f"{day_str}/{filename}"

    return add_gallery_item({
        "filename": filename,
        "rel_path": rel_path,
        "model": "director-augment",
        "model_short": f"Director · {req_type}",
        "action": f"director:{req_type}",
        "prompt": str(payload.get("prompt") or f"Director Tool: {req_type}"),
        "uc": "",
        "width": w,
        "height": h,
        "steps": 28,
        "scale": 5.0,
        "sampler": "k_euler_ancestral",
        "scheduler": "karras",
        "seed": 0,
        "generation_time": elapsed,
    })


async def generate_artist_preview_card(artist_id: int, tag: str, sample_tags: str = "", model_id: str = "nai-diffusion-4-5-full") -> Dict[str, Any]:
    r"""
    Generates a standardized NAX-style real NovelAI benchmark preview card (0 Anlas on V4.5 Full)
    using a fixed benchmark seed (39481022) and saves it to D:\NAI-Studio\artists\.
    """
    cfg = load_config()
    token = (cfg.get("api_token") or "").strip()
    base_url = (cfg.get("base_url") or "https://image.novelai.net").rstrip("/")
    if not token:
        raise ValueError("尚未配置 API Token")

    clean_tag = tag.strip()
    if not clean_tag.startswith("artist:"):
        clean_tag = f"artist:{clean_tag}"

    base_sample = sample_tags.strip() or "1girl, solo, silver hair, blue eyes, serafuku, sunset, backlighting, detailed eyes, wind"
    full_prompt = f"{clean_tag}, {base_sample}, masterpiece, best quality, very aesthetic, absurdres"
    uc = "lowres, artistic error, worst quality, bad quality, jpeg artifacts, very displeasing, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, watermark, text"

    payload = {
        "input": full_prompt,
        "model": model_id,
        "action": "generate",
        "parameters": {
            "params_version": 3,
            "width": 832,
            "height": 1216,
            "scale": 5.0,
            "sampler": "k_euler_ancestral",
            "steps": 28,
            "n_samples": 1,
            "ucPreset": 0,
            "qualityToggle": True,
            "autoSmea": False,
            "dynamic_thresholding": False,
            "controlnet_strength": 1.0,
            "legacy": False,
            "add_original_image": True,
            "cfg_rescale": 0.0,
            "noise_schedule": "karras",
            "legacy_v3_extend": False,
            "seed": 39481022,
            "negative_prompt": uc,
            "v4_prompt": {
                "caption": {"base_caption": full_prompt, "char_captions": []},
                "use_coords": False,
                "use_order": True,
            },
            "v4_negative_prompt": {
                "caption": {"base_caption": uc, "char_captions": []},
                "legacy_uc": False,
            },
        },
    }

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "*/*"}
    async with httpx.AsyncClient(timeout=75.0) as client:
        r = await client.post(f"{base_url}/ai/generate-image", headers=headers, json=payload)
        if r.status_code != 200:
            raise ValueError(f"画师预览卡生成失败 ({r.status_code}): {r.text[:200]}")
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        png_bytes = zf.read(zf.namelist()[0])

    slug = clean_tag.replace("artist:", "").replace("(", "").replace(")", "").replace("/", "_").replace(":", "_")
    ARTISTS_DIR.mkdir(parents=True, exist_ok=True)
    file_path = ARTISTS_DIR / f"{slug}.png"
    file_path.write_bytes(png_bytes)

    preview_url = f"/artists/{slug}.png?t={int(time.time())}"
    updated = update_artist_preview(artist_id, preview_url)
    return updated or {"id": artist_id, "tag": clean_tag, "preview_url": preview_url}


def _stitch_xyz_grid(
    cells: List[Dict[str, Any]],
    x_labels: List[str],
    y_labels: List[str],
    out_root: Path,
    base_seed: int,
) -> Optional[Dict[str, Any]]:
    """
    Stitches completed X/Y/Z test images into a clean labeled contact sheet PNG saved to D:\\NAI-Studio\\outputs.
    """
    if not cells or not x_labels:
        return None
    cols = max(1, len(x_labels))
    rows = max(1, len(y_labels) or 1)
    cell_w, cell_h = 360, 480
    header_h = 44
    left_w = 130 if len(y_labels) > 1 else 20
    pad = 12

    sheet_w = left_w + cols * (cell_w + pad) + pad
    sheet_h = header_h + rows * (cell_h + pad) + pad
    sheet = Image.new("RGB", (sheet_w, sheet_h), (12, 24, 34))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for c_idx, xl in enumerate(x_labels):
        tx = left_w + pad + c_idx * (cell_w + pad) + 12
        draw.text((tx, 14), f"X: {xl}"[:38], fill=(125, 211, 252), font=font)

    for r_idx, yl in enumerate(y_labels or [""]):
        if len(y_labels) > 1:
            ty = header_h + pad + r_idx * (cell_h + pad) + cell_h // 2 - 10
            draw.text((12, ty), f"Y: {yl}"[:18], fill=(167, 243, 208), font=font)

    for cell in cells:
        r_idx = int(cell.get("row_idx") or 0)
        c_idx = int(cell.get("col_idx") or 0)
        item = cell.get("item") or {}
        rel = item.get("rel_path") or ""
        p = out_root / rel
        if not rel or not p.exists():
            continue
        im = ImageOps.contain(Image.open(p).convert("RGB"), (cell_w, cell_h), Image.Resampling.LANCZOS)
        px = left_w + pad + c_idx * (cell_w + pad) + (cell_w - im.width) // 2
        py = header_h + pad + r_idx * (cell_h + pad) + (cell_h - im.height) // 2
        sheet.paste(im, (px, py))

    day_str = datetime.date.today().isoformat()
    day_dir = out_root / day_str
    day_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time() * 1000)
    filename = f"nai_xyz_grid_{base_seed}_{ts}.png"
    full_path = day_dir / filename
    sheet.save(full_path, format="PNG")

    return add_gallery_item({
        "filename": filename,
        "rel_path": f"{day_str}/{filename}",
        "model": "xyz-matrix",
        "model_short": "X/Y 矩阵汇总",
        "action": "xyz_grid",
        "prompt": f"X/Y Matrix Grid ({cols}x{rows}) | X=[{', '.join(x_labels)}] Y=[{', '.join(y_labels)}]",
        "uc": "",
        "width": sheet_w,
        "height": sheet_h,
        "steps": 28,
        "scale": 5.0,
        "sampler": "k_euler_ancestral",
        "scheduler": "karras",
        "seed": base_seed,
        "notes": "X/Y 参数矩阵拼图",
    })


# ---------------------------------------------------------------------------
# Auto-Roll / Batch / Artist Backfill / XYZ Matrix Queue Manager
# ---------------------------------------------------------------------------
class QueueManager:
    def __init__(self) -> None:
        self.running: bool = False
        self.stop_requested: bool = False
        self.total: int = 0  # 0 means infinite auto-roll
        self.completed: int = 0
        self.last_item: Optional[Dict[str, Any]] = None
        self.items: List[Dict[str, Any]] = []
        self.last_error: str = ""
        self.mode_label: str = "idle"
        self.queue_kind: str = "roll"
        self._task: Optional[asyncio.Task] = None

    def status(self) -> Dict[str, Any]:
        return {
            "running": self.running,
            "stop_requested": self.stop_requested,
            "total": self.total,
            "completed": self.completed,
            "mode_label": self.mode_label,
            "queue_kind": self.queue_kind,
            "last_error": self.last_error,
            "last_item": self.last_item,
            "recent_items": self.items[-12:],
        }

    async def start(self, req: Dict[str, Any]) -> Dict[str, Any]:
        if self.running:
            raise ValueError("当前已有后台跑图队列正在运行，请先停止后再启动新队列。")
        self.running = True
        self.stop_requested = False
        self.completed = 0
        self.last_error = ""
        self.last_item = None
        self.items = []

        if req.get("artist_backfill"):
            pending = [
                a for a in list_artists()
                if not a.get("preview_url") or not (ARTISTS_DIR / Path(str(a["preview_url"]).split("?")[0].lstrip("/")).name).exists()
            ]
            if not pending:
                self.running = False
                raise ValueError("所有收录画师均已拥有本地标准预览卡，无需补齐。")
            self.queue_kind = "artist_backfill"
            self.total = len(pending)
            self.mode_label = f"画师预览补齐 ({self.total} 位)"
            self._task = asyncio.create_task(self._run_artist_backfill(pending, req))
            return self.status()

        xyz_jobs = req.get("xyz_jobs") or []
        if xyz_jobs:
            self.queue_kind = "xyz_matrix"
            self.total = len(xyz_jobs)
            self.mode_label = f"X/Y 参数矩阵 ({self.total} 格)"
            self._task = asyncio.create_task(self._run_xyz_loop(req, xyz_jobs))
            return self.status()

        self.queue_kind = "roll"
        count = int(req.get("count") or 3)
        self.total = max(0, min(count, 200))
        ab_artists = req.get("ab_artists") or []
        if ab_artists:
            self.total = len(ab_artists)
            self.mode_label = f"画师 A/B 对照 ({len(ab_artists)} 组)"
        elif self.total == 0:
            self.mode_label = "Opus 持续生成中"
        else:
            self.mode_label = f"批量生成队列 ({self.total} 张)"
        self._task = asyncio.create_task(self._run_loop(req, ab_artists))
        return self.status()

    async def _run_artist_backfill(self, pending: List[Dict[str, Any]], req: Dict[str, Any]) -> None:
        delay = float(req.get("delay_sec") or 1.4)
        model_id = str(req.get("model") or "nai-diffusion-4-5-full")
        try:
            for idx, artist in enumerate(pending):
                if self.stop_requested:
                    break
                try:
                    updated = await generate_artist_preview_card(
                        artist_id=artist["id"],
                        tag=artist["tag"],
                        sample_tags=artist.get("sample_tags", ""),
                        model_id=model_id,
                    )
                    self.last_item = updated
                    self.items.append(updated)
                    self.completed += 1
                except Exception as exc:
                    self.last_error = f"{artist['name']}: {exc}"
                    break
                if not self.stop_requested and idx + 1 < len(pending):
                    await asyncio.sleep(max(0.5, min(delay, 10.0)))
        finally:
            self.running = False

    async def _run_xyz_loop(self, base_req: Dict[str, Any], xyz_jobs: List[Dict[str, Any]]) -> None:
        delay = float(base_req.get("delay_sec") or 1.2)
        base_seed = int(base_req.get("seed") or 39481022)
        completed_cells: List[Dict[str, Any]] = []
        try:
            for idx, cell in enumerate(xyz_jobs):
                if self.stop_requested:
                    break
                job = dict(base_req)
                job.pop("xyz_jobs", None)
                job.pop("x_labels", None)
                job.pop("y_labels", None)
                overrides = cell.get("overrides") or {}
                job.update(overrides)
                job["seed"] = base_seed
                job["notes"] = f"X/Y [{cell.get('x_label', '')}" + (f" | {cell.get('y_label')}" if cell.get("y_label") else "") + "]"
                try:
                    item = await generate_image(job)
                    self.last_item = item
                    self.items.append(item)
                    completed_cells.append({**cell, "item": item})
                    self.completed += 1
                except Exception as exc:
                    self.last_error = str(exc)
                    break
                if not self.stop_requested and idx + 1 < len(xyz_jobs):
                    await asyncio.sleep(max(0.5, min(delay, 10.0)))

            if completed_cells and not self.stop_requested:
                cfg = load_config()
                out_root = Path(cfg.get("output_dir") or str(OUTPUTS_DIR))
                grid_item = _stitch_xyz_grid(
                    completed_cells,
                    base_req.get("x_labels") or [],
                    base_req.get("y_labels") or [],
                    out_root,
                    base_seed,
                )
                if grid_item:
                    self.last_item = grid_item
                    self.items.append(grid_item)
        finally:
            self.running = False

    async def _run_loop(self, base_req: Dict[str, Any], ab_artists: List[Dict[str, Any]]) -> None:
        delay = float(base_req.get("delay_sec") or 1.2)
        base_seed = base_req.get("seed")
        try:
            idx = 0
            while not self.stop_requested:
                if self.total > 0 and idx >= self.total:
                    break
                job = dict(base_req)
                if ab_artists:
                    ab = ab_artists[idx]
                    job["artist_mix"] = [{"tag": ab.get("tag", ""), "weight": float(ab.get("weight", 1.0))}]
                    job["notes"] = f"AB测试: {ab.get('label') or ab.get('tag')}"
                    if base_seed and int(base_seed) > 0:
                        job["seed"] = int(base_seed)
                elif base_req.get("lock_seed") and base_seed and int(base_seed) > 0:
                    job["seed"] = int(base_seed)
                else:
                    job["seed"] = None
                try:
                    item = await generate_image(job)
                    self.last_item = item
                    self.items.append(item)
                    self.completed += 1
                except Exception as exc:
                    self.last_error = str(exc)
                    break
                idx += 1
                if not self.stop_requested and (self.total == 0 or idx < self.total):
                    await asyncio.sleep(max(0.4, min(delay, 10.0)))
        finally:
            self.running = False

    def stop(self) -> Dict[str, Any]:
        self.stop_requested = True
        self.mode_label = "正在优雅停止..." if self.running else "idle"
        return self.status()


_QUEUE_MANAGER = QueueManager()


async def start_roll_queue(req: Dict[str, Any]) -> Dict[str, Any]:
    return await _QUEUE_MANAGER.start(req)


def stop_queue() -> Dict[str, Any]:
    return _QUEUE_MANAGER.stop()


def get_queue_status() -> Dict[str, Any]:
    return _QUEUE_MANAGER.status()
