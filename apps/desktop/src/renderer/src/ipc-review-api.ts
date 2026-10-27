import type { ReviewApi } from "@review-buddy/viewer";
import type { ReviewBridge } from "../../shared/ipc.ts";

/**
 * The viewer's `ReviewApi` over Electron IPC: every call goes through the
 * preload's bridge to main, tagged with the review it is about.
 */
export function ipcReviewApi(bridge: ReviewBridge, reviewKey: string): ReviewApi {
  return {
    reviewKey,
    getReview: () => bridge.getReview(reviewKey),
    getFileContent: (path, side) => bridge.getFileContent(reviewKey, path, side),
    getConfig: () => bridge.getConfig(),
    done: (result) => bridge.done(reviewKey, result),
  };
}
