from typing import Any, Dict, List

SAMPLERS_V4_V5 = [
    {"id": "k_euler_ancestral", "label": "Euler Ancestral (推荐 · 灵动自然)"},
    {"id": "k_euler", "label": "Euler (稳定纯净)"},
    {"id": "k_dpmpp_2s_ancestral", "label": "DPM++ 2S Ancestral (细节丰富)"},
    {"id": "k_dpmpp_2m_sde", "label": "DPM++ 2M SDE (柔滑过渡)"},
    {"id": "k_dpmpp_2m", "label": "DPM++ 2M (锐利清晰)"},
    {"id": "k_dpmpp_sde", "label": "DPM++ SDE"},
]

SAMPLERS_V3 = SAMPLERS_V4_V5 + [
    {"id": "ddim_v3", "label": "DDIM V3 (V3 专用)"},
]

SCHEDULERS_ALL = [
    {"id": "karras", "label": "Karras (默认推荐)"},
    {"id": "native", "label": "Native (原生调度)"},
    {"id": "exponential", "label": "Exponential (指数平滑)"},
    {"id": "polyexponential", "label": "Polyexponential (多项式指数)"},
]

RESOLUTIONS = [
    {"id": "portrait", "label": "竖图", "sub": "832×1216", "width": 832, "height": 1216, "opus_free": True},
    {"id": "landscape", "label": "横图", "sub": "1216×832", "width": 1216, "height": 832, "opus_free": True},
    {"id": "square", "label": "方图", "sub": "1024×1024", "width": 1024, "height": 1024, "opus_free": True},
    {"id": "small_portrait", "label": "轻快竖图", "sub": "704×1408", "width": 704, "height": 1408, "opus_free": True},
    {"id": "small_landscape", "label": "轻快横图", "sub": "1408×704", "width": 1408, "height": 704, "opus_free": True},
    {"id": "large_portrait", "label": "超清竖图 (需点数)", "sub": "1024×1536", "width": 1024, "height": 1536, "opus_free": False},
    {"id": "large_landscape", "label": "超清横图 (需点数)", "sub": "1536×1024", "width": 1536, "height": 1024, "opus_free": False},
]

UC_PRESETS_V4_V5 = {
    "heavy": {
        "id": 0,
        "label": "强力预设 (Heavy)",
        "tags": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, blurry",
    },
    "light": {
        "id": 1,
        "label": "轻度预设 (Light)",
        "tags": "lowres, artistic error, worst quality, bad quality, jpeg artifacts, very displeasing, multiple views, logo, too many watermarks, negative space, blank page",
    },
    "human": {
        "id": 2,
        "label": "人体强化 (Human Focus)",
        "tags": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, bad anatomy, bad hands, mismatched pupils, floating limbs, extra legs, extra arms, missing fingers, extra digit, fewer digits",
    },
    "none": {
        "id": 3,
        "label": "无预设 (None)",
        "tags": "",
    },
}

UC_PRESETS_V3 = {
    "heavy": {
        "id": 0,
        "label": "强力预设 (Heavy)",
        "tags": "nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
    },
    "light": {
        "id": 1,
        "label": "轻度预设 (Light)",
        "tags": "nsfw, lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
    },
    "none": {
        "id": 3,
        "label": "无预设 (None)",
        "tags": "",
    },
}

DIRECTOR_EMOTIONS: List[Dict[str, str]] = [
    {"id": "happy", "label": "开心微笑 (Happy)"},
    {"id": "shy", "label": "害羞脸红 (Shy)"},
    {"id": "smug", "label": "得意坏笑 (Smug)"},
    {"id": "sad", "label": "悲伤垂眸 (Sad)"},
    {"id": "angry", "label": "生气怒视 (Angry)"},
    {"id": "surprised", "label": "惊讶瞪眼 (Surprised)"},
    {"id": "excited", "label": "兴奋闪耀 (Excited)"},
    {"id": "love", "label": "爱意温柔 (Love)"},
    {"id": "laughing", "label": "开怀大笑 (Laughing)"},
    {"id": "embarrassed", "label": "羞窘慌乱 (Embarrassed)"},
    {"id": "thinking", "label": "托腮思考 (Thinking)"},
    {"id": "neutral", "label": "平静自然 (Neutral)"},
    {"id": "scared", "label": "惊恐害怕 (Scared)"},
    {"id": "nervous", "label": "紧张局促 (Nervous)"},
    {"id": "confused", "label": "困惑歪头 (Confused)"},
    {"id": "tired", "label": "疲惫慵懒 (Tired)"},
    {"id": "bored", "label": "无聊发呆 (Bored)"},
    {"id": "disgusted", "label": "嫌弃厌恶 (Disgusted)"},
    {"id": "irritated", "label": "烦躁不耐 (Irritated)"},
    {"id": "worried", "label": "担忧蹙眉 (Worried)"},
    {"id": "determined", "label": "坚定锐利 (Determined)"},
    {"id": "hurt", "label": "受伤委屈 (Hurt)"},
    {"id": "playful", "label": "调皮吐舌 (Playful)"},
    {"id": "aroused", "label": "迷离微醺 (Flushed)"},
]

MODELS_CATALOG: Dict[str, Dict[str, Any]] = {
    "nai-diffusion-5-full": {
        "id": "nai-diffusion-5-full",
        "name": "NAI Diffusion V5 Full",
        "short_name": "V5 Full",
        "family": "v5",
        "badge": "V5 旗舰 · 32ch VAE",
        "opus_note": "Opus 0点数免费（消耗 V5 恢复型周算力配额）",
        "description": "2026 全新 32 通道 VAE 架构，极致手部/眼部细节、支持原生透明底与强多角色自然语言理解。暂不支持 Vibe 与 Precise 参考图。",
        "inpaint_model": "nai-diffusion-5-full-inpainting",
        "params_version": 3,
        "supports_vibe": False,
        "vibe_raw_image_free": False,
        "supports_precise_ref": False,
        "supports_multi_char": True,
        "max_characters": 6,
        "supports_numeric_weight": True,
        "supports_negative_weight": True,
        "supports_alpha_transparency": True,
        "supports_smea": False,
        "supports_variety_plus": True,
        "supports_decrisper": False,
        "uses_v5_quota": True,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.0,
        "default_steps": 28,
        "skip_cfg_above_sigma": 19.0,
        "quality_tags": "masterpiece, best quality, very aesthetic, absurdres",
        "samplers": SAMPLERS_V4_V5,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V4_V5,
        "unsupported_reasons": {
            "vibe": "NAI V5 采用全新 32 通道架构，官方尚未开放 V5 的 Vibe 风格参考。如需使用 Vibe，请切换至 V4.5 Full 或 V3。",
            "precise_ref": "Precise Reference（精准角色/画风参考）目前为 V4.5 专属能力，V5 暂不支持。",
            "smea": "SMEA / SMEA DYN 仅适用于 V3 旧架构，V5 原生支持高分辨率无需开启 SMEA。",
        },
    },
    "nai-diffusion-5-curated": {
        "id": "nai-diffusion-5-curated",
        "name": "NAI Diffusion V5 Curated",
        "short_name": "V5 Curated",
        "family": "v5",
        "badge": "V5 精选 · 构图干净",
        "opus_note": "Opus 0点数免费（消耗 V5 恢复型周算力配额）",
        "description": "V5 精选美学基底，画面干净清爽，支持原生透明底与多角色分控。暂不支持 Vibe 与 Precise 参考图。",
        "inpaint_model": "nai-diffusion-5-full-inpainting",
        "params_version": 3,
        "supports_vibe": False,
        "vibe_raw_image_free": False,
        "supports_precise_ref": False,
        "supports_multi_char": True,
        "max_characters": 6,
        "supports_numeric_weight": True,
        "supports_negative_weight": True,
        "supports_alpha_transparency": True,
        "supports_smea": False,
        "supports_variety_plus": True,
        "supports_decrisper": False,
        "uses_v5_quota": True,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.0,
        "default_steps": 28,
        "skip_cfg_above_sigma": 19.0,
        "quality_tags": "masterpiece, best quality, very aesthetic, absurdres",
        "samplers": SAMPLERS_V4_V5,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V4_V5,
        "unsupported_reasons": {
            "vibe": "NAI V5 架构暂不支持 Vibe 风格参考，请切换至 V4.5 或 V3。",
            "precise_ref": "Precise Reference 目前为 V4.5 专属能力，V5 暂不支持。",
            "smea": "SMEA 仅适用于 V3 模型。",
        },
    },
    "nai-diffusion-4-5-full": {
        "id": "nai-diffusion-4-5-full",
        "name": "NAI Diffusion V4.5 Full",
        "short_name": "V4.5 Full",
        "family": "v4_5",
        "badge": "V4.5 全能 · Opus 无限免费",
        "opus_note": "Opus 0点数无限免费（不耗 V5 配额）",
        "description": "功能最全的主力模型：Opus 无限制免费生成，完整支持多角色站位、正负数字权重、Vibe Transfer 与 Precise 精准参考。",
        "inpaint_model": "nai-diffusion-4-5-full-inpainting",
        "params_version": 3,
        "supports_vibe": True,
        "vibe_raw_image_free": False,
        "supports_precise_ref": True,
        "supports_multi_char": True,
        "max_characters": 6,
        "supports_numeric_weight": True,
        "supports_negative_weight": True,
        "supports_alpha_transparency": False,
        "supports_smea": False,
        "supports_variety_plus": True,
        "supports_decrisper": False,
        "uses_v5_quota": False,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.0,
        "default_steps": 28,
        "skip_cfg_above_sigma": 58.0,
        "quality_tags": "masterpiece, best quality, very aesthetic, absurdres",
        "samplers": SAMPLERS_V4_V5,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V4_V5,
        "unsupported_reasons": {
            "alpha_transparency": "原生透明底（Alpha Transparency）为 V5 专属特性，V4.5 请使用生成后 Director 去背景。",
            "smea": "SMEA 仅适用于 V3 模型。",
        },
    },
    "nai-diffusion-4-5-curated": {
        "id": "nai-diffusion-4-5-curated",
        "name": "NAI Diffusion V4.5 Curated",
        "short_name": "V4.5 Curated",
        "family": "v4_5",
        "badge": "V4.5 精选 · Opus 无限免费",
        "opus_note": "Opus 0点数无限免费（不耗 V5 配额）",
        "description": "V4.5 精选模型，支持全套多角色分控、Vibe 与 Precise 参考，Opus 无限制免费出图。",
        "inpaint_model": "nai-diffusion-4-5-curated-inpainting",
        "params_version": 3,
        "supports_vibe": True,
        "vibe_raw_image_free": False,
        "supports_precise_ref": True,
        "supports_multi_char": True,
        "max_characters": 6,
        "supports_numeric_weight": True,
        "supports_negative_weight": True,
        "supports_alpha_transparency": False,
        "supports_smea": False,
        "supports_variety_plus": True,
        "supports_decrisper": False,
        "uses_v5_quota": False,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.0,
        "default_steps": 28,
        "skip_cfg_above_sigma": 58.0,
        "quality_tags": "masterpiece, best quality, very aesthetic, absurdres",
        "samplers": SAMPLERS_V4_V5,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V4_V5,
        "unsupported_reasons": {
            "alpha_transparency": "原生透明底为 V5 专属特性。",
            "smea": "SMEA 仅适用于 V3 模型。",
        },
    },
    "nai-diffusion-4-full": {
        "id": "nai-diffusion-4-full",
        "name": "NAI Diffusion V4 Full",
        "short_name": "V4 Full",
        "family": "v4",
        "badge": "V4 经典 · Opus 无限免费",
        "opus_note": "Opus 0点数无限免费",
        "description": "经典 V4 完整版，支持多角色站位与 Vibe 参考，不支持负向数字权重 (-1::tag::) 与 Precise 精准参考。",
        "inpaint_model": "nai-diffusion-4-full-inpainting",
        "params_version": 3,
        "supports_vibe": True,
        "vibe_raw_image_free": False,
        "supports_precise_ref": False,
        "supports_multi_char": True,
        "max_characters": 6,
        "supports_numeric_weight": True,
        "supports_negative_weight": False,
        "supports_alpha_transparency": False,
        "supports_smea": False,
        "supports_variety_plus": True,
        "supports_decrisper": False,
        "uses_v5_quota": False,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.5,
        "default_steps": 28,
        "skip_cfg_above_sigma": 19.0,
        "quality_tags": "no text, best quality, very aesthetic, absurdres",
        "samplers": SAMPLERS_V4_V5,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V4_V5,
        "unsupported_reasons": {
            "precise_ref": "Precise 精准参考仅在 V4.5 模型中支持，V4.0 不支持。",
            "negative_weight": "负数数字权重（如 -1::tag::）仅在 V4.5 与 V5 中生效。",
            "alpha_transparency": "原生透明底为 V5 专属特性。",
            "smea": "SMEA 仅适用于 V3 模型。",
        },
    },
    "nai-diffusion-4-curated-preview": {
        "id": "nai-diffusion-4-curated-preview",
        "name": "NAI Diffusion V4 Curated",
        "short_name": "V4 Curated",
        "family": "v4",
        "badge": "V4 精选 · Opus 无限免费",
        "opus_note": "Opus 0点数无限免费",
        "description": "V4 精选先行版，支持多角色分控与 Vibe 参考。",
        "inpaint_model": "nai-diffusion-4-curated-inpainting",
        "params_version": 3,
        "supports_vibe": True,
        "vibe_raw_image_free": False,
        "supports_precise_ref": False,
        "supports_multi_char": True,
        "max_characters": 6,
        "supports_numeric_weight": True,
        "supports_negative_weight": False,
        "supports_alpha_transparency": False,
        "supports_smea": False,
        "supports_variety_plus": True,
        "supports_decrisper": False,
        "uses_v5_quota": False,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.5,
        "default_steps": 28,
        "skip_cfg_above_sigma": 19.0,
        "quality_tags": "no text, best quality, very aesthetic, absurdres",
        "samplers": SAMPLERS_V4_V5,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V4_V5,
        "unsupported_reasons": {
            "precise_ref": "Precise 精准参考仅在 V4.5 模型中支持。",
            "negative_weight": "负数数字权重仅在 V4.5 与 V5 中生效。",
            "alpha_transparency": "原生透明底为 V5 专属特性。",
            "smea": "SMEA 仅适用于 V3 模型。",
        },
    },
    "nai-diffusion-3": {
        "id": "nai-diffusion-3",
        "name": "NAI Diffusion Anime V3",
        "short_name": "Anime V3",
        "family": "v3",
        "badge": "V3 经典 · 原图 Vibe 免费",
        "opus_note": "Opus 0点数无限免费（支持直接传原图免费 Vibe）",
        "description": "经典 V3 二次元模型：支持 SMEA/DYN，且在 0 点数下可直接上传普通 PNG/JPG 进行免费 Vibe 风格迁移！不支持多角色站位与 :: 数字权重。",
        "inpaint_model": "nai-diffusion-3-inpainting",
        "params_version": 3,
        "supports_vibe": True,
        "vibe_raw_image_free": True,
        "supports_precise_ref": False,
        "supports_multi_char": False,
        "max_characters": 0,
        "supports_numeric_weight": False,
        "supports_negative_weight": False,
        "supports_alpha_transparency": False,
        "supports_smea": True,
        "supports_variety_plus": False,
        "supports_decrisper": True,
        "uses_v5_quota": False,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.0,
        "default_steps": 28,
        "skip_cfg_above_sigma": None,
        "quality_tags": "best quality, amazing quality, very aesthetic, absurdres",
        "samplers": SAMPLERS_V3,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V3,
        "unsupported_reasons": {
            "multi_char": "NAI V3 不支持多角色分区站位（v4_prompt），所有描述将在同一全局画布中渲染。",
            "numeric_weight": "NAI V3 不支持 weight::tag:: 数字权重语法，请使用 {tag} 与 [tag] 括号加减权。",
            "precise_ref": "Precise 精准参考仅限 V4.5 模型使用。",
            "alpha_transparency": "原生透明底仅限 V5 模型使用。",
        },
    },
    "nai-diffusion-furry-3": {
        "id": "nai-diffusion-furry-3",
        "name": "NAI Diffusion Furry V3",
        "short_name": "Furry V3",
        "family": "v3",
        "badge": "V3 Furry · 专属词库",
        "opus_note": "Opus 0点数无限免费",
        "description": "V3 Furry 特化模型，支持 SMEA/DYN 与 0 点数原图 Vibe 参考，仅支持 {} / [] 权重语法。",
        "inpaint_model": "nai-diffusion-furry-3-inpainting",
        "params_version": 3,
        "supports_vibe": True,
        "vibe_raw_image_free": True,
        "supports_precise_ref": False,
        "supports_multi_char": False,
        "max_characters": 0,
        "supports_numeric_weight": False,
        "supports_negative_weight": False,
        "supports_alpha_transparency": False,
        "supports_smea": True,
        "supports_variety_plus": False,
        "supports_decrisper": True,
        "uses_v5_quota": False,
        "default_sampler": "k_euler_ancestral",
        "default_scheduler": "karras",
        "default_scale": 5.0,
        "default_steps": 28,
        "skip_cfg_above_sigma": None,
        "quality_tags": "{best quality}, {amazing quality}",
        "samplers": SAMPLERS_V3,
        "schedulers": SCHEDULERS_ALL,
        "uc_presets": UC_PRESETS_V3,
        "unsupported_reasons": {
            "multi_char": "Furry V3 不支持多角色分区站位。",
            "numeric_weight": "Furry V3 不支持 :: 数字权重语法，请使用 {} 与 []。",
            "precise_ref": "Precise 精准参考仅限 V4.5 模型。",
            "alpha_transparency": "原生透明底仅限 V5 模型。",
        },
    },
}


def get_model_spec(model_id: str) -> Dict[str, Any]:
    return MODELS_CATALOG.get(model_id, MODELS_CATALOG["nai-diffusion-5-full"])


def estimate_generation_cost(
    model_id: str,
    width: int,
    height: int,
    steps: int,
    n_samples: int = 1,
    has_vibe_raw_encode: bool = False,
    vibe_count: int = 0,
    has_precise_ref: bool = False,
    is_opus: bool = True,
) -> Dict[str, Any]:
    """
    Calculates whether the generation is 100% Free under Opus (0 Anlas) or requires paid Anlas.
    """
    spec = get_model_spec(model_id)
    pixels = int(width) * int(height)
    steps = int(steps)
    n_samples = int(n_samples)

    reasons: List[str] = []
    extra_anlas = 0

    base_opus_free = is_opus and (pixels <= 1048576) and (steps <= 28) and (n_samples == 1)

    if pixels > 1048576:
        reasons.append(f"分辨率 {width}×{height} ({pixels:,} px) 超过 Opus 免费上限 1,048,576 px")
    if steps > 28:
        reasons.append(f"步数 {steps} 超过 Opus 免费上限 28 步")
    if n_samples > 1:
        reasons.append(f"单次连抽 {n_samples} 张超过 Opus 单次免费上限 1 张")

    if has_precise_ref and spec["supports_precise_ref"]:
        extra_anlas += 5
        reasons.append("启用 Precise 精准参考固定消耗 5 Anlas")

    if has_vibe_raw_encode and spec["supports_vibe"] and not spec["vibe_raw_image_free"]:
        extra_anlas += 2
        reasons.append("V4/V4.5 编码新原图为 Vibe 需消耗 2 Anlas（导入已编码 .naiv4vibe 或使用 V3 原图 Vibe 为 0 Anlas）")

    if spec["family"] in ("v4", "v4_5") and vibe_count > 4:
        vibe_surcharge = (vibe_count - 4) * 2
        extra_anlas += vibe_surcharge
        reasons.append(f"叠加超过 4 张 Vibe 参考额外消耗 {vibe_surcharge} Anlas")

    if base_opus_free and extra_anlas == 0:
        return {
            "anlas_cost": 0,
            "is_opus_free": True,
            "uses_v5_quota": spec["uses_v5_quota"],
            "badge": "0 Anlas · V5免费" if spec["uses_v5_quota"] else "0 Anlas · 无限免费",
            "reasons": [],
        }

    # Approximate base generation cost if not Opus free
    base_cost = 0
    if not base_opus_free:
        base_cost = max(5, int(round((pixels / 1048576.0) * (steps / 28.0) * 16.0)) * n_samples)

    total_cost = base_cost + extra_anlas
    return {
        "anlas_cost": total_cost,
        "is_opus_free": False,
        "uses_v5_quota": spec["uses_v5_quota"],
        "badge": f"预计消耗 {total_cost} Anlas",
        "reasons": reasons,
    }
