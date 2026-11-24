r"""
NAI Studio — Native Windows Desktop Application (WebView2 + System Tray + Embedded FastAPI).

Features:
- Zero C-drive cache: forces TMP/TEMP/WEBVIEW2_USER_DATA_FOLDER onto D:\NAI-Studio\data\webview_cache
- Single-process embedded Uvicorn server (auto-attaches if port 8780 is already running)
- Native Windows 11 dark titlebar synced with NAI Studio theme
- Persistent window geometry (D:\NAI-Studio\data\desktop_window.json)
- System Tray integration (closing window hides to tray so MCP /mcp & A2A /a2a stay online for Codex)
- Clean graceful shutdown with zero orphan processes
"""
from __future__ import annotations

import argparse
import ctypes
import json
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any, Dict, Optional

BASE_DIR = Path("D:/NAI-Studio").resolve()
DATA_DIR = BASE_DIR / "data"
OUTPUTS_DIR = BASE_DIR / "outputs"
TMP_DIR = BASE_DIR / "tmp"
LOGS_DIR = BASE_DIR / "logs"
WEBVIEW_CACHE_DIR = DATA_DIR / "webview_cache"
WINDOW_STATE_PATH = DATA_DIR / "desktop_window.json"
ICON_ICO_PATH = BASE_DIR / "frontend" / "nai_studio.ico"
ICON_PNG_PATH = BASE_DIR / "frontend" / "nai_studio_icon.png"

for _d in (BASE_DIR, DATA_DIR, OUTPUTS_DIR, TMP_DIR, LOGS_DIR, WEBVIEW_CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Enforce strict zero C-drive cache BEFORE importing webview / backend
os.environ["TMP"] = str(TMP_DIR)
os.environ["TEMP"] = str(TMP_DIR)
os.environ["TMPDIR"] = str(TMP_DIR)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
os.environ["PYTHONUTF8"] = "1"
os.environ["WEBVIEW2_USER_DATA_FOLDER"] = str(WEBVIEW_CACHE_DIR)

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

logging.basicConfig(
    filename=str(LOGS_DIR / "desktop.log"),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    encoding="utf-8",
)
logger = logging.getLogger("nai_studio_desktop")


def load_window_state() -> Dict[str, Any]:
    default = {"width": 1460, "height": 920, "x": None, "y": None}
    if WINDOW_STATE_PATH.exists():
        try:
            raw = json.loads(WINDOW_STATE_PATH.read_text(encoding="utf-8"))
            w = max(1080, min(3840, int(raw.get("width") or 1460)))
            h = max(700, min(2160, int(raw.get("height") or 920)))
            x = int(raw["x"]) if raw.get("x") is not None and -100 <= int(raw["x"]) <= 3600 else None
            y = int(raw["y"]) if raw.get("y") is not None and -50 <= int(raw["y"]) <= 2000 else None
            return {"width": w, "height": h, "x": x, "y": y}
        except Exception:
            pass
    return default


def save_window_state(width: int, height: int, x: Optional[int] = None, y: Optional[int] = None) -> Dict[str, Any]:
    state = {
        "width": max(1080, min(3840, int(width or 1460))),
        "height": max(700, min(2160, int(height or 920))),
        "x": int(x) if x is not None and -100 <= int(x) <= 3600 else None,
        "y": int(y) if y is not None and -50 <= int(y) <= 2000 else None,
    }
    try:
        WINDOW_STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to save window state: %s", exc)
    return state


def is_port_listening(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.35):
            return True
    except OSError:
        return False


def wait_for_server_ready(url: str, timeout_sec: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout_sec
    check_url = f"{url.rstrip('/')}/api/models"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(check_url, timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.15)
    return False


def apply_windows_dark_titlebar(window_title: str, dark: bool = True) -> None:
    """Enable native Windows 11 dark titlebar via DwmSetWindowAttribute."""
    if sys.platform != "win32":
        return
    try:
        user32 = ctypes.windll.user32
        dwmapi = ctypes.windll.dwmapi
        hwnd = user32.FindWindowW(None, window_title)
        if not hwnd:
            return
        val = ctypes.c_int(1 if dark else 0)
        # Attribute 20 = DWMWA_USE_IMMERSIVE_DARK_MODE (Win11 / Win10 2004+)
        dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(val), ctypes.sizeof(val))
    except Exception:
        pass


class DesktopBridge:
    """JS-to-Python bridge exposed on `window.pywebview.api` inside the desktop shell."""

    def __init__(self, url: str) -> None:
        self._url = url

    def get_desktop_info(self) -> Dict[str, Any]:
        return {
            "is_desktop": True,
            "url": self._url,
            "webview_cache_dir": str(WEBVIEW_CACHE_DIR),
            "outputs_dir": str(OUTPUTS_DIR),
        }

    def open_outputs_folder(self) -> Dict[str, Any]:
        try:
            os.startfile(str(OUTPUTS_DIR))
            return {"ok": True, "path": str(OUTPUTS_DIR)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def open_in_browser(self) -> Dict[str, Any]:
        webbrowser.open(self._url)
        return {"ok": True}


class EmbeddedBackendServer:
    """Runs FastAPI uvicorn inside a daemon thread with clean programmatic shutdown."""

    def __init__(self, host: str = "127.0.0.1", port: int = 8780) -> None:
        self.host = host
        self.port = port
        self.server = None
        self.thread: Optional[threading.Thread] = None
        self.owned = False

    def start(self) -> bool:
        if is_port_listening(self.host, self.port):
            logger.info("Port %s:%s already listening; attaching to existing backend.", self.host, self.port)
            self.owned = False
            return True

        import uvicorn
        from backend.app import app

        config = uvicorn.Config(
            app,
            host=self.host,
            port=self.port,
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(config)
        # Prevent uvicorn from installing signal handlers in a non-main thread
        self.server.install_signal_handlers = lambda: None  # type: ignore[method-assign]
        self.owned = True
        self.thread = threading.Thread(target=self.server.run, name="nai-uvicorn", daemon=True)
        self.thread.start()
        ready = wait_for_server_ready(f"http://{self.host}:{self.port}", timeout_sec=18.0)
        logger.info("Embedded uvicorn started on %s:%s (ready=%s)", self.host, self.port, ready)
        return ready

    def stop(self) -> None:
        if self.owned and self.server is not None:
            logger.info("Stopping embedded uvicorn server...")
            self.server.should_exit = True
            if self.thread and self.thread.is_alive():
                self.thread.join(timeout=3.5)


def run_smoke_test(port: int = 8782) -> int:
    """Headless verification of embedded backend + WebView2 cache path + clean shutdown."""
    backend = EmbeddedBackendServer("127.0.0.1", port)
    ok = backend.start()
    if not ok:
        print("SMOKE_FAIL: embedded server did not become ready")
        return 1
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/.well-known/agent-card.json", timeout=3.0) as r:
            card = json.loads(r.read().decode("utf-8"))
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/mcp/info", timeout=3.0) as r:
            mcp_info = json.loads(r.read().decode("utf-8"))
        import webview
        import pystray
        print(
            "DESKTOP_SMOKE_OK:",
            f"card={card.get('name')}",
            f"mcp_tools={mcp_info.get('tool_count')}",
            f"pywebview={getattr(webview, '__version__', 'ok')}",
            f"pystray={bool(pystray)}",
            f"cache={WEBVIEW_CACHE_DIR}",
        )
        return 0
    finally:
        backend.stop()


def main() -> int:
    parser = argparse.ArgumentParser(description="NAI Studio Native Desktop App")
    parser.add_argument("--port", type=int, default=0, help="Override server port (default from config.json / 8780)")
    parser.add_argument("--smoke-test", action="store_true", help="Run headless smoke verification and exit")
    parser.add_argument("--no-tray", action="store_true", help="Disable minimize-to-tray (exit immediately on window close)")
    args = parser.parse_args()

    from backend.config import load_config

    cfg = load_config()
    port = int(args.port or cfg.get("port") or 8780)

    if args.smoke_test:
        return run_smoke_test(port=args.port or 8782)

    url = f"http://127.0.0.1:{port}"
    window_title = "NAI Studio — 个人创作工作台"
    is_dark = str(cfg.get("theme") or "dark").lower() != "light"

    backend = EmbeddedBackendServer("127.0.0.1", port)
    if not backend.start():
        logger.error("Failed to start embedded backend on port %s", port)
        return 1

    import webview
    from PIL import Image
    import pystray

    win_state = load_window_state()
    bridge = DesktopBridge(url)
    quitting = threading.Event()
    tray_icon_holder: Dict[str, Any] = {"icon": None}

    window = webview.create_window(
        title=window_title,
        url=url,
        js_api=bridge,
        width=win_state["width"],
        height=win_state["height"],
        x=win_state["x"],
        y=win_state["y"],
        min_size=(1080, 700),
        background_color="#0d1117" if is_dark else "#f8fafc",
        text_select=True,
    )

    def _persist_geometry() -> None:
        try:
            save_window_state(window.width, window.height, window.x, window.y)
        except Exception:
            pass

    def _on_closing() -> bool:
        _persist_geometry()
        if args.no_tray or quitting.is_set():
            return True
        # Hide to system tray so MCP / A2A remain online in background for external Agents
        try:
            window.hide()
            return False
        except Exception:
            return True

    window.events.closing += _on_closing

    def _show_window(_icon=None, _item=None) -> None:
        try:
            window.show()
            window.restore()
            apply_windows_dark_titlebar(window_title, dark=is_dark)
        except Exception:
            pass

    def _open_outputs(_icon=None, _item=None) -> None:
        try:
            os.startfile(str(OUTPUTS_DIR))
        except Exception:
            pass

    def _open_browser(_icon=None, _item=None) -> None:
        webbrowser.open(url)

    def _quit_app(_icon=None, _item=None) -> None:
        quitting.set()
        _persist_geometry()
        try:
            if tray_icon_holder["icon"] is not None:
                tray_icon_holder["icon"].stop()
        except Exception:
            pass
        try:
            window.destroy()
        except Exception:
            pass
        backend.stop()

    def _start_tray() -> None:
        if args.no_tray:
            return
        try:
            icon_img = Image.open(ICON_PNG_PATH) if ICON_PNG_PATH.exists() else Image.new("RGBA", (64, 64), (99, 102, 241, 255))
            menu = pystray.Menu(
                pystray.MenuItem("打开 NAI Studio 窗口", _show_window, default=True),
                pystray.MenuItem("打开作品目录 (outputs)", _open_outputs),
                pystray.MenuItem("在浏览器中打开", _open_browser),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出 NAI Studio（停止 MCP/A2A）", _quit_app),
            )
            tray = pystray.Icon(
                "nai_studio",
                icon_img,
                f"NAI Studio · 运行中 (127.0.0.1:{port} · MCP/A2A)",
                menu,
            )
            tray_icon_holder["icon"] = tray
            tray.run()
        except Exception as exc:
            logger.warning("System tray unavailable: %s", exc)

    def _on_webview_started() -> None:
        # Apply Windows 11 dark titlebar once native HWND is created
        for _ in range(10):
            apply_windows_dark_titlebar(window_title, dark=is_dark)
            time.sleep(0.12)
        threading.Thread(target=_start_tray, name="nai-tray", daemon=True).start()

    try:
        webview.start(
            func=_on_webview_started,
            gui="edgechromium",
            private_mode=False,
            storage_path=str(WEBVIEW_CACHE_DIR),
            icon=str(ICON_ICO_PATH) if ICON_ICO_PATH.exists() else None,
        )
    finally:
        quitting.set()
        _persist_geometry()
        try:
            if tray_icon_holder["icon"] is not None:
                tray_icon_holder["icon"].stop()
        except Exception:
            pass
        backend.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
