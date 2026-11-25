import json
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from .config import load_config
from .database import list_artists, list_oc_cards, list_snippets
from .models_spec import get_model_spec
from .prompt_engine import lint_prompt, search_builtin_tags

_LLM_CLIENT: Optional[httpx.AsyncClient] = None

RECOMMENDED_MODEL_ORDER = [
    "qwen4-max",
    "qwen3.8-max",
    "qwen3.8-max-0902",
    "deepseek-v4-pro",
    "deepseek-v4-pro-0813",
    "kimi/kimi-k3.1-pro",
    "kimi-k3.1-pro",
    "qwen3.7-max",
    "glm-5.3-prime",
    "glm-5.3",
    "qwen3.8-flash",
    "deepseek-v4.1-flash",
]

NAI_SYSTEM_KNOWLEDGE = """You are NAI Studio's expert NovelAI Diffusion V4.5 / V5 Prompt Architect Agent.
You translate natural-language ideas (Chinese or English) into authentic, high-precision NovelAI prompts organized cleanly into 4 non-overlapping blocks:
1. "artist" (画师串):
   - ONLY artist tokens (prefixed `artist:...`, e.g. `0.85::artist:rella::, 0.7::artist:ciloranko::`) and optional art-medium modifiers (`watercolor (medium)`, `impasto`) matching the requested aesthetic.
   - Do NOT put character traits, outfits, lighting, or quality tags (`masterpiece`) in this block.
   - Always call `search_artist_catalog` when selecting artists so you pick verified tags from the user's catalog when available!
2. "character" (人物相关):
   - Subject count first (`1girl, solo`, `1boy, 1girl`, etc.), OC/character name, hair/eyes (`silver hair, detailed eyes`), expression (`gentle blush, light smile, looking at viewer`), pose & interaction, outfit & accessories (`serafuku, pleated skirt, hair ribbon`).
   - For V4.5 and V5 (T5 encoder): combine crisp Danbooru tags with short natural English interaction phrases when helpful (e.g., `leaning on rooftop railing, holding a glowing lantern`).
3. "lighting" (光影与场景):
   - Camera framing (`cowboy shot`, `from below`, `dutch angle`), environment/setting (`school rooftop, ocean horizon`), atmosphere & time (`golden hour sunset, cumulonimbus clouds`), lighting/FX (`cinematic backlighting, rim lighting, tyndall effect, lens flare, floating petals, bokeh`), plus concise V4.5/V5 aesthetic anchors (`very aesthetic, high complexity, masterpiece, absurdres`).
4. "negative" (负面提示词 / UC):
   - Model-appropriate undesired content (`lowres, artistic error, worst quality, bad quality, jpeg artifacts, very displeasing, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, blurry`) plus targeted exclusions for the scene (e.g. `watermark, text, signature, multiple views`).

Critical NovelAI Syntax Rules:
- For V4 / V4.5 / V5 (`supports_numeric_weight=true`): use `w::tag::` (e.g. `1.15::floating hair::`, `0.8::artist:rella::`) or `{tag}` / `[tag]`.
- For V3 (`supports_numeric_weight=false`): NEVER use `::` weights; use `{}` (+5%) and `[]` (-5%) only.
- NEVER use Stable Diffusion WebUI `(tag:1.2)` syntax, `BREAK`, `AND`, or Chinese characters inside the 4 prompt fields!
- Before answering `scope="all"`, or whenever composing positive blocks, run `validate_and_lint_prompt` on the combined prompt if tools are available to verify zero lint errors.
- Always respond at the end with ONLY valid JSON containing keys (keep explanation under 80 Chinese characters):
  {"artist": "...", "character": "...", "lighting": "...", "negative": "...", "explanation": "简要中文说明设计思路"}"""

AGENT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_artist_catalog",
            "description": "Search NAI Studio's curated and custom artist catalog by keyword, style mood, category, or favorites.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Chinese or English style keyword (empty to list top curated artists)."},
                    "category": {"type": "string", "description": "Optional category such as 厚涂光影, 清透水彩, 幻彩插画, 日系轻小说, 赛博冷调, 私人收藏."},
                    "favorite_only": {"type": "boolean", "description": "Whether to filter to user's favorite artists first."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_danbooru_tags",
            "description": "Look up authentic English Danbooru/NovelAI tags matching a Chinese or English visual concept.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Concept to look up (e.g. '水手服', 'backlighting', '异色瞳', '天台')."}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_oc_and_snippets",
            "description": "Inspect user's saved OC character cards and reusable preset tag snippets in NAI Studio.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Optional character or preset keyword."}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_model_rules",
            "description": "Get exact syntax capabilities, default quality tags, and UC preset rules for the target NovelAI model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_id": {"type": "string", "description": "Model id such as nai-diffusion-5-full or nai-diffusion-4-5-full."}
                },
                "required": ["model_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_and_lint_prompt",
            "description": "Validate a draft NovelAI prompt string against official model syntax rules and catch issues like SD parenthesis syntax.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Combined prompt string to lint."},
                    "model_id": {"type": "string", "description": "Target NovelAI model id."},
                },
                "required": ["prompt", "model_id"],
            },
        },
    },
]


def _get_llm_client() -> httpx.AsyncClient:
    global _LLM_CLIENT
    if _LLM_CLIENT is None or _LLM_CLIENT.is_closed:
        _LLM_CLIENT = httpx.AsyncClient(timeout=75.0)
    return _LLM_CLIENT


def _clean_base_url(raw: str) -> str:
    url = str(raw or "").strip().rstrip("/")
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        raise ValueError("LLM Base URL 必须以 http:// 或 https:// 开头")
    return url


def _rank_models(model_ids: List[str]) -> List[str]:
    priority = {m: idx for idx, m in enumerate(RECOMMENDED_MODEL_ORDER)}
    filtered = [
        m for m in model_ids
        if not any(skip in m.lower() for skip in ("embedding", "rerank", "tts", "asr", "audio", "speech", "ocr", "mt-", "translate", "wan", "-image", "z-image"))
    ]
    return sorted(filtered, key=lambda m: (priority.get(m, 999), m.lower()))


async def fetch_llm_models(base_url: Optional[str] = None, api_key: Optional[str] = None) -> Dict[str, Any]:
    cfg = load_config()
    saved_url = _clean_base_url(cfg.get("llm_base_url") or "")
    url = _clean_base_url(base_url or saved_url)
    key = (api_key or "").strip()
    if not key or "..." in key:
        if not base_url or url == saved_url:
            key = str(cfg.get("llm_api_key") or "").strip()
        else:
            key = ""
    if not url or not key:
        raise ValueError("请先配置 LLM API Base URL 与 API Key（修改 Base URL 时需重新填写对应 API Key）")

    client = _get_llm_client()
    r = await client.get(
        f"{url}/models",
        headers={"Authorization": f"Bearer {key}", "User-Agent": "NAI-Studio/2.4"},
        timeout=20.0,
    )
    if r.status_code != 200:
        raise ValueError(f"拉取模型列表失败 (HTTP {r.status_code}): {r.text[:200]}")
    data = r.json()
    raw_ids = [str(m.get("id")) for m in (data.get("data") or []) if m.get("id")]
    ranked = _rank_models(raw_ids)
    return {
        "ok": True,
        "recommended": ranked[:16],
        "all_models": ranked,
        "total_raw": len(raw_ids),
    }


async def test_llm_connection(
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    cfg = load_config()
    saved_url = _clean_base_url(cfg.get("llm_base_url") or "")
    url = _clean_base_url(base_url or saved_url)
    key = (api_key or "").strip()
    if not key or "..." in key:
        if not base_url or url == saved_url:
            key = str(cfg.get("llm_api_key") or "").strip()
        else:
            key = ""
    chosen_model = str(model or cfg.get("llm_model") or "qwen4-max").strip()
    if not url or not key:
        raise ValueError("请先填写 LLM Base URL 与 API Key（修改 Base URL 时需重新填写对应 API Key）")

    t0 = time.perf_counter()
    client = _get_llm_client()
    r = await client.post(
        f"{url}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "NAI-Studio/2.4"},
        json={
            "model": chosen_model,
            "messages": [{"role": "user", "content": "Reply with OK"}],
            "max_tokens": 16,
            "temperature": 0.0,
        },
        timeout=25.0,
    )
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    if r.status_code != 200:
        raise ValueError(f"LLM 连通测试失败 (HTTP {r.status_code}): {r.text[:240]}")
    body = r.json()
    reply = ((body.get("choices") or [{}])[0].get("message") or {}).get("content", "")
    return {
        "ok": True,
        "model": body.get("model") or chosen_model,
        "latency_ms": latency_ms,
        "reply": str(reply).strip()[:80],
    }


def _execute_agent_tool(name: str, args: Dict[str, Any], target_model_id: str) -> Tuple[str, str]:
    """Executes a read-only local NAI Studio knowledge tool and returns (json_result, short_trace_summary)."""
    if name == "search_artist_catalog":
        q = str(args.get("query") or "").strip()
        cat = str(args.get("category") or "").strip()
        fav = bool(args.get("favorite_only", False))
        artists = list_artists(search=q, category=cat, favorite_only=fav)
        if not artists and q:
            # Fallback to returning favorites + top curated options so the LLM can still blend meaningfully
            artists = list_artists(favorite_only=True) or list_artists()
        trimmed = [
            {
                "name": a["name"],
                "tag": a["tag"],
                "category": a["category"],
                "favorite": a["favorite"],
                "desc": a["desc"],
            }
            for a in artists[:10]
        ]
        summary = f"检索画师库({q or cat or '全部'}) -> {len(trimmed)} 位候选"
        return json.dumps({"artists": trimmed}, ensure_ascii=False), summary

    if name == "search_danbooru_tags":
        q = str(args.get("query") or "").strip()
        hits = search_builtin_tags(q, limit=12)
        if not hits and q:
            seen_tags = set()
            for part in re.split(r"[\s,，、/]+", q):
                if not part.strip():
                    continue
                for item in search_builtin_tags(part.strip(), limit=6):
                    if item["tag"] not in seen_tags:
                        seen_tags.add(item["tag"])
                        hits.append(item)
            hits = hits[:12]
        summary = f"检索标签词库({q}) -> {len(hits)} 条匹配"
        return json.dumps({"tags": hits}, ensure_ascii=False), summary

    if name == "list_oc_and_snippets":
        q = str(args.get("query") or "").strip().lower()
        ocs = list_oc_cards()
        snips = list_snippets()
        if q:
            ocs = [o for o in ocs if q in (o["name"] + " " + o["prompt"]).lower()] or ocs[:4]
            snips = [s for s in snips if q in (s["label"] + " " + s["tags"]).lower()] or snips[:6]
        summary = f"读取 OC({len(ocs[:5])}) 与预设词条({len(snips[:6])})"
        return json.dumps(
            {
                "oc_cards": [{"name": o["name"], "prompt": o["prompt"], "uc": o["uc"]} for o in ocs[:5]],
                "snippets": [{"label": s["label"], "tags": s["tags"]} for s in snips[:6]],
            },
            ensure_ascii=False,
        ), summary

    if name == "get_current_model_rules":
        mid = str(args.get("model_id") or target_model_id)
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
        return json.dumps(payload, ensure_ascii=False), f"读取模型规范({spec['short_name']})"

    if name == "validate_and_lint_prompt":
        prompt_str = str(args.get("prompt") or "")
        mid = str(args.get("model_id") or target_model_id)
        res = lint_prompt(prompt_str, mid)
        is_clean = res["issue_count"] == 0
        summary = f"语法体检 -> {'通过' if is_clean else str(res['issue_count']) + ' 处建议修正'}"
        return json.dumps(
            {
                "is_clean": is_clean,
                "issues": res["issues"][:6],
                "fixed_prompt": res["fixed_prompt"],
            },
            ensure_ascii=False,
        ), summary

    return json.dumps({"error": f"Unknown tool {name}"}), f"未知工具({name})"


def _extract_json_block(raw: str) -> Dict[str, Any]:
    txt = str(raw or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", txt, re.IGNORECASE)
    if fence:
        txt = fence.group(1).strip()
    start = txt.find("{")
    end = txt.rfind("}")
    candidate = txt[start : end + 1] if (start != -1 and end > start) else (txt[start:] if start != -1 else txt)
    try:
        return json.loads(candidate)
    except Exception:
        # Resilient fallback: extract key-value strings cleanly even if an explanation was truncated at token limit
        recovered: Dict[str, Any] = {}
        for key in ("artist", "character", "lighting", "negative", "explanation"):
            m = re.search(rf'"{key}"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)', candidate, re.DOTALL)
            if m:
                try:
                    recovered[key] = json.loads(f'"{m.group(1)}"')
                except Exception:
                    recovered[key] = m.group(1).replace('\\"', '"').replace("\\n", " ").strip()
        if any(k in recovered for k in ("artist", "character", "lighting", "negative")):
            return recovered
        raise


def _clean_tag_field(val: Any) -> str:
    s = str(val or "").strip()
    s = s.replace("，", ", ").replace("；", ", ")
    # Remove any accidental markdown code backticks or stray outer quotes
    s = s.replace("`", "").strip()
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"(?:,\s*){2,}", ", ", s)
    return s.strip(", ")


def _build_preloaded_context(instruction: str, model_id: str) -> str:
    spec = get_model_spec(model_id)
    fav_artists = list_artists(favorite_only=True)[:6] or list_artists()[:6]
    # Also scan words inside instruction against artists & tags
    tokens = [t for t in re.split(r"[\s,，。、/]+", instruction) if len(t) >= 2]
    matched_tags: List[Dict[str, Any]] = []
    matched_artists: Dict[int, Dict[str, Any]] = {a["id"]: a for a in fav_artists}
    for tok in tokens[:6]:
        for a in list_artists(search=tok)[:3]:
            matched_artists[a["id"]] = a
        matched_tags.extend(search_builtin_tags(tok, limit=3))

    return json.dumps(
        {
            "target_model": {
                "id": spec["id"],
                "name": spec["name"],
                "supports_numeric_weight": spec["supports_numeric_weight"],
                "quality_tags": spec["quality_tags"],
                "heavy_uc": (spec.get("uc_presets") or {}).get("heavy", {}).get("tags", ""),
            },
            "curated_artists": [
                {"name": a["name"], "tag": a["tag"], "category": a["category"], "desc": a["desc"]}
                for a in list(matched_artists.values())[:10]
            ],
            "matched_tags": matched_tags[:12],
        },
        ensure_ascii=False,
    )


def compose_blocks_prompt(blocks: Dict[str, str]) -> str:
    parts = [
        _clean_tag_field(blocks.get("artist", "")),
        _clean_tag_field(blocks.get("character", "")),
        _clean_tag_field(blocks.get("lighting", "")),
    ]
    return ", ".join(p for p in parts if p)


async def post_chat_with_max_tokens_fallback(
    client: httpx.AsyncClient,
    endpoint: str,
    headers: Dict[str, str],
    req_body: Dict[str, Any],
    timeout: float = 120.0,
) -> Tuple[httpx.Response, int]:
    """Post an OpenAI-compatible chat request and step down max_tokens if the model enforces a lower cap."""
    active_cap = int(req_body.get("max_tokens") or 100000)
    r = await client.post(endpoint, headers=headers, json=req_body, timeout=timeout)
    if r.status_code == 400 and any(k in r.text.lower() for k in ("max_tokens", "range", "maximum", "limit")):
        for fallback_cap in (32768, 16384, 8192):
            if active_cap > fallback_cap:
                active_cap = fallback_cap
                req_body["max_tokens"] = active_cap
                r = await client.post(endpoint, headers=headers, json=req_body, timeout=timeout)
                if r.status_code == 200:
                    break
    return r, active_cap


async def run_prompt_agent(
    instruction: str,
    model_id: str = "nai-diffusion-5-full",
    scope: str = "all",
    existing_blocks: Optional[Dict[str, str]] = None,
    cfg: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    conf = cfg or load_config()
    base_url = _clean_base_url(conf.get("llm_base_url") or "")
    api_key = str(conf.get("llm_api_key") or "").strip()
    llm_model = str(conf.get("llm_model") or "qwen4-max").strip()
    use_agent = bool(conf.get("llm_use_knowledge_agent", True))
    active_max_out = max(2048, min(128000, int(conf.get("llm_max_output_tokens") or 100000)))

    if not base_url or not api_key:
        raise ValueError("尚未配置 LLM API Key 或 Base URL，请前往「设置与 Agent」填写并保存。")

    req_text = str(instruction or "").strip()
    cur_blocks = {
        "artist": _clean_tag_field((existing_blocks or {}).get("artist", "")),
        "character": _clean_tag_field((existing_blocks or {}).get("character", "")),
        "lighting": _clean_tag_field((existing_blocks or {}).get("lighting", "")),
        "negative": _clean_tag_field((existing_blocks or {}).get("negative", "")),
    }
    valid_scopes = {"all", "artist", "character", "lighting", "negative"}
    target_scope = scope if scope in valid_scopes else "all"

    spec = get_model_spec(model_id)
    scope_instruction = (
        "Generate or refine ALL 4 blocks (artist, character, lighting, negative)."
        if target_scope == "all"
        else f"Focus ONLY on regenerating/improving the '{target_scope}' block to harmonize with the existing other blocks. Preserve the existing other 3 blocks verbatim in your JSON."
    )

    user_payload = (
        f"Target NovelAI Model: {spec['id']} ({spec['name']}, supports_numeric_weight={spec['supports_numeric_weight']})\n"
        f"Task Scope: {scope_instruction}\n"
        f"User Natural Language Request:\n{req_text or '根据当前已有提示词区块补全并专业化优化该区块'}\n\n"
        f"Current 4 Blocks:\n{json.dumps(cur_blocks, ensure_ascii=False)}"
    )

    client = _get_llm_client()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "NAI-Studio/2.4",
    }
    endpoint = f"{base_url}/chat/completions"
    trace: List[Dict[str, str]] = []

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": NAI_SYSTEM_KNOWLEDGE},
        {"role": "user", "content": user_payload},
    ]

    parsed: Optional[Dict[str, Any]] = None
    if use_agent:
        try:
            for round_idx in range(4):
                req_body: Dict[str, Any] = {
                    "model": llm_model,
                    "messages": messages,
                    "tools": AGENT_TOOLS,
                    "tool_choice": "auto" if round_idx < 3 else "none",
                    "temperature": 0.45,
                    "max_tokens": active_max_out,
                }
                r, active_max_out = await post_chat_with_max_tokens_fallback(
                    client, endpoint, headers, req_body, timeout=120.0
                )
                if r.status_code != 200:
                    raise ValueError(f"HTTP {r.status_code}: {r.text[:240]}")
                data = r.json()
                msg = (data.get("choices") or [{}])[0].get("message") or {}
                tool_calls = msg.get("tool_calls") or []
                messages.append(msg)
                if not tool_calls:
                    candidate_text = str(msg.get("content") or "")
                    if candidate_text.strip():
                        try:
                            parsed = _extract_json_block(candidate_text)
                        except Exception:
                            parsed = None
                    break
                for tc in tool_calls[:6]:
                    fn = tc.get("function") or {}
                    tname = str(fn.get("name") or "")
                    try:
                        targs = json.loads(fn.get("arguments") or "{}")
                    except Exception:
                        targs = {}
                    out_json, summary = _execute_agent_tool(tname, targs, spec["id"])
                    trace.append({"tool": tname, "summary": summary})
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id") or f"call_{round_idx}_{tname}",
                        "content": out_json,
                    })
        except Exception as agent_err:
            trace.append({"tool": "fallback", "summary": f"切换单轮知识注入模式 ({str(agent_err)[:60]})"})
            parsed = None

    if not parsed:
        preloaded = _build_preloaded_context(req_text, spec["id"])
        trace.append({"tool": "local_knowledge", "summary": "已预注入画师库/词库/模型规范"})
        base_payload: Dict[str, Any] = {
            "model": llm_model,
            "messages": [
                {"role": "system", "content": NAI_SYSTEM_KNOWLEDGE},
                {"role": "system", "content": f"Local NAI Studio Knowledge Context:\n{preloaded}"},
                {"role": "user", "content": user_payload},
            ],
            "temperature": 0.45,
            "max_tokens": active_max_out,
            "response_format": {"type": "json_object"},
        }
        r2, active_max_out = await post_chat_with_max_tokens_fallback(
            client, endpoint, headers, base_payload, timeout=120.0
        )
        if r2.status_code == 400 and "response_format" in r2.text.lower():
            base_payload.pop("response_format", None)
            r2 = await client.post(endpoint, headers=headers, json=base_payload, timeout=60.0)
        if r2.status_code != 200:
            raise ValueError(f"LLM 请求失败 (HTTP {r2.status_code}): {r2.text[:260]}")
        final_content = str((((r2.json().get("choices") or [{}])[0]).get("message") or {}).get("content") or "")
        parsed = _extract_json_block(final_content)
    out_blocks = dict(cur_blocks)
    if target_scope == "all":
        for k in ("artist", "character", "lighting", "negative"):
            if k in parsed and parsed[k] is not None:
                out_blocks[k] = _clean_tag_field(parsed[k])
    else:
        if target_scope in parsed and parsed[target_scope] is not None:
            out_blocks[target_scope] = _clean_tag_field(parsed[target_scope])

    if not out_blocks["negative"] and target_scope in ("all", "negative"):
        out_blocks["negative"] = (spec.get("uc_presets") or {}).get("heavy", {}).get("tags", "lowres, bad anatomy")

    composed = compose_blocks_prompt(out_blocks)
    lint_res = lint_prompt(composed, spec["id"])
    return {
        "ok": True,
        "scope": target_scope,
        "model": llm_model,
        "blocks": out_blocks,
        "composed_prompt": composed,
        "uc": out_blocks["negative"],
        "explanation": str(parsed.get("explanation") or "").strip(),
        "agent_trace": trace,
        "lint": {
            "is_clean": lint_res["issue_count"] == 0,
            "issues_count": lint_res["issue_count"],
        },
    }
