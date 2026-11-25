const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("naiDesktop", {
  isElectron: true,
  platform: process.platform,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizeChange: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_ev, val) => cb(Boolean(val));
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.removeListener("window:maximized-changed", handler);
  },
  openOutputsFolder: () => ipcRenderer.invoke("desktop:open-outputs"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", String(url || "")),
  getAppInfo: () => ipcRenderer.invoke("desktop:get-info"),
  onSplashStatus: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_ev, text) => cb(String(text || ""));
    ipcRenderer.on("splash:status", handler);
    return () => ipcRenderer.removeListener("splash:status", handler);
  },
});
