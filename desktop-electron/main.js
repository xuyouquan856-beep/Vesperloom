const { app, BrowserWindow, WebContentsView, Tray, Menu, ipcMain, shell, nativeImage, dialog, screen } = require("electron");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { pathToFileURL } = require("url");

function resolveStudioRoot() {
  const candidates = [
    process.env.NAI_STUDIO_ROOT,
    path.resolve(__dirname, ".."),
    path.resolve(path.dirname(process.execPath), "..", ".."),
    path.resolve(path.dirname(process.execPath), ".."),
    "D:\\NAI-Studio",
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "backend", "app.py"))) {
        return path.resolve(dir);
      }
    } catch (_) {}
  }
  return "D:\\NAI-Studio";
}

const STUDIO_ROOT = resolveStudioRoot();
const DATA_DIR = path.join(STUDIO_ROOT, "data");
const OUTPUTS_DIR = path.join(STUDIO_ROOT, "outputs");
const TMP_DIR = path.join(STUDIO_ROOT, "tmp");
const LOGS_DIR = path.join(STUDIO_ROOT, "logs");
const ELECTRON_DATA_DIR = path.join(DATA_DIR, "electron_data");
const WINDOW_STATE_PATH = path.join(DATA_DIR, "electron_window.json");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const SPLASH_DIR = path.join(DATA_DIR, "splash");
const SPLASH_FAVORITES_CACHE = path.join(DATA_DIR, "splash_favorites.json");
const ICON_ICO_PATH = path.join(__dirname, "assets", "vesperloom.ico");
const ICON_PNG_PATH = path.join(__dirname, "assets", "vesperloom_icon.png");
const DEFAULT_SPLASH_PATH = path.join(__dirname, "assets", "default_splash.jpg");

for (const d of [DATA_DIR, OUTPUTS_DIR, TMP_DIR, LOGS_DIR, ELECTRON_DATA_DIR, SPLASH_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

// Strict Zero C-Drive Cache: lock all Chromium/Electron storage & temp onto D:\NAI-Studio
process.env.TMP = TMP_DIR;
process.env.TEMP = TMP_DIR;
process.env.TMPDIR = TMP_DIR;
process.env.PYTHONDONTWRITEBYTECODE = "1";
process.env.PYTHONUTF8 = "1";

app.setPath("userData", ELECTRON_DATA_DIR);
app.setPath("sessionData", path.join(ELECTRON_DATA_DIR, "session"));
app.setPath("temp", TMP_DIR);
app.setPath("logs", LOGS_DIR);
app.setName("Vesperloom");

const SMOKE_TEST = process.argv.includes("--smoke-test");

function readStudioConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (_) {}
  return {};
}

const STUDIO_CFG = readStudioConfig();
const PORT = SMOKE_TEST ? 8783 : Number(STUDIO_CFG.port || 8780);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IS_DARK = String(STUDIO_CFG.theme || "dark").toLowerCase() !== "light";

let mainWindow = null;
let appView = null;
let splashView = null;
let tray = null;
let backendProc = null;
let ownedBackend = false;
let isQuitting = false;
let splashShownAt = 0;

function logDesktop(msg) {
  const line = `${new Date().toISOString()} [desktop] ${msg}\n`;
  try {
    fs.appendFileSync(path.join(LOGS_DIR, "desktop_electron.log"), line, "utf-8");
  } catch (_) {}
}

function isRectVisibleOnAnyDisplay(x, y, width, height) {
  try {
    const displays = screen.getAllDisplays();
    for (const d of displays) {
      const wa = d.workArea;
      const overlapX = Math.max(0, Math.min(x + width, wa.x + wa.width) - Math.max(x, wa.x));
      const overlapY = Math.max(0, Math.min(y + height, wa.y + wa.height) - Math.max(y, wa.y));
      if (overlapX >= 120 && overlapY >= 80) return true;
    }
  } catch (_) {}
  return false;
}

function loadWindowState() {
  const def = { width: 1480, height: 920, x: undefined, y: undefined, isMaximized: false };
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, "utf-8"));
      const width = Math.max(1080, Math.min(3840, Number(raw.width) || 1480));
      const height = Math.max(700, Math.min(2160, Number(raw.height) || 920));
      const hasCoords = typeof raw.x === "number" && typeof raw.y === "number" && Number.isFinite(raw.x) && Number.isFinite(raw.y);
      const visible = hasCoords && isRectVisibleOnAnyDisplay(raw.x, raw.y, width, height);
      return {
        width,
        height,
        x: visible ? raw.x : undefined,
        y: visible ? raw.y : undefined,
        isMaximized: Boolean(raw.isMaximized),
      };
    }
  } catch (_) {}
  return def;
}

let saveWindowStateTimer = null;
function saveWindowState(win, immediate = false) {
  if (!win || win.isDestroyed()) return;
  const doWrite = () => {
    saveWindowStateTimer = null;
    if (!win || win.isDestroyed()) return;
    try {
      const isMax = win.isMaximized();
      const bounds = isMax ? win.getNormalBounds() : win.getBounds();
      fs.writeFileSync(
        WINDOW_STATE_PATH,
        JSON.stringify({
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y,
          isMaximized: isMax,
        }, null, 2),
        "utf-8"
      );
    } catch (_) {}
  };
  if (immediate) {
    if (saveWindowStateTimer) {
      clearTimeout(saveWindowStateTimer);
      saveWindowStateTimer = null;
    }
    doWrite();
    return;
  }
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(doWrite, 250);
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(350);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => { sock.destroy(); resolve(false); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.connect(port, "127.0.0.1");
  });
}

function httpGetOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function findVerifiedPython() {
  const candidates = [
    path.join(STUDIO_ROOT, ".venv", "Scripts", "python.exe"),
    path.join(STUDIO_ROOT, "venv", "Scripts", "python.exe"),
    "C:\\Users\\21815\\AppData\\Local\\Python\\bin\\python.exe",
  ];
  try {
    const out = execFileSync("where", ["python"], { encoding: "utf-8", windowsHide: true });
    for (const ln of out.split(/\r?\n/)) {
      const p = ln.trim();
      if (p && !p.toLowerCase().includes("windowsapps") && !candidates.includes(p)) {
        candidates.push(p);
      }
    }
  } catch (_) {}

  for (const py of candidates) {
    if (!fs.existsSync(py)) continue;
    try {
      execFileSync(py, ["-c", "import uvicorn, fastapi"], { timeout: 5000, windowsHide: true, stdio: "ignore" });
      return py;
    } catch (_) {}
  }
  return null;
}

async function ensureBackendRunning() {
  if (await isPortListening(PORT)) {
    const isVesperloom = await httpGetOk(`${BASE_URL}/api/mcp/info`);
    if (isVesperloom) {
      logDesktop(`Vesperloom backend already listening on 127.0.0.1:${PORT}; attaching.`);
      ownedBackend = false;
      return true;
    }
    throw new Error(
      `本地端口 ${PORT} 已被其他程序占用，无法启动 Vesperloom 后端服务。请关闭占用该端口的程序，或在 data/config.json 中修改 port 后重试。`
    );
  }

  const pyExe = findVerifiedPython();
  if (!pyExe) {
    throw new Error("未找到已安装 uvicorn 与 fastapi 的 Python 解释器。请运行 pip install -r requirements.txt。");
  }

  logDesktop(`Spawning backend with ${pyExe} on port ${PORT}`);
  const logStream = fs.createWriteStream(path.join(LOGS_DIR, "desktop_backend.log"), { flags: "a" });
  backendProc = spawn(
    pyExe,
    ["-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", String(PORT), "--log-level", "warning"],
    {
      cwd: STUDIO_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TMP: TMP_DIR,
        TEMP: TMP_DIR,
        TMPDIR: TMP_DIR,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUTF8: "1",
      },
    }
  );
  ownedBackend = true;
  backendProc.stdout.pipe(logStream);
  backendProc.stderr.pipe(logStream);
  backendProc.on("exit", (code) => {
    logDesktop(`Backend exited with code ${code}`);
    backendProc = null;
  });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await httpGetOk(`${BASE_URL}/api/models`)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 160));
  }
  throw new Error(`本地后端启动超时（${BASE_URL} 未响应）。请查看 logs/desktop_backend.log。`);
}

function stopBackendProcess() {
  if (!ownedBackend || !backendProc || !backendProc.pid) return;
  const pid = backendProc.pid;
  logDesktop(`Stopping owned backend PID ${pid}`);
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      backendProc.kill("SIGTERM");
    }
  } catch (_) {}
  backendProc = null;
  ownedBackend = false;
}

function resolveSplashArtFileUrl() {
  const cfg = readStudioConfig();
  const mode = String(cfg.splash_mode || "default").toLowerCase();
  const customRel = String(cfg.splash_custom_image || "").trim();
  if (mode === "custom" && customRel) {
    if (customRel.startsWith("splash:")) {
      const f = path.join(SPLASH_DIR, path.basename(customRel.slice(7)));
      if (fs.existsSync(f)) return pathToFileURL(f).href;
    } else {
      const fOut = path.join(OUTPUTS_DIR, customRel.replace(/^[/\\]+/, ""));
      if (fs.existsSync(fOut)) return pathToFileURL(fOut).href;
      const fSp = path.join(SPLASH_DIR, path.basename(customRel));
      if (fs.existsSync(fSp)) return pathToFileURL(fSp).href;
    }
  }
  if (mode === "favorites") {
    try {
      if (fs.existsSync(SPLASH_FAVORITES_CACHE)) {
        const list = JSON.parse(fs.readFileSync(SPLASH_FAVORITES_CACHE, "utf-8"));
        if (Array.isArray(list) && list.length) {
          const valid = list
            .map((rel) => path.join(OUTPUTS_DIR, String(rel || "").replace(/^[/\\]+/, "")))
            .filter((p) => {
              const resolved = path.resolve(p);
              return resolved.startsWith(path.resolve(OUTPUTS_DIR)) && fs.existsSync(resolved);
            });
          if (valid.length) {
            const pick = valid[Math.floor(Math.random() * valid.length)];
            return pathToFileURL(pick).href;
          }
        }
      }
    } catch (_) {}
  }
  return pathToFileURL(DEFAULT_SPLASH_PATH).href;
}

function syncChildViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getContentSize();
  const rect = { x: 0, y: 0, width: w, height: h };
  if (appView) appView.setBounds(rect);
  if (splashView) splashView.setBounds(rect);
}

let windowRevealed = false;
let splashDismissed = false;

function fadeInMainWindow(ws) {
  if (windowRevealed || !mainWindow || mainWindow.isDestroyed()) return;
  windowRevealed = true;
  splashShownAt = Date.now();
  try {
    mainWindow.setOpacity(0);
  } catch (_) {}
  if (ws && ws.isMaximized) mainWindow.maximize();
  syncChildViewBounds();
  mainWindow.show();
  mainWindow.focus();
  if (splashView) {
    try {
      splashView.webContents.send("splash:status", "__PLAY__");
    } catch (_) {}
  }
  // Smooth 140ms native window fade-in eliminates harsh DWM snap-in
  let step = 0;
  const totalSteps = 9;
  const timer = setInterval(() => {
    step += 1;
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    const t = Math.min(1, step / totalSteps);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    try {
      mainWindow.setOpacity(eased);
    } catch (_) {
      clearInterval(timer);
      return;
    }
    if (step >= totalSteps) clearInterval(timer);
  }, 16);
}

function dismissSplashSmoothly() {
  if (splashDismissed) return;
  splashDismissed = true;
  if (!splashView) {
    try { appView?.webContents.send("app:reveal"); } catch (_) {}
    return;
  }
  const minDisplayMs = 1650;
  const elapsed = splashShownAt ? (Date.now() - splashShownAt) : minDisplayMs;
  const waitMs = Math.max(0, minDisplayMs - elapsed);
  setTimeout(() => {
    // Synchronized dual-layer crossfade on the exact same tick
    try { appView?.webContents.send("app:reveal"); } catch (_) {}
    if (splashView) {
      try { splashView.webContents.send("splash:status", "__FADE_OUT__"); } catch (_) {}
    }
    // Wait 560ms (480ms dissolve + 80ms invisible buffer) before detaching splashView
    setTimeout(() => {
      if (!splashView) return;
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.contentView.removeChildView(splashView);
        }
        splashView.webContents.close();
      } catch (_) {}
      splashView = null;
    }, 560);
  }, waitMs);
}

/**
 * Industry-standard Single-Window Dual-WebContentsView architecture (Discord / Figma / Linear style):
 * - ONE opaque hardware-accelerated BrowserWindow at the exact final size (zero aspect jump, zero DWM lag!)
 * - Top `splashView` covers 100% of the window and plays pure-GPU 60fps Celestial Aperture reveal
 * - Bottom `appView` loads the real Vesperloom workbench silently underneath
 * - Once `appView` finishes first paint + minimum splash beat, `splashView` crossfades out and unmounts cleanly!
 */
function createUnifiedMainWindow() {
  const ws = loadWindowState();
  const cfg = readStudioConfig();
  const useSplash = cfg.splash_enabled !== false;

  mainWindow = new BrowserWindow({
    title: "Vesperloom — Obsidian Atelier",
    width: ws.width,
    height: ws.height,
    x: ws.x,
    y: ws.y,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    transparent: false,
    backgroundColor: IS_DARK ? "#060911" : "#f8fafc",
    icon: ICON_ICO_PATH,
    show: false,
  });

  // 1. Bottom Layer: Main Vesperloom Workbench WebContentsView
  appView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  appView.setBackgroundColor(IS_DARK ? "#060911" : "#f8fafc");
  mainWindow.contentView.addChildView(appView);

  appView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(BASE_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  appView.webContents.on("context-menu", (_ev, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { label: "剪切", role: "cut", enabled: params.editFlags.canCut },
        { label: "复制", role: "copy", enabled: params.editFlags.canCopy },
        { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { label: "全选", role: "selectAll" }
      );
    } else if (params.selectionText) {
      items.push({ label: "复制选中文本", role: "copy" });
    }
    if (params.mediaType === "image") {
      if (items.length) items.push({ type: "separator" });
      items.push({
        label: "复制图像",
        click: () => appView.webContents.copyImageAt(params.x, params.y),
      });
    }
    if (items.length) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow });
    }
  });

  // 2. Top Layer: Seamless Full-Window Splash Overlay (same exact aspect ratio & bounds!)
  if (useSplash) {
    splashView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    splashView.setBackgroundColor("#00000000");
    mainWindow.contentView.addChildView(splashView);
    const artUrl = resolveSplashArtFileUrl();
    ipcMain.once("splash:ready", () => fadeInMainWindow(ws));
    // Safety fallback if splash image takes too long
    setTimeout(() => fadeInMainWindow(ws), 650);
    splashView.webContents.loadFile(path.join(__dirname, "splash.html"), { query: { art: artUrl } });
  } else {
    syncChildViewBounds();
    if (ws.isMaximized) mainWindow.maximize();
    syncChildViewBounds();
    mainWindow.show();
    mainWindow.focus();
    windowRevealed = true;
  }

  syncChildViewBounds();

  mainWindow.on("resize", () => {
    syncChildViewBounds();
    saveWindowState(mainWindow);
  });
  mainWindow.on("move", () => saveWindowState(mainWindow));
  mainWindow.on("maximize", () => {
    syncChildViewBounds();
    appView?.webContents.send("window:maximized-changed", true);
    saveWindowState(mainWindow);
  });
  mainWindow.on("unmaximize", () => {
    syncChildViewBounds();
    appView?.webContents.send("window:maximized-changed", false);
    saveWindowState(mainWindow);
  });
  mainWindow.on("close", (e) => {
    saveWindowState(mainWindow, true);
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return appView;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(fs.existsSync(ICON_PNG_PATH) ? ICON_PNG_PATH : ICON_ICO_PATH);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`Vesperloom · 运行中 (127.0.0.1:${PORT} · MCP/A2A)`);
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);

  const menu = Menu.buildFromTemplate([
    { label: "打开 Vesperloom", click: showMainWindow },
    { label: "打开作品目录 (outputs)", click: () => shell.openPath(OUTPUTS_DIR) },
    { label: "打开日志目录 (logs)", click: () => shell.openPath(LOGS_DIR) },
    { label: "在浏览器中打开", click: () => shell.openExternal(BASE_URL) },
    { type: "separator" },
    {
      label: "重启本地后端服务",
      click: async () => {
        stopBackendProcess();
        try {
          await ensureBackendRunning();
          if (appView) appView.webContents.reload();
        } catch (err) {
          dialog.showErrorBox("Vesperloom 后端重启失败", String(err.message || err));
        }
      },
    },
    {
      label: "退出 Vesperloom（停止 MCP / A2A）",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// IPC handlers
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle("window:close", () => mainWindow?.close());
ipcMain.handle("window:is-maximized", () => Boolean(mainWindow?.isMaximized()));
ipcMain.handle("desktop:open-outputs", () => shell.openPath(OUTPUTS_DIR));
ipcMain.handle("desktop:open-external", (_ev, url) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  return false;
});
ipcMain.handle("desktop:get-info", () => ({
  isElectron: true,
  version: app.getVersion(),
  studioRoot: STUDIO_ROOT,
  userData: ELECTRON_DATA_DIR,
  baseUrl: BASE_URL,
}));

const gotLock = SMOKE_TEST ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(async () => {
    if (SMOKE_TEST) {
      try {
        await ensureBackendRunning();
        const okCard = await httpGetOk(`${BASE_URL}/.well-known/agent-card.json`);
        const okMcp = await httpGetOk(`${BASE_URL}/api/mcp/info`);
        console.log(
          `ELECTRON_SMOKE_OK: root=${STUDIO_ROOT} userData=${ELECTRON_DATA_DIR} port=${PORT} card=${okCard} mcp=${okMcp}`
        );
        stopBackendProcess();
        app.exit(okCard && okMcp ? 0 : 1);
      } catch (err) {
        console.error("ELECTRON_SMOKE_FAIL:", err.message || err);
        stopBackendProcess();
        app.exit(1);
      }
      return;
    }

    // Show the ONE unified window immediately (splashView covers 100% of exact final bounds!)
    createUnifiedMainWindow();
    createTray();

    try {
      await ensureBackendRunning();
      if (appView) {
        // Handle initial hydrated app:ready AND subsequent reloads (Ctrl+R / backend restart)
        ipcMain.on("app:ready", () => {
          if (!splashDismissed) {
            dismissSplashSmoothly();
          } else {
            try { appView?.webContents.send("app:reveal"); } catch (_) {}
          }
        });
        appView.webContents.once("did-finish-load", () => {
          setTimeout(() => dismissSplashSmoothly(), 4000);
        });
        appView.webContents.loadURL(BASE_URL);
      }
    } catch (err) {
      logDesktop(`Startup error: ${err.stack || err}`);
      dismissSplashSmoothly();
      dialog.showErrorBox("Vesperloom 启动失败", String(err.message || err));
      isQuitting = true;
      app.quit();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    saveWindowState(mainWindow, true);
    stopBackendProcess();
  });

  app.on("window-all-closed", () => {
    if (isQuitting) app.quit();
  });
}
