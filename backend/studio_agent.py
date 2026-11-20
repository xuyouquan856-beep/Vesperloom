import asyncio
import base64
from io import BytesIO
import json
from pathlib import Path
import re
import time
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx
from PIL import Image

from .config import ARTISTS_DIR, OUTPUTS_DIR, load_config
from .database import (
    add_mix_preset,
    append_agent_message,
    batch_delete_gallery,
    batch_favorite_gallery,
    count_gallery,
    create_agent_session,
    delete_artist,
    delete_mix_preset,
    get_agent_session,
    get_gallery_item,
    list_artists,
    list_gallery,
    list_mix_presets,
    list_oc_cards,
    list_snippets,
    sync_outputs_folder,
    toggle_artist_favorite,
    update_agent_session_meta,
    update_artist,
    update_gallery_notes,
    upsert_artist,
)
from .models_spec import DIRECTOR_EMOTIONS, MODELS_CATALOG, get_model_spec
from .prompt_agent import (
    _clean_base_url,
    _clean_tag_field,
    _get_llm_client,
    post_chat_with_max_tokens_fallback,
)
from .prompt_engine import lint_prompt, search_builtin_tags
from .skills_manager import get_skill, list_skills

STUDIO_AGENT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "read_skill",
            "description": "Load the full Markdown instructions of a workspace SKILL.md on demand (Progressive Disclosure).",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill slug name from <available_skills>."}
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_artist_catalog",
            "description": "Search NAI Studio's local artist catalog (curated + custom) by keyword, style mood, category, or favorites.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Chinese or English keyword."},
                    "category": {"type": "string", "description": "Optional category (厚涂光影, 清透水彩, 幻彩插画, 日系轻小说, 赛博冷调, 私人收藏)."},
                    "favorite_only": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_danbooru_tags",
            "description": "Search verified English Danbooru/NovelAI tags matching a Chinese or English visual concept.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Concept or space-separated concepts (e.g. '水手服 逆光')."}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_oc_and_snippets",
            "description": "List saved OC character cards and reusable prompt snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_gallery",
            "description": "Search the user's local generated gallery history by prompt, model, notes, or favorites.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {"type": "string"},
                    "favorite_only": {"type": "boolean"},
                    "limit": {"type": "integer", "default": 6},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_model_rules",
            "description": "Inspect exact NovelAI model capabilities, numeric weight support, quality tags, and UC presets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_id": {"type": "string"}
                },
                "required": ["model_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_and_lint_prompt",
            "description": "Run NAI Studio's official syntax linter on a prompt string to detect errors or warnings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "model_id": {"type": "string"},
                },
                "required": ["prompt", "model_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "patch_prompt_blocks",
            "description": "Directly edit one or more of the 4 workbench prompt blocks (artist, character, lighting, negative) in real time. Use mode='merge' to append/deduplicate colloquial additions onto existing tags, or mode='replace' to rewrite specified blocks cleanly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "artist": {"type": "string", "description": "Artist mix tags ONLY (e.g. '0.85::artist:rella::, 0.65::artist:ciloranko::'). Omit to leave unchanged."},
                    "character": {"type": "string", "description": "Subject, hair, eyes, expression, pose, outfit tags. Omit to leave unchanged."},
                    "lighting": {"type": "string", "description": "Framing, scene, weather, lighting, atmosphere, quality tags. Omit to leave unchanged."},
                    "negative": {"type": "string", "description": "Undesired content (UC) tags. Omit to leave unchanged."},
                    "mode": {"type": "string", "enum": ["merge", "replace"], "default": "merge"},
                    "reason": {"type": "string", "description": "Short Chinese summary of what changed."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_prompt_tags",
            "description": "Remove specific unwanted tags from the positive prompt blocks or negative prompt (UC) in real time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tag strings to remove."},
                    "side": {"type": "string", "enum": ["pos", "uc"], "default": "pos"},
                    "reason": {"type": "string"},
                },
                "required": ["tags"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_workbench_params",
            "description": "Modify live workbench generation parameters (model, resolution, steps, CFG scale, cfg_rescale, sampler, scheduler, seed, variety_plus, alpha_transparency, auto_quality, batch_count).",
            "parameters": {
                "type": "object",
                "properties": {
                    "model": {"type": "string", "enum": list(MODELS_CATALOG.keys())},
                    "width": {"type": "integer"},
                    "height": {"type": "integer"},
                    "steps": {"type": "integer"},
                    "scale": {"type": "number"},
                    "cfg_rescale": {"type": "number"},
                    "sampler": {"type": "string"},
                    "scheduler": {"type": "string"},
                    "seed": {"type": "integer"},
                    "variety_plus": {"type": "boolean"},
                    "alpha_transparency": {"type": "boolean"},
                    "auto_quality": {"type": "boolean"},
                    "batch_count": {"type": "integer"},
                    "reason": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_workbench_mode",
            "description": "Switch the workbench canvas mode between text-to-image ('generate'), image-to-image ('img2img'), local inpainting ('infill'), and outpainting ('outpaint').",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["generate", "img2img", "infill", "outpaint"]},
                    "i2i_strength": {"type": "number", "description": "Optional img2img strength 0.1-0.99."},
                    "outpaint_direction": {"type": "string", "enum": ["right", "left", "top", "bottom", "center"]},
                    "reason": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "load_oc_character",
            "description": "Load a saved OC character card by name or id into the character block and/or multi-character slot.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {"type": "string"},
                    "apply_to_character_block": {"type": "boolean", "default": True},
                },
                "required": ["name_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_director_tool",
            "description": "Run NovelAI Director post-processing on the current canvas artwork (0 Anlas): lineart, sketch, colorize, emotion (24 presets), or declutter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "req_type": {"type": "string", "enum": ["lineart", "sketch", "colorize", "emotion", "declutter"]},
                    "emotion": {"type": "string", "enum": [e["id"] for e in DIRECTOR_EMOTIONS]},
                    "defry": {"type": "integer", "minimum": 0, "maximum": 5, "default": 0},
                    "prompt": {"type": "string", "description": "Optional guiding prompt for colorize/emotion."},
                },
                "required": ["req_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_generate_image",
            "description": "Trigger image generation on the workbench using the current live prompts, mode, and parameters. Only invoke when the user asks to generate/draw now.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_artist_catalog",
            "description": "Manage the local Artist Catalog: single or BATCH add/update artists, toggle favorite, delete by ID, or trigger 0-Anlas preview card generation (defaults to nai-diffusion-4-5-full). ALWAYS use action='batch_add' or 'batch_update' when handling 2+ artists at once!",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add", "batch_add", "update", "batch_update", "favorite", "delete", "generate_preview"],
                    },
                    "artist_id": {"type": "integer", "description": "Target artist id (for update/favorite/delete/generate_preview)."},
                    "name": {"type": "string", "description": "Display name."},
                    "tag": {"type": "string", "description": "Danbooru artist tag (e.g. artist:ogipote)."},
                    "category": {"type": "string", "description": "Category (厚涂光影, 清透水彩, 幻彩插画, 日系轻小说, 赛博冷调, 私人收藏, etc.)."},
                    "desc": {"type": "string", "description": "Short Chinese description of the artist style & traits."},
                    "sample_tags": {"type": "string", "description": "Comma-separated style/visual tags for this artist."},
                    "model": {
                        "type": "string",
                        "default": "nai-diffusion-4-5-full",
                        "description": "Model ID for preview generation (e.g. nai-diffusion-4-5-full or nai-diffusion-5-full).",
                    },
                    "generate_preview": {
                        "type": "boolean",
                        "default": False,
                        "description": "If true on add/batch_add, trigger 0-Anlas preview generation / backfill queue immediately.",
                    },
                    "artists": {
                        "type": "array",
                        "description": "For action='batch_add': list of artists to add in one single tool call (up to 100).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "tag": {"type": "string"},
                                "name": {"type": "string"},
                                "category": {"type": "string"},
                                "desc": {"type": "string"},
                                "sample_tags": {"type": "string"},
                            },
                            "required": ["tag"],
                        },
                    },
                    "updates": {
                        "type": "array",
                        "description": "For action='batch_update': list of artist metadata/tag updates in one single tool call.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "artist_id": {"type": "integer"},
                                "tag": {"type": "string"},
                                "name": {"type": "string"},
                                "category": {"type": "string"},
                                "desc": {"type": "string"},
                                "sample_tags": {"type": "string"},
                            },
                        },
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_danbooru_artists",
            "description": "Query Danbooru public API concurrently for up to 20 artist tags to retrieve canonical tag, post count, aliases, Pixiv/Twitter/X links, wiki excerpt, and top recurring visual tags.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Up to 20 artist tags (with or without 'artist:' prefix, spaces or underscores accepted).",
                    },
                },
                "required": ["tags"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_artist_previews",
            "description": "Visually inspect generated local artist preview cards (up to 6 artist_ids per call) using multimodal vision to analyze brushwork, color palette, lighting, and recommend category/desc/tags.",
            "parameters": {
                "type": "object",
                "properties": {
                    "artist_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Up to 6 artist IDs that already have preview images generated.",
                    },
                },
                "required": ["artist_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_canvas_stage",
            "description": "Visually inspect the image currently displayed on the central workbench canvas using multimodal vision. Use when the user asks you to critique/examine the current canvas artwork (hands, anatomy, lighting, color cast, background artifacts) before editing prompts or running img2img/inpaint/Director.",
            "parameters": {
                "type": "object",
                "properties": {
                    "focus": {
                        "type": "string",
                        "description": "What aspect to inspect closely (e.g. 'overall quality & lighting', 'hands & anatomy', 'color palette & style').",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_gallery_images",
            "description": "Visually inspect up to 4 saved Gallery artworks by item_id using multimodal vision to compare results, diagnose defects, or explain why one seed/recipe performed better.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Up to 4 gallery item IDs.",
                    },
                    "question": {
                        "type": "string",
                        "description": "Specific visual question or comparison goal.",
                    },
                },
                "required": ["item_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_mix_presets",
            "description": "List, save, apply (to workbench artist block), or delete saved artist mix presets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "save", "apply", "delete"]},
                    "preset_id": {"type": "integer"},
                    "name": {"type": "string"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "tag": {"type": "string"},
                                "name": {"type": "string"},
                                "weight": {"type": "number"},
                            },
                            "required": ["tag", "weight"],
                        },
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_gallery_items",
            "description": "Manage the local Artwork Gallery: favorite/unfavorite artworks, set searchable notes, load a past artwork & recipe to workbench, sync D:\\NAI-Studio\\outputs folder, or delete specific item IDs explicitly requested by the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["favorite", "unfavorite", "set_notes", "load_to_workbench", "sync_folder", "delete"]},
                    "item_id": {"type": "integer"},
                    "ids": {"type": "array", "items": {"type": "integer"}},
                    "notes": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
]


def _split_tags(text: str) -> List[str]:
    raw = str(text or "")
    parts: List[str] = []
    buf: List[str] = []
    d_curly = 0
    d_sq = 0
    for ch in raw:
        if ch == "{":
            d_curly += 1
        elif ch == "}" and d_curly > 0:
            d_curly -= 1
        elif ch == "[":
            d_sq += 1
        elif ch == "]" and d_sq > 0:
            d_sq -= 1
        elif ch == "," and d_curly == 0 and d_sq == 0:
            seg = "".join(buf).strip()
            if seg:
                parts.append(seg)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _normalize_tag_key(seg: str) -> str:
    s = seg.strip()
    s = re.sub(r"^[\{\[]+|[\}\]]+$", "", s)
    s = re.sub(r"^-?\d+(?:\.\d+)?::|::$", "", s)
    return s.strip().lower()


def _merge_tag_strings(existing: str, addition: str, mode: str = "merge") -> Tuple[str, List[str], List[str]]:
    old_tags = _split_tags(existing)
    new_tags = _split_tags(_clean_tag_field(addition))
    if mode == "replace":
        old_keys = {_normalize_tag_key(t) for t in old_tags}
        new_keys = {_normalize_tag_key(t) for t in new_tags}
        added = [t for t in new_tags if _normalize_tag_key(t) not in old_keys]
        removed = [t for t in old_tags if _normalize_tag_key(t) not in new_keys]
        return ", ".join(new_tags), added, removed

    # Merge mode: keep existing order, replace same-key tag if re-weighted, append truly new tags
    result = list(old_tags)
    idx_by_key = {_normalize_tag_key(t): i for i, t in enumerate(result)}
    added: List[str] = []
    for t in new_tags:
        k = _normalize_tag_key(t)
        if not k:
            continue
        if k in idx_by_key:
            if result[idx_by_key[k]] != t:
                result[idx_by_key[k]] = t
                added.append(t)
        else:
            idx_by_key[k] = len(result)
            result.append(t)
            added.append(t)
    return ", ".join(result), added, []


def _extract_quick_replies(text: str) -> Tuple[str, List[str]]:
    m = re.search(r"\[QUICK_REPLIES:\s*([^\]]+)\]\s*$", text.strip())
    if not m:
        return text.strip(), []
    clean = text[: m.start()].strip()
    opts = [o.strip() for o in m.group(1).split("|") if o.strip()]
    return clean, opts[:4]


def _extract_slash_skills(user_msg: str) -> List[str]:
    return [m.group(1).lower() for m in re.finditer(r"(?:^|\s)/([a-zA-Z0-9_\-\u4e00-\u9fff]+)", user_msg or "")]


def _build_agent_system_prompt(workbench_state: Dict[str, Any], pinned_skills: List[str], slash_skills: List[str]) -> str:
    all_skills = list_skills(include_content=False)
    skills_index = "\n".join(
        f"- `{s['name']}` ({s['title']}): {s['description']} [触发词: {s['triggers']}]"
        for s in all_skills
    )

    eager_names: List[str] = []
    for name in list(pinned_skills) + list(slash_skills):
        if name and name not in eager_names:
            eager_names.append(name)

    eager_sections: List[str] = []
    for name in eager_names:
        sk = get_skill(name)
        if sk:
            eager_sections.append(f"### Active Skill: `{sk['name']}` ({sk['title']})\n{sk['content']}")
    active_skills_block = "\n\n".join(eager_sections) if eager_sections else "(None pre-loaded; call `read_skill(name)` whenever a skill matches the user's intent.)"

    wb_compact = {
        "model": workbench_state.get("model") or "nai-diffusion-5-full",
        "action": workbench_state.get("action") or "generate",
        "prompt_mode": workbench_state.get("prompt_mode") or "structured",
        "width": workbench_state.get("width") or 832,
        "height": workbench_state.get("height") or 1216,
        "steps": workbench_state.get("steps") or 28,
        "scale": workbench_state.get("scale") or 5.0,
        "sampler": workbench_state.get("sampler") or "k_euler_ancestral",
        "scheduler": workbench_state.get("scheduler") or "karras",
        "seed": workbench_state.get("seed") or 0,
        "opus_free_guard": workbench_state.get("opus_free_guard", True),
        "stage_has_image": bool(workbench_state.get("stage_has_image")),
        "stage_image_url": str(workbench_state.get("stage_image_url") or ""),
        "blocks": workbench_state.get("blocks") or {},
        "lint_issue_count": workbench_state.get("lint_issue_count", 0),
        "lint_issues": (workbench_state.get("lint_issues") or [])[:5],
    }

    return f"""You are **NAI Studio Copilot Agent**, a mature, engineering-grade NovelAI Diffusion V4.5 / V5 Creative Director & Workbench Operator.

## Core Capabilities & Principles
1. **Real-Time Prompt Detection & Surgical Editing**:
   - You always see the live `<workbench_state>` below.
   - When the user speaks in colloquial Chinese ("给她加点风吹发丝和夕阳逆光", "太暗了提亮一点", "去掉水印", "帮我看看提示词有什么问题"), translate directly into verified English Danbooru/V5 tags and call `patch_prompt_blocks` (prefer `mode="merge"` for incremental edits, `mode="replace"` for full block rewrites) or `remove_prompt_tags`.
   - Never output SD WebUI `(tag:1.2)` syntax, `BREAK`, or Chinese inside prompt tag fields. Respect V4.5/V5 `w::tag::` vs V3 `{{}}`/`[]`.
2. **Interactive Creative Director (When User Has No Ideas)**:
   - If the user says they have no ideas / feel lazy / want inspiration, read skill `creative-interview` (`read_skill("creative-interview")`), propose 3 vivid, contrasting concepts or ask 2 lightweight questions, and let them pick before filling everything.
3. **Direct Workbench, Vision Inspection, Artist Catalog & Gallery Management**:
   - You can control parameters (`set_workbench_params`), switch canvas modes (`set_workbench_mode` for `img2img`/`infill`/`outpaint`), load OC cards (`load_oc_character`), run Director post-processing (`run_director_tool`: `lineart`, `sketch`, `colorize`, `emotion`, `declutter`), and trigger generation (`trigger_generate_image`, only when asked to draw/generate now).
   - **Visual Inspection Tools**: When the user asks you to look at / critique / compare images, call `inspect_canvas_stage` (for the current central canvas) or `inspect_gallery_images` (for specific saved gallery IDs) or `inspect_artist_previews` (for artist preview cards) so you inspect the actual pixels rather than guessing!
   - You can also manage the user's **Artist Catalog** (`manage_artist_catalog`, `manage_mix_presets`) and **Artwork Gallery** (`manage_gallery_items`: favorite/unfavorite, add searchable notes, load past artworks to workbench, sync disk folder, or delete explicitly requested item IDs).
   - **Batch Artist Import & Research Discipline**: When the user gives you multiple artist tags (2–100+), ALWAYS use `manage_artist_catalog(action="batch_add", artists=[...], generate_preview=true, model="nai-diffusion-4-5-full")` in ONE single tool call instead of calling `add` one by one! Use `lookup_danbooru_artists(tags=[...])` (up to 12 tags per call) to gather real Danbooru post counts, Pixiv/X URLs, wiki info & top visual tags, use `inspect_artist_previews(artist_ids=[...])` to visually inspect generated preview cards, and use `manage_artist_catalog(action="batch_update", updates=[...])` to bulk-apply categories, descriptions & style tags cleanly. Keep reasoning concise on large lists so you never exhaust output tokens.
   - Never claim you changed the workbench or ran a tool unless you actually called the tool!
4. **Progressive Skill Disclosure**:
   - Available skills are listed in `<available_skills>`. When a task clearly fits one, call `read_skill(name)` to load its full playbook before acting.
5. **Concise, Helpful Chinese Replies + Quick Replies**:
   - Keep replies crisp, structured, and natural in Chinese (1–4 short paragraphs or bullets).
   - Optionally end your message with a single line `[QUICK_REPLIES: 简短选项1 | 简短选项2 | 简短选项3]` (2–3 clickable follow-up suggestions) whenever helpful for the next step (e.g. offering options during brainstorming, or suggesting "直接生成图片 | 调整画师风格 | 换成夜景光影").

<available_skills>
{skills_index}
</available_skills>

<active_skills>
{active_skills_block}
</active_skills>

<workbench_state>
{json.dumps(wb_compact, ensure_ascii=False)}
</workbench_state>"""


def _execute_studio_tool(
    name: str,
    args: Dict[str, Any],
    workbench_state: Dict[str, Any],
    live_blocks: Dict[str, str],
) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    """Executes a studio tool and returns (tool_json_for_llm, human_trace_summary, optional_ui_action)."""
    model_id = str(workbench_state.get("model") or "nai-diffusion-5-full")

    if name == "read_skill":
        sname = str(args.get("name") or "").strip()
        sk = get_skill(sname)
        if not sk:
            return json.dumps({"error": f"Skill '{sname}' not found"}, ensure_ascii=False), f"未找到技能 {sname}", None
        return json.dumps(sk, ensure_ascii=False), f"加载技能「{sk['title']}」", None

    if name == "search_artist_catalog":
        q = str(args.get("query") or "").strip()
        cat = str(args.get("category") or "").strip()
        fav = bool(args.get("favorite_only", False))
        artists = list_artists(search=q, category=cat, favorite_only=fav)
        if not artists and q:
            artists = list_artists(favorite_only=True) or list_artists()
        trimmed = [
            {
                "id": a["id"],
                "name": a["name"],
                "tag": a["tag"],
                "category": a["category"],
                "favorite": a["favorite"],
                "has_preview": bool(a.get("preview_url")),
                "desc": a["desc"],
            }
            for a in artists[:200]
        ]
        missing_prev = sum(1 for a in artists if not a.get("preview_url"))
        return (
            json.dumps(
                {"total_matched": len(artists), "missing_preview_count": missing_prev, "artists": trimmed},
                ensure_ascii=False,
            ),
            f"检索画师库({q or cat or '全部'}) -> {len(trimmed)}/{len(artists)} 位",
            None,
        )

    if name == "search_danbooru_tags":
        q = str(args.get("query") or "").strip()
        hits = search_builtin_tags(q, limit=12)
        if not hits and q:
            seen = set()
            for part in re.split(r"[\s,，、/]+", q):
                if not part.strip():
                    continue
                for item in search_builtin_tags(part.strip(), limit=6):
                    if item["tag"] not in seen:
                        seen.add(item["tag"])
                        hits.append(item)
            hits = hits[:12]
        return json.dumps({"tags": hits}, ensure_ascii=False), f"检索标签词典({q}) -> {len(hits)} 条", None

    if name == "list_oc_and_snippets":
        q = str(args.get("query") or "").strip().lower()
        ocs = list_oc_cards()
        snips = list_snippets()
        if q:
            ocs = [o for o in ocs if q in (o["name"] + " " + o["prompt"]).lower()] or ocs[:4]
            snips = [s for s in snips if q in (s["label"] + " " + s["tags"]).lower()] or snips[:6]
        return (
            json.dumps(
                {
                    "oc_cards": [{"id": o["id"], "name": o["name"], "prompt": o["prompt"], "uc": o["uc"]} for o in ocs[:6]],
                    "snippets": [{"label": s["label"], "tags": s["tags"]} for s in snips[:8]],
                },
                ensure_ascii=False,
            ),
            f"读取 OC({len(ocs[:6])}) 与词条({len(snips[:8])})",
            None,
        )

    if name == "query_gallery":
        search = str(args.get("search") or "")
        fav = bool(args.get("favorite_only", False))
        lim = max(1, min(50, int(args.get("limit") or 12)))
        rows = list_gallery(limit=lim, offset=0, search=search, favorite_only=fav)
        compact = [
            {
                "id": r["id"],
                "model_short": r["model_short"],
                "seed": r["seed"],
                "notes": r["notes"],
                "prompt": r["prompt"][:220],
                "favorite": r["favorite"],
            }
            for r in rows
        ]
        total_matched = count_gallery(search=search, favorite_only=fav)
        return json.dumps({"total_matched": total_matched, "items": compact}, ensure_ascii=False), f"查询图库记录 -> {len(compact)}/{total_matched} 张", None

    if name == "get_current_model_rules":
        mid = str(args.get("model_id") or model_id)
        spec = get_model_spec(mid)
        payload = {
            "id": spec["id"],
            "name": spec["name"],
            "supports_numeric_weight": spec["supports_numeric_weight"],
            "supports_alpha_transparency": spec.get("supports_alpha_transparency", False),
            "quality_tags": spec["quality_tags"],
            "default_scale": spec["default_scale"],
            "heavy_uc": (spec.get("uc_presets") or {}).get("heavy", {}).get("tags", ""),
        }
        return json.dumps(payload, ensure_ascii=False), f"读取模型规范({spec['short_name']})", None

    if name == "validate_and_lint_prompt":
        prompt_str = str(args.get("prompt") or "")
        mid = str(args.get("model_id") or model_id)
        res = lint_prompt(prompt_str, mid)
        is_clean = res["issue_count"] == 0
        summary = f"语法体检 -> {'通过' if is_clean else str(res['issue_count']) + ' 处问题'}"
        return (
            json.dumps({"is_clean": is_clean, "issues": res["issues"][:6], "fixed_prompt": res["fixed_prompt"]}, ensure_ascii=False),
            summary,
            None,
        )

    if name == "patch_prompt_blocks":
        mode = "replace" if str(args.get("mode") or "merge") == "replace" else "merge"
        reason = str(args.get("reason") or "更新提示词区块").strip()
        changed_blocks: Dict[str, str] = {}
        all_added: List[str] = []
        all_removed: List[str] = []
        block_labels = {"artist": "画师串", "character": "人物", "lighting": "光影", "negative": "负面"}
        touched_names: List[str] = []

        for key in ("artist", "character", "lighting", "negative"):
            if key in args and args[key] is not None:
                merged, added, removed = _merge_tag_strings(live_blocks.get(key, ""), str(args[key]), mode=mode)
                live_blocks[key] = merged
                changed_blocks[key] = merged
                all_added.extend(added)
                all_removed.extend(removed)
                touched_names.append(block_labels[key])

        if not changed_blocks:
            return json.dumps({"ok": False, "error": "No block fields provided"}, ensure_ascii=False), "未指定修改区块", None

        combined_pos = ", ".join(p for p in (live_blocks.get("artist", ""), live_blocks.get("character", ""), live_blocks.get("lighting", "")) if p)
        lint_res = lint_prompt(combined_pos, model_id)
        summary = f"实时写入「{'/'.join(touched_names)}」(+{len(all_added)}" + (f" / -{len(all_removed)}" if all_removed else "") + ")"
        ui_action = {
            "type": "patch_prompt_blocks",
            "summary": reason or summary,
            "payload": {
                "blocks": changed_blocks,
                "mode": mode,
                "added": all_added[:12],
                "removed": all_removed[:12],
                "reason": reason,
            },
        }
        return (
            json.dumps(
                {
                    "ok": True,
                    "updated_blocks": changed_blocks,
                    "added": all_added,
                    "removed": all_removed,
                    "lint_issue_count": lint_res["issue_count"],
                    "lint_issues": lint_res["issues"][:4],
                },
                ensure_ascii=False,
            ),
            summary,
            ui_action,
        )

    if name == "remove_prompt_tags":
        raw_tags = args.get("tags") if isinstance(args.get("tags"), list) else []
        side = "uc" if str(args.get("side") or "pos") == "uc" else "pos"
        reason = str(args.get("reason") or "移除指定标签").strip()
        rm_keys = {_normalize_tag_key(str(t)) for t in raw_tags if str(t).strip()}
        removed_actual: List[str] = []
        changed_blocks: Dict[str, str] = {}
        target_keys = ("negative",) if side == "uc" else ("artist", "character", "lighting")
        for bk in target_keys:
            cur_list = _split_tags(live_blocks.get(bk, ""))
            kept = []
            for seg in cur_list:
                if _normalize_tag_key(seg) in rm_keys:
                    removed_actual.append(seg)
                else:
                    kept.append(seg)
            if len(kept) != len(cur_list):
                live_blocks[bk] = ", ".join(kept)
                changed_blocks[bk] = live_blocks[bk]
        summary = f"移除 {len(removed_actual)} 个标签" if removed_actual else "未匹配到可移除标签"
        ui_action = (
            {
                "type": "patch_prompt_blocks",
                "summary": reason or summary,
                "payload": {"blocks": changed_blocks, "mode": "replace", "added": [], "removed": removed_actual, "reason": reason},
            }
            if changed_blocks
            else None
        )
        return json.dumps({"ok": True, "removed": removed_actual, "updated_blocks": changed_blocks}, ensure_ascii=False), summary, ui_action

    if name == "set_workbench_params":
        allowed = (
            "model", "width", "height", "steps", "scale", "cfg_rescale",
            "sampler", "scheduler", "seed", "variety_plus",
            "alpha_transparency", "auto_quality", "batch_count",
        )
        clean_params = {k: args[k] for k in allowed if k in args and args[k] is not None}
        if not clean_params:
            return json.dumps({"ok": False, "error": "No valid params provided"}, ensure_ascii=False), "无有效参数", None
        # Update local shadow model if switched
        if "model" in clean_params:
            workbench_state["model"] = clean_params["model"]
        desc = ", ".join(f"{k}={v}" for k, v in clean_params.items())
        reason = str(args.get("reason") or f"调整工作台参数: {desc}")
        ui_action = {"type": "set_workbench_params", "summary": reason, "payload": clean_params}
        return json.dumps({"ok": True, "applied": clean_params}, ensure_ascii=False), f"调整参数({desc[:48]})", ui_action

    if name == "set_workbench_mode":
        act = str(args.get("action") or "generate")
        payload: Dict[str, Any] = {"action": act}
        if args.get("i2i_strength") is not None:
            payload["i2i_strength"] = max(0.1, min(0.99, float(args["i2i_strength"])))
        if args.get("outpaint_direction"):
            payload["outpaint_direction"] = str(args["outpaint_direction"])
        mode_cn = {"generate": "文生图", "img2img": "图生图", "infill": "局部重绘", "outpaint": "扩图"}.get(act, act)
        summary = f"切换画布模式 -> {mode_cn}"
        ui_action = {"type": "set_workbench_mode", "summary": str(args.get("reason") or summary), "payload": payload}
        return json.dumps({"ok": True, **payload}, ensure_ascii=False), summary, ui_action

    if name == "load_oc_character":
        key = str(args.get("name_or_id") or "").strip()
        ocs = list_oc_cards()
        match = None
        for o in ocs:
            if str(o["id"]) == key or key.lower() in o["name"].lower():
                match = o
                break
        if not match:
            return json.dumps({"ok": False, "error": f"未找到 OC 角色 '{key}'"}, ensure_ascii=False), f"未找到 OC({key})", None
        apply_char = bool(args.get("apply_to_character_block", True))
        if apply_char:
            merged, _, _ = _merge_tag_strings(live_blocks.get("character", ""), match["prompt"], mode="replace")
            live_blocks["character"] = merged
        ui_action = {
            "type": "load_oc_character",
            "summary": f"载入 OC 角色「{match['name']}」",
            "payload": {"card": match, "apply_to_character_block": apply_char},
        }
        return json.dumps({"ok": True, "card": match}, ensure_ascii=False), f"载入 OC「{match['name']}」", ui_action

    if name == "run_director_tool":
        req_type = str(args.get("req_type") or "lineart")
        if not workbench_state.get("stage_has_image"):
            return (
                json.dumps({"ok": False, "error": "当前中央画布暂无图片，无法执行 Director 处理。请先生成或载入一张图片。"}, ensure_ascii=False),
                "画布为空，跳过 Director",
                None,
            )
        payload = {
            "req_type": req_type,
            "emotion": str(args.get("emotion") or "happy"),
            "defry": max(0, min(5, int(args.get("defry") or 0))),
            "prompt": str(args.get("prompt") or ""),
        }
        type_cn = {"lineart": "提取线稿", "sketch": "转草图", "colorize": "智能上色", "emotion": f"表情微调({payload['emotion']})", "declutter": "去杂物"}.get(req_type, req_type)
        summary = f"执行 Director · {type_cn}"
        ui_action = {"type": "run_director_tool", "summary": summary, "payload": payload}
        return json.dumps({"ok": True, "dispatched": payload}, ensure_ascii=False), summary, ui_action

    if name == "trigger_generate_image":
        reason = str(args.get("reason") or "触发工作台出图")
        ui_action = {"type": "trigger_generate_image", "summary": reason, "payload": {"reason": reason}}
        return json.dumps({"ok": True, "dispatched": True}, ensure_ascii=False), "触发工作台出图", ui_action

    if name == "manage_artist_catalog":
        act = str(args.get("action") or "").strip().lower()
        target_model = str(args.get("model") or "nai-diffusion-4-5-full").strip()
        if act == "add":
            tag = str(args.get("tag") or "").strip()
            if not tag:
                return json.dumps({"ok": False, "error": "缺少画师 Tag"}, ensure_ascii=False), "新增画师缺少 Tag", None
            art = upsert_artist(
                name=str(args.get("name") or ""),
                tag=tag,
                category=str(args.get("category") or "私人收藏"),
                desc=str(args.get("desc") or ""),
                sample_tags=str(args.get("sample_tags") or ""),
                is_custom=True,
            )
            gen_prev = bool(args.get("generate_preview", False))
            ui_action = {
                "type": "refresh_artists",
                "summary": f"新增画师「{art['name']}」({art['tag']})" + (f" 并触发预览图生成 ({target_model})" if gen_prev else ""),
                "payload": {
                    "artist": art,
                    "generate_preview_artist_id": art["id"] if gen_prev else None,
                    "model": target_model,
                },
            }
            return json.dumps({"ok": True, "artist": art, "preview_queued": gen_prev}, ensure_ascii=False), f"新增画师「{art['name']}」", ui_action

        if act == "batch_add":
            raw_list = args.get("artists") if isinstance(args.get("artists"), list) else []
            if not raw_list:
                return json.dumps({"ok": False, "error": "batch_add 需要非空的 artists 列表"}, ensure_ascii=False), "批量录入列表为空", None
            saved: List[Dict[str, Any]] = []
            for entry in raw_list[:100]:
                if isinstance(entry, str):
                    entry = {"tag": entry}
                if not isinstance(entry, dict):
                    continue
                raw_tag = str(entry.get("tag") or "").strip()
                if not raw_tag:
                    continue
                norm_tag = re.sub(r"\s+", "_", raw_tag)
                if not norm_tag.lower().startswith("artist:"):
                    norm_tag = f"artist:{norm_tag}"
                disp_name = str(entry.get("name") or "").strip() or raw_tag.replace("artist:", "").replace("_", " ").strip()
                art = upsert_artist(
                    name=disp_name,
                    tag=norm_tag,
                    category=str(entry.get("category") or args.get("category") or "私人收藏"),
                    desc=str(entry.get("desc") or ""),
                    sample_tags=str(entry.get("sample_tags") or ""),
                    is_custom=True,
                )
                saved.append({"id": art["id"], "name": art["name"], "tag": art["tag"], "has_preview": bool(art.get("preview_url"))})
            gen_prev = bool(args.get("generate_preview", False))
            ui_action = {
                "type": "refresh_artists",
                "summary": f"批量录入 {len(saved)} 位画师" + (f" 并启动 {target_model} 预览图队列" if gen_prev else ""),
                "payload": {"batch_count": len(saved), "backfill_missing": gen_prev, "model": target_model},
            }
            return (
                json.dumps({"ok": True, "added_count": len(saved), "artists": saved, "preview_queued": gen_prev, "model": target_model}, ensure_ascii=False),
                f"批量录入 {len(saved)} 位画师",
                ui_action,
            )

        if act == "batch_update":
            updates = args.get("updates") if isinstance(args.get("updates"), list) else []
            if not updates:
                return json.dumps({"ok": False, "error": "batch_update 需要非空的 updates 列表"}, ensure_ascii=False), "批量更新列表为空", None
            all_by_tag = {a["tag"].lower(): a["id"] for a in list_artists()}
            updated_ids: List[int] = []
            for u in updates[:100]:
                if not isinstance(u, dict):
                    continue
                aid = u.get("artist_id")
                if not aid and u.get("tag"):
                    t = re.sub(r"\s+", "_", str(u["tag"]).strip()).lower()
                    if not t.startswith("artist:"):
                        t = f"artist:{t}"
                    aid = all_by_tag.get(t)
                if not aid:
                    continue
                new_tag = None
                if u.get("artist_id") and u.get("tag"):
                    nt = re.sub(r"\s+", "_", str(u["tag"]).strip())
                    if nt and not nt.lower().startswith("artist:"):
                        nt = f"artist:{nt}"
                    new_tag = nt or None
                try:
                    art = update_artist(
                        int(aid),
                        name=u.get("name"),
                        tag=new_tag,
                        category=u.get("category"),
                        desc=u.get("desc"),
                        sample_tags=u.get("sample_tags"),
                    )
                    if art:
                        updated_ids.append(art["id"])
                except Exception:
                    continue
            ui_action = {
                "type": "refresh_artists",
                "summary": f"批量更新 {len(updated_ids)} 位画师的分类与风格标签",
                "payload": {"updated_ids": updated_ids},
            }
            return (
                json.dumps({"ok": True, "updated_count": len(updated_ids), "updated_ids": updated_ids}, ensure_ascii=False),
                f"批量更新 {len(updated_ids)} 位画师",
                ui_action,
            )

        if act == "update":
            aid = args.get("artist_id")
            if not aid:
                return json.dumps({"ok": False, "error": "缺少 artist_id"}, ensure_ascii=False), "缺少画师 ID", None
            try:
                art = update_artist(
                    int(aid),
                    name=args.get("name"),
                    tag=args.get("tag"),
                    category=args.get("category"),
                    desc=args.get("desc"),
                    sample_tags=args.get("sample_tags"),
                )
            except Exception as exc:
                return json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), "更新画师冲突", None
            if not art:
                return json.dumps({"ok": False, "error": "画师不存在"}, ensure_ascii=False), "画师不存在", None
            ui_action = {"type": "refresh_artists", "summary": f"更新画师「{art['name']}」信息", "payload": {"artist": art}}
            return json.dumps({"ok": True, "artist": art}, ensure_ascii=False), f"更新画师「{art['name']}」", ui_action

        if act == "favorite":
            aid = args.get("artist_id")
            if not aid and args.get("name"):
                matches = list_artists(search=str(args.get("name")))
                aid = matches[0]["id"] if matches else None
            if not aid:
                return json.dumps({"ok": False, "error": "未找到目标画师"}, ensure_ascii=False), "未找到画师", None
            art = toggle_artist_favorite(int(aid))
            if not art:
                return json.dumps({"ok": False, "error": "画师不存在"}, ensure_ascii=False), "画师不存在", None
            lbl = "已收藏" if art["favorite"] else "已取消收藏"
            ui_action = {"type": "refresh_artists", "summary": f"{lbl}画师「{art['name']}」", "payload": {"artist": art}}
            return json.dumps({"ok": True, "artist": art}, ensure_ascii=False), f"{lbl}「{art['name']}」", ui_action

        if act == "delete":
            aid = args.get("artist_id")
            if not aid:
                return json.dumps({"ok": False, "error": "删除画师必须明确提供 artist_id"}, ensure_ascii=False), "缺少 artist_id", None
            ok = delete_artist(int(aid))
            if not ok:
                return json.dumps({"ok": False, "error": "画师不存在"}, ensure_ascii=False), "画师不存在", None
            ui_action = {"type": "refresh_artists", "summary": f"已从画师库删除 ID #{aid}", "payload": {"deleted_id": int(aid)}}
            return json.dumps({"ok": True, "deleted_id": int(aid)}, ensure_ascii=False), f"删除画师 #{aid}", ui_action

        if act == "generate_preview":
            aid = args.get("artist_id")
            if aid:
                ui_action = {
                    "type": "refresh_artists",
                    "summary": f"触发画师 #{int(aid)} 免费生成预览图 ({target_model})",
                    "payload": {"generate_preview_artist_id": int(aid), "model": target_model},
                }
                return json.dumps({"ok": True, "dispatched_artist_id": int(aid), "model": target_model}, ensure_ascii=False), f"生成画师 #{aid} 预览图", ui_action
            ui_action = {
                "type": "refresh_artists",
                "summary": f"启动后台队列补齐所有缺失画师预览图 ({target_model})",
                "payload": {"backfill_missing": True, "model": target_model},
            }
            return json.dumps({"ok": True, "dispatched_backfill": True, "model": target_model}, ensure_ascii=False), "补齐缺失画师预览", ui_action

        return json.dumps({"ok": False, "error": f"不支持的 action: {act}"}, ensure_ascii=False), "无效画师库操作", None

    if name == "manage_mix_presets":
        act = str(args.get("action") or "list").strip().lower()
        if act == "list":
            presets = list_mix_presets()
            return json.dumps({"ok": True, "presets": presets[:15]}, ensure_ascii=False), f"列出 {len(presets)} 套混搭方案", None
        if act == "save":
            pname = str(args.get("name") or "").strip()
            items = args.get("items") if isinstance(args.get("items"), list) else []
            if not pname or not items:
                return json.dumps({"ok": False, "error": "保存混搭方案需要 name 和 items"}, ensure_ascii=False), "参数不足", None
            preset = add_mix_preset(pname, items)
            ui_action = {"type": "refresh_mix_presets", "summary": f"保存混搭方案「{preset['name']}」", "payload": {"preset": preset}}
            return json.dumps({"ok": True, "preset": preset}, ensure_ascii=False), f"保存方案「{preset['name']}」", ui_action
        if act == "apply":
            pid = args.get("preset_id")
            presets = list_mix_presets()
            match = next((p for p in presets if pid is not None and p["id"] == int(pid)), None)
            if not match and args.get("name"):
                q = str(args["name"]).lower()
                match = next((p for p in presets if q in p["name"].lower()), None)
            if not match:
                return json.dumps({"ok": False, "error": "未找到对应混搭方案"}, ensure_ascii=False), "未找到混搭方案", None
            formatted = ", ".join(
                f"{round(float(it.get('weight', 1.0)), 2)}::{it['tag']}::"
                if abs(float(it.get("weight", 1.0)) - 1.0) >= 0.03
                else str(it["tag"])
                for it in (match.get("items") or [])
                if it.get("tag")
            )
            live_blocks["artist"] = formatted
            ui_action = {
                "type": "patch_prompt_blocks",
                "summary": f"应用混搭方案「{match['name']}」到画师串",
                "payload": {"blocks": {"artist": formatted}, "mode": "replace", "added": [formatted], "removed": [], "reason": match["name"]},
            }
            return json.dumps({"ok": True, "applied": formatted}, ensure_ascii=False), f"应用方案「{match['name']}」", ui_action
        if act == "delete":
            pid = args.get("preset_id")
            if not pid:
                return json.dumps({"ok": False, "error": "缺少 preset_id"}, ensure_ascii=False), "缺少方案 ID", None
            ok = delete_mix_preset(int(pid))
            ui_action = {"type": "refresh_mix_presets", "summary": f"删除混搭方案 #{pid}", "payload": {"deleted_id": int(pid)}}
            return json.dumps({"ok": ok}, ensure_ascii=False), f"删除方案 #{pid}", ui_action
        return json.dumps({"ok": False, "error": f"未知操作 {act}"}, ensure_ascii=False), "无效方案操作", None

    if name == "manage_gallery_items":
        act = str(args.get("action") or "").strip().lower()
        raw_ids = args.get("ids") if isinstance(args.get("ids"), list) else []
        if args.get("item_id") is not None and int(args["item_id"]) not in raw_ids:
            raw_ids = [int(args["item_id"]), *raw_ids]
        clean_ids = [int(x) for x in raw_ids if str(x).isdigit()]

        if act in ("favorite", "unfavorite"):
            if not clean_ids:
                return json.dumps({"ok": False, "error": "请提供至少一个作品 ID"}, ensure_ascii=False), "缺少作品 ID", None
            fav_flag = act == "favorite"
            cnt = batch_favorite_gallery(clean_ids, favorite=fav_flag)
            lbl = "收藏" if fav_flag else "取消收藏"
            ui_action = {"type": "refresh_gallery", "summary": f"图库批量{lbl} {cnt} 张作品", "payload": {"ids": clean_ids, "favorite": fav_flag}}
            return json.dumps({"ok": True, "updated": cnt}, ensure_ascii=False), f"图库{lbl} {cnt} 张", ui_action

        if act == "set_notes":
            if not clean_ids:
                return json.dumps({"ok": False, "error": "请提供目标作品 item_id"}, ensure_ascii=False), "缺少作品 ID", None
            notes = str(args.get("notes") or "").strip()
            item = update_gallery_notes(clean_ids[0], notes)
            if not item:
                return json.dumps({"ok": False, "error": "作品不存在"}, ensure_ascii=False), "作品不存在", None
            ui_action = {"type": "refresh_gallery", "summary": f"为作品 #{clean_ids[0]} 设置备注「{notes}」", "payload": {"item": item}}
            return json.dumps({"ok": True, "item": {"id": item["id"], "notes": item["notes"]}}, ensure_ascii=False), f"更新 #{clean_ids[0]} 备注", ui_action

        if act == "load_to_workbench":
            if not clean_ids:
                return json.dumps({"ok": False, "error": "请提供目标作品 item_id"}, ensure_ascii=False), "缺少作品 ID", None
            item = get_gallery_item(clean_ids[0])
            if not item:
                return json.dumps({"ok": False, "error": "作品不存在"}, ensure_ascii=False), "作品不存在", None
            ui_action = {"type": "load_gallery_item", "summary": f"载入图库作品 #{item['id']} (Seed #{item['seed']}) 到工作台", "payload": {"item": item}}
            return json.dumps({"ok": True, "loaded_id": item["id"], "seed": item["seed"]}, ensure_ascii=False), f"载入作品 #{item['id']}", ui_action

        if act == "sync_folder":
            res = sync_outputs_folder(OUTPUTS_DIR, prune_missing=True)
            summary = f"同步磁盘：新收录 {res['imported']} 张，清理失效 {res['pruned_missing']} 条"
            ui_action = {"type": "refresh_gallery", "summary": summary, "payload": res}
            return json.dumps({"ok": True, **res}, ensure_ascii=False), summary, ui_action

        if act == "delete":
            if not clean_ids:
                return json.dumps({"ok": False, "error": "安全保护：删除图库作品必须指定明确 ids"}, ensure_ascii=False), "拒绝空 ID 删除", None
            removed = batch_delete_gallery(ids=clean_ids, delete_file=True)
            ui_action = {"type": "refresh_gallery", "summary": f"已删除 {removed} 张指定作品及原图", "payload": {"deleted_ids": clean_ids}}
            return json.dumps({"ok": True, "removed": removed}, ensure_ascii=False), f"删除 {removed} 张作品", ui_action

        return json.dumps({"ok": False, "error": f"不支持的图库操作: {act}"}, ensure_ascii=False), "无效图库操作", None

    return json.dumps({"error": f"Unknown tool {name}"}, ensure_ascii=False), f"未知工具({name})", None


_DANBOORU_GENERIC_IGNORE = {
    "1girl", "solo", "highres", "absurdres", "commentary_request", "looking_at_viewer",
    "long_hair", "short_hair", "blush", "smile", "open_mouth", "upper_body", "full_body",
    "simple_background", "white_background", "multiple_girls", "1boy", "2girls", "translated",
    "translation_request", "bad_id", "bad_pixiv_id", "check_artist", "artist_name", "signature",
    "dated", "watermark", "web_address", "patreon_username", "twitter_username",
    "breasts", "small_breasts", "medium_breasts", "large_breasts", "ass", "cleavage",
    "blue_eyes", "red_eyes", "green_eyes", "yellow_eyes", "brown_eyes", "purple_eyes",
    "black_hair", "white_hair", "blonde_hair", "brown_hair", "silver_hair", "blue_hair", "pink_hair",
    "blunt_bangs", "bangs", "ahoge", "thighhighs", "bare_shoulders", "navel", "parted_lips",
}


async def _lookup_one_danbooru_artist(client: httpx.AsyncClient, raw_tag: str, sem: asyncio.Semaphore) -> Dict[str, Any]:
    clean = re.sub(r"^artist:", "", str(raw_tag or "").strip(), flags=re.I).strip()
    slug = re.sub(r"\s+", "_", clean).lower()
    if not slug:
        return {"query": raw_tag, "found": False}
    async with sem:
        info: Dict[str, Any] = {
            "query": raw_tag,
            "canonical_tag": f"artist:{slug}",
            "found": False,
            "post_count": 0,
            "other_names": [],
            "urls": [],
            "wiki_excerpt": "",
            "top_visual_tags": [],
        }
        try:
            r_tag, r_art, r_wiki = await asyncio.gather(
                client.get("https://danbooru.donmai.us/tags.json", params={"search[name]": slug, "limit": 1}),
                client.get("https://danbooru.donmai.us/artists.json", params={"search[name]": slug, "limit": 1}),
                client.get("https://danbooru.donmai.us/wiki_pages.json", params={"search[title]": slug, "limit": 1}),
                return_exceptions=True,
            )
            danbooru_artist_id = None
            if isinstance(r_tag, httpx.Response) and r_tag.status_code == 200:
                arr = r_tag.json()
                if isinstance(arr, list) and arr:
                    info["found"] = True
                    info["post_count"] = int(arr[0].get("post_count") or 0)
                    info["canonical_tag"] = f"artist:{arr[0].get('name') or slug}"
            if isinstance(r_art, httpx.Response) and r_art.status_code == 200:
                arr = r_art.json()
                if isinstance(arr, list) and arr:
                    a0 = arr[0]
                    info["found"] = True
                    danbooru_artist_id = a0.get("id")
                    info["other_names"] = list(a0.get("other_names") or [])[:5]
            if isinstance(r_wiki, httpx.Response) and r_wiki.status_code == 200:
                arr = r_wiki.json()
                if isinstance(arr, list) and arr:
                    body = str(arr[0].get("body") or "")
                    body = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", body)
                    body = re.sub(r"https?://\S+", "", body)
                    body = re.sub(r"\s+", " ", body).strip()
                    info["wiki_excerpt"] = body[:220]
            follow_tasks = []
            if danbooru_artist_id:
                follow_tasks.append(
                    client.get(
                        "https://danbooru.donmai.us/artist_urls.json",
                        params={"search[artist_id]": danbooru_artist_id, "search[is_active]": "true", "limit": 12},
                    )
                )
            else:
                follow_tasks.append(asyncio.sleep(0))
            if info["found"]:
                follow_tasks.append(
                    client.get(
                        "https://danbooru.donmai.us/posts.json",
                        params={"tags": f"{slug} order:score", "limit": 6, "only": "tag_string_general"},
                    )
                )
            else:
                follow_tasks.append(asyncio.sleep(0))
            r_urls, r_posts = await asyncio.gather(*follow_tasks, return_exceptions=True)
            if isinstance(r_urls, httpx.Response) and r_urls.status_code == 200:
                uarr = r_urls.json()
                if isinstance(uarr, list):
                    raw_urls = [u.get("url", "") for u in uarr if isinstance(u, dict) and u.get("url")]
                    prioritized = [u for u in raw_urls if any(d in u.lower() for d in ("pixiv", "twitter", "x.com", "fanbox", "artstation"))]
                    info["urls"] = (prioritized or raw_urls)[:4]
            if isinstance(r_posts, httpx.Response) and r_posts.status_code == 200:
                posts = r_posts.json()
                if isinstance(posts, list) and posts:
                    freq: Dict[str, int] = {}
                    for p in posts:
                        for t in str(p.get("tag_string_general") or "").split():
                            if t and t not in _DANBOORU_GENERIC_IGNORE:
                                freq[t] = freq.get(t, 0) + 1
                    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
                    info["top_visual_tags"] = [k.replace("_", " ") for k, _ in ranked[:10]]
        except Exception as exc:
            info["error"] = str(exc)[:120]
        return info


async def _lookup_danbooru_artists_async(tags: List[str]) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    clean_tags = [str(t).strip() for t in (tags or []) if str(t).strip()][:20]
    if not clean_tags:
        return json.dumps({"ok": False, "error": "请提供至少一个画师 Tag"}, ensure_ascii=False), "缺少画师 Tag", None
    sem = asyncio.Semaphore(3)
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": "NAI-Studio-Agent/3.0"},
            follow_redirects=True,
        ) as dclient:
            results = await asyncio.gather(*[_lookup_one_danbooru_artist(dclient, t, sem) for t in clean_tags])
        found_cnt = sum(1 for r in results if r.get("found"))
        return (
            json.dumps({"ok": True, "queried": len(clean_tags), "found": found_cnt, "artists": results}, ensure_ascii=False),
            f"Danbooru 画师情报({found_cnt}/{len(clean_tags)} 命中)",
            None,
        )
    except Exception as exc:
        return (
            json.dumps({"ok": False, "error": f"Danbooru 查询失败: {exc}"}, ensure_ascii=False),
            "Danbooru 网络不可达",
            None,
        )


def _encode_pil_to_jpeg_data_url(im: Image.Image, max_dim: int = 512) -> str:
    rgb = im.convert("RGB")
    rgb.thumbnail((max_dim, max_dim))
    buf = BytesIO()
    rgb.save(buf, format="JPEG", quality=82)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _encode_file_to_data_url(fpath: Path, max_dim: int = 512) -> Optional[str]:
    if not fpath.is_file():
        return None
    try:
        with Image.open(fpath) as im:
            return _encode_pil_to_jpeg_data_url(im, max_dim=max_dim)
    except Exception:
        return None


def _encode_b64_to_data_url(raw_b64: str, max_dim: int = 512) -> Optional[str]:
    s = str(raw_b64 or "").strip()
    if not s:
        return None
    if "," in s and s.lower().startswith("data:image/"):
        s = s.split(",", 1)[1]
    try:
        raw_bytes = base64.b64decode(s)
        with Image.open(BytesIO(raw_bytes)) as im:
            return _encode_pil_to_jpeg_data_url(im, max_dim=max_dim)
    except Exception:
        return None


async def _run_vision_inspection(
    content_parts: List[Dict[str, Any]],
    llm_client: httpx.AsyncClient,
    endpoint: str,
    headers: Dict[str, str],
    llm_model: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Shared multimodal chat call returning (analysis_text, error_msg)."""
    try:
        r = await llm_client.post(
            endpoint,
            headers=headers,
            json={
                "model": llm_model,
                "messages": [{"role": "user", "content": content_parts}],
                "temperature": 0.3,
                "max_tokens": 16384,
            },
            timeout=90.0,
        )
        if r.status_code != 200:
            return None, f"视觉分析请求失败 (HTTP {r.status_code}): {r.text[:180]}"
        msg = (r.json().get("choices") or [{}])[0].get("message") or {}
        analysis = str(msg.get("content") or "").strip()
        return analysis, None
    except Exception as exc:
        return None, f"视觉分析异常: {exc}"


async def _inspect_artist_previews_async(
    artist_ids: List[int],
    llm_client: httpx.AsyncClient,
    endpoint: str,
    headers: Dict[str, str],
    llm_model: str,
) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    clean_ids = [int(x) for x in (artist_ids or []) if str(x).isdigit()][:6]
    if not clean_ids:
        return json.dumps({"ok": False, "error": "请提供 1~6 个已有预览图的 artist_id"}, ensure_ascii=False), "缺少画师 ID", None

    by_id = {a["id"]: a for a in list_artists()}
    content_parts: List[Dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "请逐一分析以下 NovelAI 画师预览图的视觉画风（笔触质感、色彩饱和度、光影特点、题材倾向），"
                "并为每位画师输出紧凑 JSON 数组，每项包含：artist_id, category（从 厚涂光影 / 清透水彩 / 幻彩插画 / 日系轻小说 / 赛博冷调 / 写实复古 / 萌系赛璐璐 中择一）, "
                "desc（25字以内中文风格点评）, sample_tags（4~6个英文画风特征标签，逗号分隔）。只输出 JSON。"
            ),
        }
    ]
    inspected: List[Dict[str, Any]] = []
    missing: List[int] = []
    for aid in clean_ids:
        a = by_id.get(aid)
        if not a or not a.get("preview_url"):
            missing.append(aid)
            continue
        fname = Path(str(a["preview_url"]).split("?")[0]).name
        data_url = _encode_file_to_data_url(ARTISTS_DIR / fname, max_dim=384)
        if not data_url:
            missing.append(aid)
            continue
        content_parts.append({"type": "text", "text": f"画师 artist_id={aid} | name={a['name']} | tag={a['tag']}"})
        content_parts.append({"type": "image_url", "image_url": {"url": data_url}})
        inspected.append({"artist_id": aid, "name": a["name"], "tag": a["tag"]})

    if not inspected:
        return (
            json.dumps(
                {
                    "ok": False,
                    "error": "指定画师尚未生成本地预览图，请先完成预览图生成队列后再进行视觉分析。",
                    "missing_ids": missing,
                },
                ensure_ascii=False,
            ),
            "尚无预览图可分析",
            None,
        )

    analysis, err = await _run_vision_inspection(content_parts, llm_client, endpoint, headers, llm_model)
    if err:
        return json.dumps({"ok": False, "error": err}, ensure_ascii=False), "视觉模型不支持或限流", None
    return (
        json.dumps({"ok": True, "inspected": inspected, "missing_ids": missing, "vision_analysis": analysis}, ensure_ascii=False),
        f"视觉分析 {len(inspected)} 张画师预览图",
        None,
    )


def _resolve_outputs_url(url_str: str) -> Optional[Path]:
    raw = str(url_str or "").split("?")[0].strip()
    if not raw.startswith("/outputs/"):
        return None
    rel = raw[len("/outputs/"):].lstrip("/")
    candidate = (OUTPUTS_DIR / rel).resolve()
    try:
        if not candidate.is_relative_to(OUTPUTS_DIR.resolve()):
            return None
    except Exception:
        return None
    return candidate if candidate.is_file() else None


async def _inspect_canvas_stage_async(
    focus: str,
    workbench_state: Dict[str, Any],
    llm_client: httpx.AsyncClient,
    endpoint: str,
    headers: Dict[str, str],
    llm_model: str,
) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    if not workbench_state.get("stage_has_image"):
        return json.dumps({"ok": False, "error": "当前中央画布暂无图片"}, ensure_ascii=False), "画布为空", None

    data_url = None
    stage_url = str(workbench_state.get("stage_image_url") or "")
    fpath = _resolve_outputs_url(stage_url)
    if fpath:
        data_url = _encode_file_to_data_url(fpath, max_dim=768)
    if not data_url and workbench_state.get("stage_image_b64"):
        data_url = _encode_b64_to_data_url(str(workbench_state.get("stage_image_b64") or ""), max_dim=768)
    if not data_url:
        return (
            json.dumps({"ok": False, "error": "未能读取当前画布图像（请确认图像已载入画布或本地outputs文件存在）"}, ensure_ascii=False),
            "未读取到画布图像",
            None,
        )

    focus_txt = str(focus or "整体构图、光影层次、角色五官手部解剖、色彩偏差与可优化点").strip()
    prompt_txt = (
        f"请以专业 NovelAI 插画指导的视角审视这张当前工作台画布图像，重点关注：{focus_txt}。\n"
        "请指出：1) 画面优点与风格氛围；2) 具体的视觉问题（如手部/肢体畸形、构图空洞、过曝/偏灰、光影逻辑矛盾、背景杂物等）；"
        "3) 可直接落地的修正建议（适合改哪些正负面 Tag 或是否适合局部重绘/图生图/Director）。控制在 220 字以内。"
    )
    analysis, err = await _run_vision_inspection(
        [{"type": "text", "text": prompt_txt}, {"type": "image_url", "image_url": {"url": data_url}}],
        llm_client,
        endpoint,
        headers,
        llm_model,
    )
    if err:
        return json.dumps({"ok": False, "error": err}, ensure_ascii=False), "画布视觉分析失败", None
    return json.dumps({"ok": True, "vision_critique": analysis}, ensure_ascii=False), "视觉检视当前画布", None


async def _inspect_gallery_images_async(
    item_ids: List[int],
    question: str,
    llm_client: httpx.AsyncClient,
    endpoint: str,
    headers: Dict[str, str],
    llm_model: str,
) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    clean_ids = [int(x) for x in (item_ids or []) if str(x).isdigit()][:4]
    if not clean_ids:
        return json.dumps({"ok": False, "error": "请提供 1~4 个图库作品 item_id"}, ensure_ascii=False), "缺少作品 ID", None

    content_parts: List[Dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"请以专业 NovelAI 生图导师的视角对比/审阅以下图库作品。用户重点关注：{question or '画面质量、结构崩坏排查、光影对比与配方优劣'}。\n"
                "逐张给出简明点评与优胜结论，控制在 280 字以内。"
            ),
        }
    ]
    inspected: List[Dict[str, Any]] = []
    missing: List[int] = []
    for gid in clean_ids:
        item = get_gallery_item(gid)
        if not item:
            missing.append(gid)
            continue
        rel = str(item.get("rel_path") or item.get("filename") or "").lstrip("/")
        data_url = _encode_file_to_data_url(OUTPUTS_DIR / rel, max_dim=512)
        if not data_url:
            missing.append(gid)
            continue
        content_parts.append(
            {
                "type": "text",
                "text": f"作品 item_id={gid} | 模型={item.get('model_short')} | Seed={item.get('seed')} | Notes={item.get('notes') or '无'}",
            }
        )
        content_parts.append({"type": "image_url", "image_url": {"url": data_url}})
        inspected.append({"id": gid, "seed": item.get("seed"), "model_short": item.get("model_short")})

    if not inspected:
        return json.dumps({"ok": False, "error": "未找到可读的图库原图文件", "missing_ids": missing}, ensure_ascii=False), "未找到图库原图", None

    analysis, err = await _run_vision_inspection(content_parts, llm_client, endpoint, headers, llm_model)
    if err:
        return json.dumps({"ok": False, "error": err}, ensure_ascii=False), "图库视觉分析失败", None
    return (
        json.dumps({"ok": True, "inspected": inspected, "missing_ids": missing, "vision_analysis": analysis}, ensure_ascii=False),
        f"视觉审阅 {len(inspected)} 张图库作品",
        None,
    )


async def _execute_studio_tool_async(
    name: str,
    args: Dict[str, Any],
    workbench_state: Dict[str, Any],
    live_blocks: Dict[str, str],
    llm_client: httpx.AsyncClient,
    endpoint: str,
    headers: Dict[str, str],
    llm_model: str,
) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    if name == "lookup_danbooru_artists":
        return await _lookup_danbooru_artists_async(args.get("tags") or [])
    if name == "inspect_artist_previews":
        return await _inspect_artist_previews_async(args.get("artist_ids") or [], llm_client, endpoint, headers, llm_model)
    if name == "inspect_canvas_stage":
        return await _inspect_canvas_stage_async(str(args.get("focus") or ""), workbench_state, llm_client, endpoint, headers, llm_model)
    if name == "inspect_gallery_images":
        return await _inspect_gallery_images_async(args.get("item_ids") or [], str(args.get("question") or ""), llm_client, endpoint, headers, llm_model)
    return _execute_studio_tool(name, args, workbench_state, live_blocks)


def _estimate_tokens(text: str) -> int:
    """Fast bilingual token estimator (~1.35 chars/tok CJK, ~4 chars/tok ASCII)."""
    s = str(text or "")
    if not s:
        return 0
    cjk = sum(1 for ch in s if ord(ch) > 127)
    ascii_cnt = len(s) - cjk
    return max(1, int(cjk / 1.35 + ascii_cnt / 4.0) + 4)


def _build_history_within_budget(history_rows: List[Dict[str, Any]], budget_tokens: int) -> List[Dict[str, str]]:
    """Pack conversation history from newest backward up to budget_tokens (default 100K)."""
    picked: List[Dict[str, str]] = []
    used = 0
    for hist in reversed(history_rows or []):
        role = hist.get("role")
        content = str(hist.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        cost = _estimate_tokens(content)
        if picked and used + cost > budget_tokens:
            break
        picked.append({"role": role, "content": content})
        used += cost
    picked.reverse()
    return picked


async def stream_studio_agent(
    user_message: str,
    session_id: Optional[str] = None,
    workbench_state: Optional[Dict[str, Any]] = None,
    pinned_skills: Optional[List[str]] = None,
) -> AsyncIterator[str]:
    """Claude Code / Codex style multi-turn ReAct SSE stream with live tool execution & UI action dispatch."""

    def sse(event_type: str, payload: Dict[str, Any]) -> str:
        return f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n"

    cfg = load_config()
    base_url = _clean_base_url(cfg.get("llm_base_url") or "")
    api_key = str(cfg.get("llm_api_key") or "").strip()
    llm_model = str(cfg.get("llm_model") or "qwen4-max").strip()
    context_budget = max(8000, min(1000000, int(cfg.get("llm_context_tokens") or 100000)))
    max_out_tokens = max(2048, min(128000, int(cfg.get("llm_max_output_tokens") or 100000)))
    if not base_url or not api_key:
        yield sse("error", {"message": "尚未配置 LLM API Key 或 Base URL，请前往「设置与 Agent」填写并保存。"})
        return

    wb = dict(workbench_state or {})
    blocks_raw = wb.get("blocks") if isinstance(wb.get("blocks"), dict) else {}
    live_blocks: Dict[str, str] = {
        "artist": str(blocks_raw.get("artist") or ""),
        "character": str(blocks_raw.get("character") or ""),
        "lighting": str(blocks_raw.get("lighting") or ""),
        "negative": str(blocks_raw.get("negative") or ""),
    }
    wb["blocks"] = live_blocks

    # Ensure persistent session
    sess = get_agent_session(session_id) if session_id else None
    if not sess:
        auto_title = (user_message or "新创作对话").strip().splitlines()[0][:24]
        created = create_agent_session(title=auto_title, pinned_skills=pinned_skills or [])
        sid = created["id"]
        sess = get_agent_session(sid) or {**created, "messages": []}
    else:
        sid = sess["id"]
        if pinned_skills is not None:
            update_agent_session_meta(sid, pinned_skills=pinned_skills)
            sess["pinned_skills"] = pinned_skills
        if not sess.get("messages") and user_message.strip():
            auto_title = user_message.strip().splitlines()[0][:24]
            update_agent_session_meta(sid, title=auto_title)
            sess["title"] = auto_title

    yield sse("session", {"session_id": sid, "title": sess.get("title", "新创作对话")})

    active_pinned = pinned_skills if pinned_skills is not None else list(sess.get("pinned_skills") or [])
    slash_skills = _extract_slash_skills(user_message)

    # Persist user message
    append_agent_message(sid, "user", user_message)

    # Build OpenAI conversation messages dynamically within configured context budget (default 100K tokens)
    sys_prompt = _build_agent_system_prompt(wb, active_pinned, slash_skills)
    sys_and_user_cost = _estimate_tokens(sys_prompt) + _estimate_tokens(user_message) + 2500
    history_budget = max(4000, context_budget - sys_and_user_cost)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": sys_prompt}]
    messages.extend(_build_history_within_budget(sess.get("messages") or [], history_budget))
    messages.append({"role": "user", "content": user_message})

    client = _get_llm_client()
    endpoint = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "NAI-Studio-Agent/3.0",
    }

    tool_events: List[Dict[str, Any]] = []
    ui_actions: List[Dict[str, Any]] = []
    final_reply = ""
    empty_retries = 0
    last_finish_reason = ""
    active_max_out = max_out_tokens
    last_usage: Dict[str, Any] = {}
    stream_start_ts = time.perf_counter()

    yield sse("status", {"text": f"{llm_model} ({context_budget // 1000}K 上下文) 正在分析需求..."})

    async def _run_nonstream_round(body: Dict[str, Any]) -> Tuple[Dict[str, Any], str, List[Dict[str, Any]], str, Dict[str, Any]]:
        nonlocal active_max_out
        req = dict(body)
        req.pop("stream", None)
        req.pop("stream_options", None)
        r, active_max_out = await post_chat_with_max_tokens_fallback(
            client, endpoint, headers, req, timeout=180.0
        )
        if r.status_code == 400 and "tool" in r.text.lower():
            req.pop("tools", None)
            req.pop("tool_choice", None)
            r = await client.post(endpoint, headers=headers, json=req, timeout=180.0)
        if r.status_code != 200:
            raise ValueError(f"LLM 请求失败 (HTTP {r.status_code}): {r.text[:240]}")
        data = r.json()
        choice0 = (data.get("choices") or [{}])[0]
        msg = dict(choice0.get("message") or {})
        return (
            msg,
            str(msg.get("content") or "").strip(),
            list(msg.get("tool_calls") or []),
            str(choice0.get("finish_reason") or ""),
            dict(data.get("usage") or {}),
        )

    try:
        for round_idx in range(16):
            req_body: Dict[str, Any] = {
                "model": llm_model,
                "messages": messages,
                "tools": STUDIO_AGENT_TOOLS,
                "tool_choice": "auto" if round_idx < 14 else "none",
                "temperature": 0.45,
                "max_tokens": active_max_out,
                "stream": True,
                "stream_options": {"include_usage": True},
            }

            content_parts: List[str] = []
            reasoning_buf: List[str] = []
            last_reason_emit = time.perf_counter()
            tool_acc: Dict[int, Dict[str, Any]] = {}
            announced_tools: set[int] = set()
            finish_reason = ""
            round_usage: Dict[str, Any] = {}
            streamed_content_live = False
            fallback_nonstream = False

            async with client.stream("POST", endpoint, headers=headers, json=req_body, timeout=180.0) as resp:
                if resp.status_code == 400:
                    err_bytes = await resp.aread()
                    err_txt = err_bytes.decode("utf-8", errors="replace")
                    low_err = err_txt.lower()
                    if any(k in low_err for k in ("stream", "max_tokens", "range", "maximum", "limit", "tool")):
                        fallback_nonstream = True
                    else:
                        raise ValueError(f"LLM 请求失败 (HTTP {resp.status_code}): {err_txt[:240]}")
                elif resp.status_code != 200:
                    err_bytes = await resp.aread()
                    raise ValueError(f"LLM 请求失败 (HTTP {resp.status_code}): {err_bytes.decode('utf-8', errors='replace')[:240]}")
                else:
                    async for raw_line in resp.aiter_lines():
                        line = raw_line.strip()
                        if not line or not line.startswith("data:"):
                            continue
                        payload_str = line[5:].strip()
                        if payload_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload_str)
                        except Exception:
                            continue
                        if isinstance(chunk.get("usage"), dict) and chunk["usage"]:
                            round_usage = chunk["usage"]
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        c0 = choices[0]
                        if c0.get("finish_reason"):
                            finish_reason = str(c0["finish_reason"])
                        delta = c0.get("delta") or {}

                        r_piece = delta.get("reasoning_content")
                        if r_piece:
                            reasoning_buf.append(r_piece)
                            now = time.perf_counter()
                            if now - last_reason_emit >= 0.14 or sum(len(x) for x in reasoning_buf) >= 120:
                                yield sse("reasoning_delta", {"text": "".join(reasoning_buf)})
                                reasoning_buf.clear()
                                last_reason_emit = now

                        c_piece = delta.get("content")
                        if c_piece:
                            if reasoning_buf:
                                yield sse("reasoning_delta", {"text": "".join(reasoning_buf)})
                                reasoning_buf.clear()
                            if not content_parts and final_reply:
                                yield sse("delta", {"text": "\n\n"})
                            content_parts.append(c_piece)
                            streamed_content_live = True
                            yield sse("delta", {"text": c_piece})

                        for tc_delta in delta.get("tool_calls") or []:
                            idx = int(tc_delta.get("index") or 0)
                            slot = tool_acc.setdefault(idx, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                            if tc_delta.get("id"):
                                slot["id"] = str(tc_delta["id"])
                            fn_d = tc_delta.get("function") or {}
                            if fn_d.get("name"):
                                slot["function"]["name"] += str(fn_d["name"])
                                if idx not in announced_tools and slot["function"]["name"]:
                                    announced_tools.add(idx)
                                    yield sse("status", {"text": f"准备工具 {slot['function']['name']}..."})
                            if fn_d.get("arguments"):
                                slot["function"]["arguments"] += str(fn_d["arguments"])

                    if reasoning_buf:
                        yield sse("reasoning_delta", {"text": "".join(reasoning_buf)})
                        reasoning_buf.clear()

            if fallback_nonstream:
                msg, content_txt, tool_calls, last_finish_reason, round_usage = await _run_nonstream_round(req_body)
            else:
                last_finish_reason = finish_reason
                content_txt = "".join(content_parts).strip()
                tool_calls = [tool_acc[i] for i in sorted(tool_acc.keys())]
                msg = {"role": "assistant", "content": content_txt or None}
                if tool_calls:
                    msg["tool_calls"] = tool_calls

            if round_usage:
                last_usage = round_usage

            if not tool_calls:
                if not content_txt and empty_retries < 2:
                    empty_retries += 1
                    yield sse("status", {"text": "模型思考过长触发截断，正在精简重试..."})
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                "上一轮输出因推理过长被截断且正文为空。请立刻精简内部推理："
                                "如需处理多位画师请用 manage_artist_catalog(action='batch_add'/'batch_update') 一次批量完成，"
                                "或直接给出简洁清晰的中文答复。"
                            ),
                        }
                    )
                    continue
                if content_txt and not streamed_content_live:
                    clean_chunk, _ = _extract_quick_replies(content_txt)
                    if final_reply:
                        yield sse("delta", {"text": "\n\n"})
                    for i in range(0, len(clean_chunk), 24):
                        yield sse("delta", {"text": clean_chunk[i : i + 24]})
                messages.append({"role": "assistant", "content": content_txt})
                if content_txt:
                    final_reply = (final_reply + "\n\n" + content_txt).strip() if final_reply and final_reply != content_txt else content_txt
                break

            if content_txt:
                final_reply = (final_reply + "\n\n" + content_txt).strip() if final_reply else content_txt

            # Keep assistant message tool_calls strictly synchronized with executed tool_call_ids
            exec_calls = tool_calls[:10]
            messages.append({
                "role": "assistant",
                "content": content_txt or None,
                "tool_calls": exec_calls,
            })

            for tc in exec_calls:
                fn = tc.get("function") or {}
                tname = str(fn.get("name") or "")
                tc_id = str(tc.get("id") or f"call_{round_idx}_{tname}")
                try:
                    targs = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    targs = {}

                yield sse("tool_start", {"id": tc_id, "name": tname, "args": targs})
                t0 = time.perf_counter()
                out_json, summary, ui_action = await _execute_studio_tool_async(
                    tname, targs, wb, live_blocks, client, endpoint, headers, llm_model
                )
                duration_ms = int((time.perf_counter() - t0) * 1000)

                ev = {"id": tc_id, "name": tname, "summary": summary, "ok": '"error"' not in out_json, "duration_ms": duration_ms}
                tool_events.append(ev)
                yield sse("tool_result", ev)

                if ui_action:
                    ui_actions.append(ui_action)
                    yield sse("ui_action", {"action": ui_action})

                messages.append({"role": "tool", "tool_call_id": tc_id, "content": out_json})

            yield sse("status", {"text": f"{llm_model} 整合工具结果中..."})

        if not final_reply:
            if ui_actions:
                final_reply = "已执行以下工作台操作：\n" + "\n".join(f"- {a.get('summary') or a.get('type')}" for a in ui_actions)
            elif last_finish_reason == "length":
                final_reply = "⚠️ 本轮模型内部推理消耗了全部输出上限导致正文被截断，未执行实际修改。建议将大批量任务分批处理（例如每次 15~25 位画师）后重试。"
            else:
                final_reply = "⚠️ 模型未返回有效正文（未对工作台做出修改），请重试或稍微精简指令。"
            for i in range(0, len(final_reply), 24):
                yield sse("delta", {"text": final_reply[i : i + 24]})

        clean_reply, quick_replies = _extract_quick_replies(final_reply)
        elapsed_ms = int((time.perf_counter() - stream_start_ts) * 1000)

        append_agent_message(sid, "assistant", clean_reply, tool_events=tool_events, ui_actions=ui_actions)
        yield sse(
            "done",
            {
                "session_id": sid,
                "model": llm_model,
                "reply": clean_reply,
                "tool_events": tool_events,
                "ui_actions": ui_actions,
                "quick_replies": quick_replies,
                "usage": last_usage,
                "context_budget": context_budget,
                "elapsed_ms": elapsed_ms,
            },
        )
    except Exception as exc:
        yield sse("error", {"message": str(exc) or "Agent 执行异常"})
