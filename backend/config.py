import json
import os
from pathlib import Path
from typing import Any, Dict

# Force all temporary files and caches onto D:\NAI-Studio\tmp so C: drive is NEVER touched
BASE_DIR = Path("D:/NAI-Studio").resolve()
DATA_DIR = BASE_DIR / "data"
OUTPUTS_DIR = BASE_DIR / "outputs"
ARTISTS_DIR = BASE_DIR / "artists"
TMP_DIR = BASE_DIR / "tmp"
LOGS_DIR = BASE_DIR / "logs"
FRONTEND_DIR = BASE_DIR / "frontend"

for _d in (BASE_DIR, DATA_DIR, OUTPUTS_DIR, ARTISTS_DIR, TMP_DIR, LOGS_DIR, FRONTEND_DIR):
    _d.mkdir(parents=True, exist_ok=True)

os.environ["TMP"] = str(TMP_DIR)
os.environ["TEMP"] = str(TMP_DIR)
os.environ["TMPDIR"] = str(TMP_DIR)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

CONFIG_PATH = DATA_DIR / "config.json"
DB_PATH = DATA_DIR / "studio.db"

DEFAULT_CONFIG: Dict[str, Any] = {
    "api_token": os.environ.get("NAI_API_TOKEN", "").strip(),
    "base_url": "https://image.novelai.net",
    "default_model": "nai-diffusion-5-full",
    "opus_free_guard": True,
    "auto_quality_tags": True,
    "default_uc_preset": "heavy",
    "output_dir": str(OUTPUTS_DIR),
    "theme": "dark",
    "bg_hex": "#0b262c",
    "bg_preset_name": "暮色青黛",
    "glass_clarity": 88,
    "port": 8780,
    "prompt_workspace_mode": "classic",
    "llm_base_url": "https://maas.qianwenaiapi.com/compatible-mode/v1",
    "llm_api_key": "",
    "llm_model": "qwen4-max",
    "llm_use_knowledge_agent": True,
    "llm_context_tokens": 100000,
    "llm_max_output_tokens": 100000,
    "external_agent_auth_enabled": False,
    "external_agent_token": "",
    "external_agent_max_images": 1,
    "external_agent_opus_guard": True,
    "external_agent_allow_generate": True,
    "external_agent_vision_qa": False,
}


def load_config() -> Dict[str, Any]:
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            merged = {**DEFAULT_CONFIG, **data}
            out_dir = Path(merged.get("output_dir") or str(OUTPUTS_DIR))
            if out_dir.drive.upper() == "C:":
                merged["output_dir"] = str(OUTPUTS_DIR)
            if not merged.get("api_token") and os.environ.get("NAI_API_TOKEN"):
                merged["api_token"] = os.environ["NAI_API_TOKEN"].strip()
            return merged
        except Exception:
            pass
    save_config(DEFAULT_CONFIG)
    return dict(DEFAULT_CONFIG)


def save_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    merged = {**DEFAULT_CONFIG, **cfg}
    # Ensure output_dir is never on C: drive unless explicitly forced, default to D:/NAI-Studio/outputs
    out_dir = Path(merged.get("output_dir") or str(OUTPUTS_DIR))
    if out_dir.drive.upper() == "C:":
        out_dir = OUTPUTS_DIR
        merged["output_dir"] = str(OUTPUTS_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def mask_token(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 12:
        return token[:4] + "..."
    return f"{token[:8]}...{token[-6:]}"
