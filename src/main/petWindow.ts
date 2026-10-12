// The transparent, click-through, always-on-top window the pet lives in.
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { join } from "node:path";
import { IPC } from "../shared/ipc";
import type { SpritePack } from "../shared/sprite";
import type { BubbleChunk, BubbleEnd, BubbleStart, LookDirection, OneShotEffect, PetLayout, VisualState } from "../shared/types";
import { log } from "./log";

export interface PetWindowHandlers {
  ready(): void;
  click(): void;
  petted(): void;
  dragStart(): void;
  dragEnd(): void;
  contextMenu(): void;
  send(text: string): void;
  inputClosed(): void;
  bubbleClicked(): void;
}

export class PetWindow {
  readonly win: BrowserWindow;
  private inputOpen = false;

  constructor(handlers: PetWindowHandlers, hideFromCapture: boolean) {
    this.win = new BrowserWindow({
      width: 340,
      height: 440,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Clicking the pet must not steal focus from the user's work; the
      // window becomes focusable only while the chat input is open.
      focusable: false,
      title: "Pixel Pet",
      webPreferences: {
        preload: join(__dirname, "../preload/pet.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.setHiddenFromCapture(hideFromCapture);
    this.win.once("ready-to-show", () => {
      this.win.showInactive();
      log.info(`Pet window shown (visible: ${this.win.isVisible()})`);
    });
    const contents = this.win.webContents;
    contents.on("console-message", (event) => {
      if (event.level === "error" || event.level === "warning") log.warn(`[pet window] ${event.message}`);
    });
    contents.on("preload-error", (_event, preloadPath, error) => log.error(`Preload ${preloadPath} failed`, error));
    contents.on("render-process-gone", (_event, details) => log.error(`Pet renderer gone: ${details.reason}`));
    void this.win.loadFile(join(__dirname, "../renderer/pet.html"));

    const on = (channel: string, fn: (event: IpcMainEvent, ...args: unknown[]) => void) =>
      ipcMain.on(channel, (event, ...args) => {
        if (event.sender === this.win.webContents) fn(event, ...args);
      });
    on(IPC.ready, () => handlers.ready());
    on(IPC.interactive, (_e, interactive) => this.win.setIgnoreMouseEvents(interactive !== true, { forward: true }));
    on(IPC.click, () => handlers.click());
    on(IPC.petted, () => handlers.petted());
    on(IPC.dragStart, () => handlers.dragStart());
    on(IPC.dragEnd, () => handlers.dragEnd());
    on(IPC.contextMenu, () => handlers.contextMenu());
    on(IPC.send, (_e, text) => {
      if (typeof text === "string" && text.trim()) handlers.send(text.trim().slice(0, 4000));
    });
    on(IPC.closeInput, () => {
      this.releaseFocus();
      handlers.inputClosed();
    });
    on(IPC.bubbleClicked, () => handlers.bubbleClicked());
  }

  isInputOpen(): boolean {
    return this.inputOpen;
  }

  openInput(): void {
    if (!this.win.isVisible()) this.win.showInactive();
    this.inputOpen = true;
    this.win.setFocusable(true);
    this.win.focus();
    this.send(IPC.inputOpen);
    setTimeout(() => {
      if (!this.win.isDestroyed()) log.info(`Chat input opened (keyboard focus: ${this.win.isFocused()})`);
    }, 400);
  }

  closeInput(): void {
    this.send(IPC.inputClose);
    this.releaseFocus();
  }

  setHiddenFromCapture(hidden: boolean): void {
    // Keeps the pet out of its own screenshots and of the user's screen shares
    this.win.setContentProtection(hidden);
  }

  layout(layout: PetLayout): void {
    this.send(IPC.layout, layout);
  }

  visual(visual: VisualState): void {
    this.send(IPC.visual, visual);
  }

  look(look: LookDirection): void {
    this.send(IPC.look, look);
  }

  /** A hand-drawn sprite pack (null: the sprites drawn by code). */
  spritePack(pack: SpritePack | null): void {
    this.send(IPC.spritePack, pack);
  }

  effect(effect: OneShotEffect): void {
    this.send(IPC.effect, effect);
  }

  bubbleStart(msg: BubbleStart): void {
    this.send(IPC.bubbleStart, msg);
  }

  bubbleChunk(msg: BubbleChunk): void {
    this.send(IPC.bubbleChunk, msg);
  }

  bubbleEnd(msg: BubbleEnd): void {
    this.send(IPC.bubbleEnd, msg);
  }

  bubbleHide(): void {
    this.send(IPC.bubbleHide);
  }

  private releaseFocus(): void {
    if (!this.inputOpen) return;
    this.inputOpen = false;
    this.win.setFocusable(false);
    this.win.blur();
  }

  private send(channel: string, payload?: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }
}
