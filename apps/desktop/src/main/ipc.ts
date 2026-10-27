import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { IPC } from "../shared/ipc.ts";
import type { GitHubAuth } from "./github/auth.ts";
import { parseDoneResult, type ReviewStore } from "./reviews.ts";

type Handler = (...args: unknown[]) => unknown;

/**
 * Registers handlers that answer only our own renderer page (`isTrusted`
 * checks the sending frame's URL). Arguments are checked by the handlers.
 */
function handle(channel: string, isTrusted: (url: string) => boolean, handler: Handler): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const url = event.senderFrame?.url ?? "";
    if (!isTrusted(url)) throw new Error(`IPC from untrusted page: ${url}`);
    return handler(...args);
  });
}

/** Answers the preload's review calls. */
export function registerReviewIpc(store: ReviewStore, isTrusted: (url: string) => boolean): void {
  handle(IPC.getReview, isTrusted, (reviewKey) => store.getReview(reviewKey));
  handle(IPC.getFileContent, isTrusted, (reviewKey, path, side) =>
    store.getFileContent(reviewKey, path, side),
  );
  handle(IPC.getConfig, isTrusted, () => ({ roundtrip: false }));
  handle(IPC.done, isTrusted, (reviewKey, result) => {
    store.getReview(reviewKey); // unknown review → error
    const { verdict } = parseDoneResult(result);
    // What "Done" does in desktop (mark finished, post to GitHub) is US-17/US-20.
    console.log(`[review-buddy] review ${String(reviewKey)} done${verdict ? `: ${verdict}` : ""}`);
  });
}

/** Answers the settings view. Every answer is a GitHubStatus: never the token. */
export function registerGitHubIpc(auth: GitHubAuth, isTrusted: (url: string) => boolean): void {
  handle(IPC.githubStatus, isTrusted, () => auth.status());
  handle(IPC.githubSignInWithToken, isTrusted, (token) => auth.signInWithToken(token));
  handle(IPC.githubUseGh, isTrusted, () => auth.useGh());
  handle(IPC.githubSignOut, isTrusted, () => auth.signOut());
}
