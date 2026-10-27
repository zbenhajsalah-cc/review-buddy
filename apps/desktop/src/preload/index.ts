/**
 * Runs in the sandboxed renderer before the page. It exposes only the calls
 * below — never `ipcRenderer` itself — so the page cannot send on any other
 * channel. Built as CommonJS: sandboxed preloads cannot load ES modules.
 */
import { contextBridge, ipcRenderer } from "electron";
import { type DesktopBridge, IPC } from "../shared/ipc.ts";

const bridge: DesktopBridge = {
  review: {
    getReview: (reviewKey) => ipcRenderer.invoke(IPC.getReview, reviewKey),
    getFileContent: (reviewKey, path, side) =>
      ipcRenderer.invoke(IPC.getFileContent, reviewKey, path, side),
    getConfig: () => ipcRenderer.invoke(IPC.getConfig),
    done: (reviewKey, result) => ipcRenderer.invoke(IPC.done, reviewKey, result),
  },
  github: {
    status: () => ipcRenderer.invoke(IPC.githubStatus),
    signInWithToken: (token) => ipcRenderer.invoke(IPC.githubSignInWithToken, token),
    useGh: () => ipcRenderer.invoke(IPC.githubUseGh),
    signOut: () => ipcRenderer.invoke(IPC.githubSignOut),
  },
};

contextBridge.exposeInMainWorld("reviewBuddy", bridge);
