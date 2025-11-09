import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tabsync", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  toggleAutoLaunch: (enabled) =>
    ipcRenderer.invoke("toggle-auto-launch", enabled),
});

contextBridge.exposeInMainWorld("electronAPI", {
  openExternal: (url) => ipcRenderer.send("open-external", url),
});
