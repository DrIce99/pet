// Exposes the pet window's IPC as `window.pet`.
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type { PetBridge } from "../shared/types";

const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void): void => {
    ipcRenderer.on(channel, (_event, payload: T) => cb(payload));
  };

const bridge: PetBridge = {
  onLayout: listen(IPC.layout),
  onVisual: listen(IPC.visual),
  onLook: listen(IPC.look),
  onEffect: listen(IPC.effect),
  onBubbleStart: listen(IPC.bubbleStart),
  onBubbleChunk: listen(IPC.bubbleChunk),
  onBubbleEnd: listen(IPC.bubbleEnd),
  onBubbleHide: listen(IPC.bubbleHide),
  onInputOpen: listen(IPC.inputOpen),
  onInputClose: listen(IPC.inputClose),
  onSpritePack: listen(IPC.spritePack),
  ready: () => ipcRenderer.send(IPC.ready),
  setInteractive: (interactive) => ipcRenderer.send(IPC.interactive, interactive),
  click: () => ipcRenderer.send(IPC.click),
  petted: () => ipcRenderer.send(IPC.petted),
  dragStart: () => ipcRenderer.send(IPC.dragStart),
  dragEnd: () => ipcRenderer.send(IPC.dragEnd),
  contextMenu: () => ipcRenderer.send(IPC.contextMenu),
  send: (text) => ipcRenderer.send(IPC.send, text),
  closeInput: () => ipcRenderer.send(IPC.closeInput),
  bubbleClicked: () => ipcRenderer.send(IPC.bubbleClicked),
};

contextBridge.exposeInMainWorld("pet", bridge);
