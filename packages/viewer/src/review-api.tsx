/**
 * Where the viewer gets its data. The viewer never fetches by itself: each app
 * passes a `ReviewApi` to `<ReviewViewer api />` — the plugin over its
 * loopback HTTP server, the desktop app over Electron IPC.
 */
import type { DoneResult, ResolvedReview } from "@review-buddy/core/types";
import { createContext, type ReactNode, useContext } from "react";

export type { DoneResult };

export interface FileContent {
  path: string;
  side: "base" | "head";
  language: string;
  content: string;
}

export interface ReviewApi {
  /**
   * Stable id of this review. Viewed / collapsed file state is stored under it,
   * so two reviews never share state.
   */
  reviewKey: string;
  /** The resolved review (sources A + B). The viewer validates it before use. */
  getReview(): Promise<ResolvedReview>;
  /** Full file bytes for expansion (source C). content === "" means unavailable. */
  getFileContent(path: string, side: "base" | "head"): Promise<FileContent>;
  /** `roundtrip`: show "Request changes", and send the verdict and line comments with `done`. */
  getConfig(): Promise<{ roundtrip: boolean }>;
  /** The reviewer is finished (Done, or a verdict and comments when round-trip is on). */
  done(result: DoneResult): Promise<void>;
  /**
   * What the viewer does after `done`. "close" (the default, the plugin): the
   * review is over, so its viewed / collapsed state is cleared and the viewer
   * says it was submitted. "keep" (the desktop app, which keeps reviews): the
   * state stays and the review stays open, with the Done button showing it.
   */
  afterDone?: "close" | "keep";
}

const ReviewApiContext = createContext<ReviewApi | null>(null);

export function ReviewApiProvider({ api, children }: { api: ReviewApi; children: ReactNode }) {
  return <ReviewApiContext.Provider value={api}>{children}</ReviewApiContext.Provider>;
}

export function useReviewApi(): ReviewApi {
  const api = useContext(ReviewApiContext);
  if (!api) throw new Error("useReviewApi: no ReviewApi — render inside <ReviewViewer api />");
  return api;
}
