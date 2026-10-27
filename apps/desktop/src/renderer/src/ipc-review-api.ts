import type { ReviewApi } from "@review-buddy/viewer";
import type { ReviewBridge } from "../../shared/ipc.ts";

/**
 * The viewer's `ReviewApi` over Electron IPC: every call goes through the
 * preload's bridge to main, tagged with the review it is about. The app keeps
 * reviews, so Done keeps the viewed / collapsed state (`afterDone: "keep"`):
 * a review can be continued later, also after a restart (US-17).
 */
export function ipcReviewApi(bridge: ReviewBridge, reviewKey: string): ReviewApi {
  return {
    reviewKey,
    getReview: () => bridge.getReview(reviewKey),
    getFileContent: (path, side) => bridge.getFileContent(reviewKey, path, side),
    getConfig: () => bridge.getConfig(),
    done: (result) => bridge.done(reviewKey, result),
    afterDone: "keep",
  };
}
