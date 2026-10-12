// Settings window and its IPC handlers.
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { IPC } from "../shared/ipc";
import { isProvider, type ProviderId } from "../shared/providers";
import type { ConnectionReport, Settings, SettingsSnapshot } from "../shared/types";
import { log } from "./log";

export interface SettingsBackend {
  snapshot(): SettingsSnapshot;
  save(settings: Settings, keys: Partial<Record<ProviderId, string>>): SettingsSnapshot;
  testConnection(): Promise<ConnectionReport[]>;
  listModels(provider: ProviderId): Promise<{ ok: boolean; models: string[]; message: string }>;
  forgetFact(id: string): SettingsSnapshot;
  clearMemory(): SettingsSnapshot;
  openDataFolder(): void;
  exportSprites(): { snapshot: SettingsSnapshot; message: string };
  openSpritesFolder(): void;
}

export class SettingsWindow {
  private win: BrowserWindow | null = null;

  constructor(backend: SettingsBackend) {
    const handle = <T>(channel: string, fn: (...args: unknown[]) => T) =>
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        if (!this.win || event.sender !== this.win.webContents) throw new Error("Not allowed");
        return fn(...args);
      });
    handle(IPC.settingsLoad, () => backend.snapshot());
    handle(IPC.settingsSave, (settings, keys) => {
      // Only well-formed key changes get through: provider id -> string
      const changes: Partial<Record<ProviderId, string>> = {};
      if (keys && typeof keys === "object") {
        for (const [id, value] of Object.entries(keys)) if (isProvider(id) && typeof value === "string") changes[id] = value;
      }
      return backend.save(settings as Settings, changes);
    });
    handle(IPC.settingsTest, () => backend.testConnection());
    handle(IPC.settingsListModels, (provider) => {
      if (!isProvider(provider)) throw new Error("Unknown provider");
      return backend.listModels(provider);
    });
    handle(IPC.settingsForget, (id) => backend.forgetFact(String(id)));
    handle(IPC.settingsClear, () => backend.clearMemory());
    handle(IPC.settingsOpenData, () => backend.openDataFolder());
    handle(IPC.settingsExportSprites, () => backend.exportSprites());
    handle(IPC.settingsOpenSprites, () => backend.openSpritesFolder());
  }

  open(): void {
    if (this.win) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.focus();
      return;
    }
    this.win = new BrowserWindow({
      width: 780,
      height: 760,
      minWidth: 560,
      minHeight: 500,
      title: "Impostazioni - Pixel Pet",
      backgroundColor: "#f6f3ff",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, "../preload/settings.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win.setMenu(null);
    this.win.webContents.on("console-message", (event) => {
      if (event.level === "error" || event.level === "warning") log.warn(`[settings window] ${event.message}`);
    });
    this.win.once("ready-to-show", () => this.win?.show());
    this.win.on("closed", () => {
      this.win = null;
    });
    void this.win.loadFile(join(__dirname, "../renderer/settings.html"));
  }
}
