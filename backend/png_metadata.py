import gzip
import io
import json
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image


def _source_to_model_id(source: str) -> str:
    s = (source or "").lower()
    if "v5" in s:
        return "nai-diffusion-5-curated" if "curated" in s else "nai-diffusion-5-full"
    if "v4.5" in s or "4-5" in s or "4.5" in s:
        return "nai-diffusion-4-5-curated" if "curated" in s else "nai-diffusion-4-5-full"
    if "v4" in s:
        return "nai-diffusion-4-curated-preview" if "curated" in s else "nai-diffusion-4-full"
    if "furry" in s:
        return "nai-diffusion-furry-3"
    if "v3" in s or "anime" in s:
        return "nai-diffusion-3"
    return "nai-diffusion-5-full"


def _extract_stealth_pnginfo(im: Image.Image) -> Optional[Dict[str, Any]]:
    """
    Reads NovelAI Stealth PNG LSB metadata ('stealth_pngcomp' or 'stealth_pnginfo')
    from the alpha channel of an RGBA image using fast numpy bit unpacking.
    """
    if im.mode != "RGBA":
        return None
    try:
        arr = np.array(im)
        # NovelAI stores stealth bits column-major (x outer, y inner -> transpose H,W to W,H)
        alpha_lsb = (arr[:, :, 3].T.flatten()) & 1
        if len(alpha_lsb) < 256:
            return None

        sig_Comp = b"stealth_pngcomp"
        sig_Info = b"stealth_pnginfo"
        sig_bits_len = len(sig_Comp) * 8

        header_bytes = np.packbits(alpha_lsb[:sig_bits_len]).tobytes()
        compressed = False
        if header_bytes == sig_Comp:
            compressed = True
        elif header_bytes == sig_Info:
            compressed = False
        else:
            return None

        len_bits = alpha_lsb[sig_bits_len : sig_bits_len + 32]
        param_len = int.from_bytes(np.packbits(len_bits).tobytes(), byteorder="big")
        start = sig_bits_len + 32
        end = start + param_len
        if param_len <= 0 or end > len(alpha_lsb):
            return None

        payload_bytes = np.packbits(alpha_lsb[start:end]).tobytes()
        if compressed:
            raw_text = gzip.decompress(payload_bytes).decode("utf-8", errors="replace")
        else:
            raw_text = payload_bytes.decode("utf-8", errors="replace")
        return json.loads(raw_text)
    except Exception:
        return None


def extract_nai_metadata(image_bytes: bytes) -> Dict[str, Any]:
    """
    Extracts complete NovelAI recipe metadata from PNG bytes (both tEXt chunks and Stealth PNG LSB).
    Returns a normalized recipe dictionary ready for Workbench restoration.
    """
    im = Image.open(io.BytesIO(image_bytes))
    width, height = im.size
    info = dict(im.info or {})
    stealth = _extract_stealth_pnginfo(im)

    if stealth and isinstance(stealth, dict):
        for k, v in stealth.items():
            if k not in info:
                info[k] = v

    comment_raw = info.get("Comment") or info.get("comment") or ""
    comment_obj: Dict[str, Any] = {}
    if isinstance(comment_raw, str) and comment_raw.strip().startswith("{"):
        try:
            comment_obj = json.loads(comment_raw)
        except Exception:
            comment_obj = {}
    elif isinstance(comment_raw, dict):
        comment_obj = comment_raw

    source = str(info.get("Source") or comment_obj.get("Source") or "")
    software = str(info.get("Software") or comment_obj.get("Software") or "")
    description = str(info.get("Description") or "")

    prompt = str(comment_obj.get("prompt") or description or "")
    uc = str(comment_obj.get("uc") or comment_obj.get("negative_prompt") or "")

    # Extract V4/V5 character captions if present
    characters: List[Dict[str, Any]] = []
    v4_p = comment_obj.get("v4_prompt")
    v4_n = comment_obj.get("v4_negative_prompt")
    if isinstance(v4_p, dict):
        cap = v4_p.get("caption") or {}
        if not prompt and cap.get("base_caption"):
            prompt = str(cap.get("base_caption"))
        char_caps = cap.get("char_captions") or []
        neg_caps = ((v4_n or {}).get("caption") or {}).get("char_captions") or [] if isinstance(v4_n, dict) else []
        for idx, cc in enumerate(char_caps):
            c_prompt = str(cc.get("char_caption") or "")
            c_uc = str(neg_caps[idx].get("char_caption") or "") if idx < len(neg_caps) else ""
            centers = cc.get("centers") or [{"x": 0.5, "y": 0.5}]
            center = centers[0] if centers else {"x": 0.5, "y": 0.5}
            characters.append({
                "prompt": c_prompt,
                "uc": c_uc,
                "x": float(center.get("x", 0.5)),
                "y": float(center.get("y", 0.5)),
            })

    if not uc and isinstance(v4_n, dict):
        uc = str((v4_n.get("caption") or {}).get("base_caption") or "")

    model_id = _source_to_model_id(source)
    has_nai_meta = bool(comment_obj or "NovelAI" in software or "NovelAI" in source or stealth)

    return {
        "has_nai_metadata": has_nai_meta,
        "metadata_source": "stealth_lsb" if stealth and not im.info.get("Comment") else ("png_chunk" if has_nai_meta else "basic_image"),
        "software": software or ("NovelAI" if has_nai_meta else "Unknown"),
        "source": source,
        "model": model_id,
        "prompt": prompt,
        "uc": uc,
        "width": int(comment_obj.get("width") or width),
        "height": int(comment_obj.get("height") or height),
        "steps": int(comment_obj.get("steps") or 28),
        "scale": float(comment_obj.get("scale") or 5.0),
        "cfg_rescale": float(comment_obj.get("cfg_rescale") or 0.0),
        "sampler": str(comment_obj.get("sampler") or "k_euler_ancestral"),
        "scheduler": str(comment_obj.get("noise_schedule") or "karras"),
        "seed": int(comment_obj.get("seed") or 0),
        "sm": bool(comment_obj.get("sm") or False),
        "sm_dyn": bool(comment_obj.get("sm_dyn") or False),
        "variety_plus": comment_obj.get("skip_cfg_above_sigma") is not None,
        "use_coords": bool((v4_p or {}).get("use_coords") if isinstance(v4_p, dict) else False),
        "characters": characters,
        "raw_comment": comment_obj,
    }
