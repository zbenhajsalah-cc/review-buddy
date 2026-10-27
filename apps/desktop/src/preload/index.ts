/**
 * Runs in the sandboxed renderer before the page. It exposes only the calls
 * below — never `ipcRenderer` itself — so the page cannot send on any other
 * channel, and hears only the job list event. Built as CommonJS: sandboxed
 * preloads cannot load ES modules.
 */
import { contextBridge, ipcRenderer } from "electron";
import { type DesktopBridge, IPC, type ReviewJobStatus } from "../shared/ipc.ts";

const bridge: DesktopBridge = {
  review: {
    getReview: (reviewKey) => ipcRenderer.invoke(IPC.getReview, reviewKey),
    getFileContent: (reviewKey, path, side) =>
      ipcRenderer.invoke(IPC.getFileContent, reviewKey, path, side),
    getConfig: () => ipcRenderer.invoke(IPC.getConfig),
    done: (reviewKey, result) => ipcRenderer.invoke(IPC.done, reviewKey, result),
    start: (pr, options) => ipcRenderer.invoke(IPC.startReview, pr, options),
    stop: (id) => ipcRenderer.invoke(IPC.stopReview, id),
    jobs: () => ipcRenderer.invoke(IPC.reviewJobs),
    saved: () => ipcRenderer.invoke(IPC.savedReviews),
    deleteSaved: (reviewKey) => ipcRenderer.invoke(IPC.deleteSavedReview, reviewKey),
    deleteAllSaved: () => ipcRenderer.invoke(IPC.deleteAllSavedReviews),
    onJobs: (listener) => {
      // The page gets the job list only, never the IPC event.
      const handler = (_event: unknown, jobs: ReviewJobStatus[]) => listener(jobs);
      ipcRenderer.on(IPC.reviewJobsChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.reviewJobsChanged, handler);
      };
    },
  },
  github: {
    status: () => ipcRenderer.invoke(IPC.githubStatus),
    signInWithToken: (token) => ipcRenderer.invoke(IPC.githubSignInWithToken, token),
    useGh: () => ipcRenderer.invoke(IPC.githubUseGh),
    signOut: () => ipcRenderer.invoke(IPC.githubSignOut),
    repos: (page) => ipcRenderer.invoke(IPC.githubRepos, page),
    markRepoUsed: (fullName) => ipcRenderer.invoke(IPC.githubMarkRepoUsed, fullName),
    pulls: (fullName, page) => ipcRenderer.invoke(IPC.githubPulls, fullName, page),
  },
};

contextBridge.exposeInMainWorld("reviewBuddy", bridge);
