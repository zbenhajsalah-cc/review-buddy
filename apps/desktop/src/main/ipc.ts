import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { IPC } from "../shared/ipc.ts";
import { parseDoneResult, type ReviewStore } from "./reviews.ts";

/**
 * Answers the preload's review calls. Only our own renderer page may call
 * (`isTrusted` checks the sending frame's URL); arguments are checked by the
 * store.
 */
export function registerReviewIpc(store: ReviewStore, isTrusted: (url: string) => boolean): void {
  const guard = (event: IpcMainInvokeEvent) => {
    const url = event.senderFrame?.url ?? "";
    if (!isTrusted(url)) throw new Error(`IPC from untrusted page: ${url}`);
  };

  ipcMain.handle(IPC.getReview, (event, reviewKey: unknown) => {
    guard(event);
    return store.getReview(reviewKey);
  });
  ipcMain.handle(IPC.getFileContent, (event, reviewKey: unknown, path: unknown, side: unknown) => {
    guard(event);
    return store.getFileContent(reviewKey, path, side);
  });
  ipcMain.handle(IPC.getConfig, (event) => {
    guard(event);
    return { roundtrip: false };
  });
  ipcMain.handle(IPC.done, (event, reviewKey: unknown, result: unknown) => {
    guard(event);
    store.getReview(reviewKey); // unknown review → error
    const { verdict } = parseDoneResult(result);
    // What "Done" does in desktop (mark finished, post to GitHub) is US-17/US-20.
    console.log(`[review-buddy] review ${String(reviewKey)} done${verdict ? `: ${verdict}` : ""}`);
  });
}
