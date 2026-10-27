/**
 * Runs in the sandboxed renderer before the page. It exposes only the review
 * calls below — never `ipcRenderer` itself — so the page cannot send on any
 * other channel. Built as CommonJS: sandboxed preloads cannot load ES modules.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type ReviewBridge } from "../shared/ipc.ts";

const bridge: ReviewBridge = {
  getReview: (reviewKey) => ipcRenderer.invoke(IPC.getReview, reviewKey),
  getFileContent: (reviewKey, path, side) =>
    ipcRenderer.invoke(IPC.getFileContent, reviewKey, path, side),
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  done: (reviewKey, result) => ipcRenderer.invoke(IPC.done, reviewKey, result),
};

contextBridge.exposeInMainWorld("reviewBuddy", bridge);
