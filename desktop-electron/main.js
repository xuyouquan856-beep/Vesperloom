const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog } = require("electron");
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
const ICON_ICO_PATH = path.join(__dirname, "assets", "vesperloom.ico");
const ICON_PNG_PATH = path.join(__dirname, "assets", "vesperloom_icon.png");
const DEFAULT_SPLASH_PATH = path.join(__dirname, "assets", "default_splash.jpg");

for (const d of [DATA_DIR, OUTPUTS_DIR, TMP_DIR, LOGS_DIR, ELECTRON_DATA_DIR]) {
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
let splashWindow = null;
let tray = null;
let backendProc = null;
let ownedBackend = false;
let isQuitting = false;

function logDesktop(msg) {
  const line = `${new Date().toISOString()} [desktop] ${msg}\n`;
  try {
    fs.appendFileSync(path.join(LOGS_DIR, "desktop_electron.log"), line, "utf-8");
  } catch (_) {}
}

function loadWindowState() {
  const def = { width: 1480, height: 920, x: undefined, y: undefined, isMaximized: false };
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, "utf-8"));
      return {
        width: Math.max(1080, Math.min(3840, Number(raw.width) || 1480)),
        height: Math.max(700, Math.min(2160, Number(raw.height) || 920)),
        x: typeof raw.x === "number" && raw.x >= -100 && raw.x <= 3600 ? raw.x : undefined,
        y: typeof raw.y === "number" && raw.y >= -50 && raw.y <= 2000 ? raw.y : undefined,
        isMaximized: Boolean(raw.isMaximized),
      };
    }
  } catch (_) {}
  return def;
}

function saveWindowState(win) {
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

function setSplashStatus(text) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("splash:status", text);
  }
}

async function ensureBackendRunning() {
  if (await isPortListening(PORT)) {
    logDesktop(`Backend already listening on 127.0.0.1:${PORT}; attaching.`);
    ownedBackend = false;
    return true;
  }

  const pyExe = findVerifiedPython();
  if (!pyExe) {
    throw new Error("未找到已安装 uvicorn 与 fastapi 的 Python 解释器。请运行 pip install -r requirements.txt。");
  }

  setSplashStatus(`正在启动本地后端 (${PORT})...`);
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
      setSplashStatus("引擎就绪，正在载入工作台...");
      return true;
    }
    await new Promise((r) => setTimeout(r, 180));
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

let splashShownAt = 0;

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
      // Lightweight recursive pick of recent outputs PNGs if favorites mode is enabled before backend is up
      const dayDirs = fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, 6);
      const candidates = [];
      for (const dd of dayDirs) {
        const fullDir = path.join(OUTPUTS_DIR, dd);
        for (const fn of fs.readdirSync(fullDir)) {
          if (/\.(png|jpg|jpeg|webp)$/i.test(fn)) candidates.push(path.join(fullDir, fn));
        }
      }
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        return pathToFileURL(pick).href;
      }
    } catch (_) {}
  }
  return pathToFileURL(DEFAULT_SPLASH_PATH).href;
}

function createSplashWindow() {
  const cfg = readStudioConfig();
  if (cfg.splash_enabled === false) return;
  splashShownAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 740,
    height: 416,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: ICON_ICO_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const artUrl = resolveSplashArtFileUrl();
  splashWindow.loadFile(path.join(__dirname, "splash.html"), { query: { art: artUrl } });
}

function createMainWindow() {
  const ws = loadWindowState();
  mainWindow = new BrowserWindow({
    title: "Vesperloom — Obsidian Atelier",
    width: ws.width,
    height: ws.height,
    x: ws.x,
    y: ws.y,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    backgroundColor: IS_DARK ? "#0c0f16" : "#f8fafc",
    icon: ICON_ICO_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(BASE_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("context-menu", (_ev, params) => {
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
        click: () => mainWindow.webContents.copyImageAt(params.x, params.y),
      });
    }
    if (items.length) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow });
    }
  });

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized-changed", true);
    saveWindowState(mainWindow);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized-changed", false);
    saveWindowState(mainWindow);
  });
  mainWindow.on("resize", () => saveWindowState(mainWindow));
  mainWindow.on("move", () => saveWindowState(mainWindow));

  mainWindow.on("close", (e) => {
    saveWindowState(mainWindow);
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.once("ready-to-show", () => {
    const revealMain = () => {
      if (ws.isMaximized) mainWindow.maximize();
      mainWindow.show();
      mainWindow.focus();
    };
    if (splashWindow && !splashWindow.isDestroyed()) {
      const minDisplayMs = 1750;
      const waitMs = Math.max(0, minDisplayMs - (Date.now() - splashShownAt));
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.webContents.send("splash:status", "__FADE_OUT__");
        }
        setTimeout(() => {
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
            splashWindow = null;
          }
          revealMain();
        }, 360);
      }, waitMs);
    } else {
      revealMain();
    }
  });

  mainWindow.loadURL(BASE_URL);
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
    { label: "在浏览器中打开", click: () => shell.openExternal(BASE_URL) },
    { type: "separator" },
    {
      label: "重启本地后端服务",
      click: async () => {
        stopBackendProcess();
        try {
          await ensureBackendRunning();
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
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

// IPC handlers for frameless window controls & desktop actions
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

// Single-instance lock (skip only during isolated smoke test)
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

    createSplashWindow();
    try {
      await ensureBackendRunning();
      createTray();
      createMainWindow();
    } catch (err) {
      logDesktop(`Startup error: ${err.stack || err}`);
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      dialog.showErrorBox("NAI Studio 启动失败", String(err.message || err));
      isQuitting = true;
      app.quit();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    saveWindowState(mainWindow);
    stopBackendProcess();
  });

  app.on("window-all-closed", () => {
    if (isQuitting) app.quit();
  });
}
