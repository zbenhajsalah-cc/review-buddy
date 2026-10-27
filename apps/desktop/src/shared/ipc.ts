/**
 * The IPC contract between main and the renderer. The preload script exposes
 * a `ReviewBridge` as `window.reviewBuddy`; the renderer wraps it in a
 * `ReviewApi` for the viewer (renderer/src/ipc-review-api.ts). Types only, plus
 * the channel names: both sides import this file, so they cannot drift.
 */
import type { ResolvedReview } from "@review-buddy/core/types";

export const IPC = {
  getReview: "review:get",
  getFileContent: "review:file-content",
  getConfig: "review:config",
  done: "review:done",
} as const;

/** The review main loads at startup until the PR screens exist (US-13/14). */
export const FIXTURE_REVIEW_KEY = "fixture";

export type FileSide = "base" | "head";

export interface IpcFileContent {
  path: string;
  side: FileSide;
  language: string;
  /** "" means unavailable. */
  content: string;
}

export interface IpcDoneResult {
  verdict?: "approve" | "request_changes";
  summary?: string;
}

/** What the preload script exposes. Every call names the review it is about. */
export interface ReviewBridge {
  getReview(reviewKey: string): Promise<ResolvedReview>;
  getFileContent(reviewKey: string, path: string, side: FileSide): Promise<IpcFileContent>;
  getConfig(): Promise<{ roundtrip: boolean }>;
  done(reviewKey: string, result: IpcDoneResult): Promise<void>;
}
