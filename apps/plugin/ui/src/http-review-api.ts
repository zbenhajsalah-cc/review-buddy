/**
 * The plugin's ReviewApi: the viewer talks to the loopback server that the
 * hook (or standalone submit_review) started. All /api/* calls carry the
 * per-server token from the browser URL (?token=...); the server rejects
 * /api/* without it.
 */
import type { ResolvedReview } from "@review-buddy/core/types";
import type { DoneResult, FileContent, ReviewApi } from "@review-buddy/viewer";
import { authHeaders, getReviewToken } from "./session.ts";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const httpReviewApi: ReviewApi = {
  // One server = one review, and the token is unique per server, so it keys
  // this review's viewed / collapsed state (same keys as before the split).
  reviewKey: getReviewToken() || "notoken",

  getReview: () => getJSON<ResolvedReview>("/api/review"),

  getFileContent: (path, side) =>
    getJSON<FileContent>(`/api/file-content?path=${encodeURIComponent(path)}&side=${side}`),

  getConfig: () => getJSON<{ roundtrip: boolean }>("/api/config"),

  async done(result: DoneResult) {
    const res = await fetch("/api/done", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify(result),
    });
    if (!res.ok) {
      throw new Error(`/api/done → ${res.status} ${res.statusText}`);
    }
  },
};
