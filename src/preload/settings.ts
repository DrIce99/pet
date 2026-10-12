// Exposes the settings window's IPC as `window.settingsApi`.
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type { SettingsBridge } from "../shared/types";

const bridge: SettingsBridge = {
  load: () => ipcRenderer.invoke(IPC.settingsLoad),
  save: (settings, keys) => ipcRenderer.invoke(IPC.settingsSave, settings, keys),
  testConnection: () => ipcRenderer.invoke(IPC.settingsTest),
  listModels: (provider) => ipcRenderer.invoke(IPC.settingsListModels, provider),
  forgetFact: (id) => ipcRenderer.invoke(IPC.settingsForget, id),
  clearMemory: () => ipcRenderer.invoke(IPC.settingsClear),
  openDataFolder: () => ipcRenderer.invoke(IPC.settingsOpenData),
  exportSprites: () => ipcRenderer.invoke(IPC.settingsExportSprites),
  openSpritesFolder: () => ipcRenderer.invoke(IPC.settingsOpenSprites),
};

contextBridge.exposeInMainWorld("settingsApi", bridge);
