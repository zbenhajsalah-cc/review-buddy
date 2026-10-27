/**
 * Plugin test fixtures. The canonical temp repo (makeTempRepo / testGit) lives
 * in core, shared with core's git tests; `sampleReview()` is the AgentReview
 * payload matching its pending edit. Keep the two in sync.
 */
import type { AgentReview } from "@review-buddy/core/types";

export { makeTempRepo, testGit } from "@review-buddy/core/node/test-repo";

/** AgentReview payload matching makeTempRepo's pending edit. */
export function sampleReview(overrides: Partial<AgentReview> = {}): AgentReview {
  return {
    prologue: {
      why: "y is wrong",
      what: "fix y and add z",
      key_changes: [
        { headline: "Fix y", detail: "20 not 2" },
        { headline: "Add z", detail: "new binding" },
      ],
      review_focus: { summary: "check z is used", file: "app.ts" },
    },
    chapters: [
      {
        index: 1,
        title: "Adjust bindings",
        risk: "Low",
        risk_reason: "tiny",
        description: "edits y and adds z",
        files: [{ path: "app.ts", change_type: "modified" }],
      },
    ],
    ...overrides,
  };
}

/** The viewer URL startServer produces: [1] = port, [2] = token. */
export const VIEWER_URL_RE = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([\w-]+)/;
