import type { ResolvedFile, ResolvedReview } from "@review-buddy/core/types";
import type { ReviewApi } from "../review-api.tsx";
import { DEFAULT_SETTINGS } from "../settings.ts";

export { DEFAULT_SETTINGS };

export const fakeResolvedFile: ResolvedFile = {
  path: "src/example.ts",
  change_type: "modified",
  additions: 3,
  deletions: 1,
  language: "typescript",
  hunks: [
    {
      old_start: 10,
      old_lines: 3,
      new_start: 10,
      new_lines: 4,
      header: "@@ -10,3 +10,4 @@ export function greet() {",
      lines: [
        " export function greet() {",
        '-  return "hello";',
        '+  return "hello, world!";',
        " }",
      ],
    },
  ],
};

export const fakeAuthMiddlewareFile: ResolvedFile = {
  path: "src/server/auth/middleware.ts",
  change_type: "modified",
  additions: 12,
  deletions: 4,
  language: "typescript",
  hunks: [
    {
      old_start: 18,
      old_lines: 6,
      new_start: 18,
      new_lines: 9,
      header: "@@ -18,6 +18,9 @@ export async function authMiddleware(req: Request) {",
      lines: [
        " export async function authMiddleware(req: Request) {",
        "   const token = parseBearer(req.headers.get('authorization'));",
        "-  if (!token) return unauthorized();",
        "+  if (!token) {",
        "+    return unauthorized('missing_token');",
        "+  }",
        "   const session = await verifyToken(token);",
        "-  if (!session) return unauthorized();",
        "+  if (!session) return unauthorized('invalid_token');",
        "   return session;",
      ],
    },
    {
      old_start: 42,
      old_lines: 4,
      new_start: 45,
      new_lines: 5,
      header: "@@ -42,4 +45,5 @@ function unauthorized() {",
      lines: [
        "-function unauthorized() {",
        "+function unauthorized(reason: string) {",
        "+  console.warn('auth rejected:', reason);",
        "   return new Response('Unauthorized', { status: 401 });",
        " }",
      ],
    },
  ],
};

export const fakeSessionFile: ResolvedFile = {
  path: "src/server/auth/session.ts",
  change_type: "modified",
  additions: 8,
  deletions: 2,
  language: "typescript",
  hunks: [
    {
      old_start: 5,
      old_lines: 5,
      new_start: 5,
      new_lines: 8,
      header: "@@ -5,5 +5,8 @@ export async function verifyToken(token: string) {",
      lines: [
        " export async function verifyToken(token: string) {",
        "+  if (token.length < 32) {",
        "+    return null;",
        "+  }",
        "   const payload = await decodeJwt(token);",
        "-  return payload?.sub ? { userId: payload.sub } : null;",
        "+  return payload?.sub ? { userId: payload.sub, issuedAt: payload.iat } : null;",
      ],
    },
  ],
};

export const fakeBackoffFile: ResolvedFile = {
  path: "src/jobs/backoff.ts",
  change_type: "modified",
  additions: 4,
  deletions: 2,
  language: "typescript",
  hunks: [
    {
      old_start: 1,
      old_lines: 4,
      new_start: 1,
      new_lines: 5,
      header: "@@ -1,4 +1,5 @@ export const BACKOFF_MS = [",
      lines: [
        " export const BACKOFF_MS = [",
        "-  1000,",
        "+  2000,",
        "   5000,",
        "   15000,",
        "+  60000,",
        " ];",
      ],
    },
  ],
};

export const fakeResolvedReview: ResolvedReview = {
  meta: {
    aiGenerated: true,
    generatedBy: "claude-sonnet",
    generatedAt: "2026-07-08T12:00:00.000Z",
    promptVersion: "1.0",
  },
  pr: {
    title: "Add greeting suffix",
    description: "Updates the greet function to be friendlier.",
    author: "dev@example.com",
    createdAt: "2026-07-07T10:00:00.000Z",
    base: "main",
    head: "feature/greeting",
  },
  prologue: {
    why: "Users wanted a warmer greeting.",
    what: "Append a suffix to the default greeting string.",
    key_changes: [
      { headline: "Greeting text", detail: "Changed return value in `greet()`." },
      { headline: "Tests", detail: "Updated snapshot expectations." },
    ],
    review_focus: {
      summary: "Confirm the new string matches product copy.",
      file: "src/example.ts",
    },
  },
  stats: { additions: 12, deletions: 4, filesChanged: 3 },
  chapters: [
    {
      index: 1,
      title: "Update greeting copy",
      risk: "Low",
      risk_reason: "Single string change with test coverage.",
      additions: 3,
      deletions: 1,
      fileCount: 1,
      description: "Changes the default greeting to include a suffix.",
      files: [fakeResolvedFile],
    },
    {
      index: 2,
      title: "Refactor auth middleware",
      risk: "High",
      risk_reason: "Touches session validation on every request.",
      additions: 45,
      deletions: 12,
      fileCount: 2,
      description: "Rewires token parsing and error paths in the auth layer.",
      files: [fakeAuthMiddlewareFile, fakeSessionFile],
    },
    {
      index: 3,
      title: "Adjust retry backoff",
      risk: "Medium",
      risk_reason: "Changes timing constants used by the job queue.",
      additions: 8,
      deletions: 2,
      fileCount: 1,
      description: "Increases initial backoff to reduce thundering herds.",
      files: [fakeBackoffFile],
    },
  ],
  warnings: [],
};

/** The same review, with scope questions for the reviewer before the code. */
export const fakeReviewWithQuestions: ResolvedReview = {
  ...fakeResolvedReview,
  prologue: {
    ...fakeResolvedReview.prologue,
    open_questions: [
      {
        question: "The task was a greeting change. Should the auth refactor be its own PR?",
        context: "Chapter 2 rewires `middleware.ts`, which the PR description does not mention.",
      },
      { question: "Is a fixed backoff still right, now that `docs/QUEUE.md` asks for jitter?" },
    ],
  },
};

/** A review with CI checks from GitHub and the agent's reported checks. */
export const fakeReviewWithEvidence: ResolvedReview = {
  ...fakeResolvedReview,
  pr: {
    ...fakeResolvedReview.pr,
    url: "https://github.com/octocat/hello-world/pull/42",
    headRefOid: "7e8e70534d5fdb0a8ef1a5a0bf8407774b007b00",
    ciStatus: "1 failed, 1 pending, 12 passed",
    checks: [
      {
        name: "CI / test (windows)",
        status: "failed",
        url: "https://github.com/octocat/hello-world/actions/runs/1/job/3",
      },
      { name: "CI / e2e", status: "pending" },
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `CI / check ${i + 1}`,
        status: "passed" as const,
      })),
    ],
  },
  verification: {
    checks: [
      { command: "pnpm test:core", status: "passed", summary: "214 tests passed" },
      { command: "pnpm typecheck", status: "passed" },
      { command: "pnpm smoke:plugin", status: "not_run" },
      { command: "pnpm test:viewer", status: "failed", summary: "1 snapshot differs" },
    ],
    not_covered: "The Windows path handling was not run on Windows.",
  },
};

/** A review with findings of each severity, in and outside the diff. */
export const fakeReviewWithFindings: ResolvedReview = {
  ...fakeResolvedReview,
  findings: [
    {
      id: "f-0000aaaa",
      path: "src/server/auth/middleware.ts",
      line: 20,
      start_line: 19,
      side: "new",
      severity: "important",
      title: "An expired token is accepted when the clock skew is negative",
      body: "`skewMs` can be negative, so the check passes **after** expiry.",
      source: "/code-review",
      chapterIndex: 2,
    },
    {
      id: "f-0000bbbb",
      path: "src/server/auth/session.ts",
      line: 6,
      side: "new",
      severity: "nit",
      title: "Name the 30-minute constant",
      body: "A named constant reads better than `1800000`.",
      source: "/code-review",
      chapterIndex: 2,
    },
    {
      id: "f-0000cccc",
      path: "src/server/auth/session.ts",
      line: 120,
      side: "new",
      severity: "important",
      title: "The session cache is never cleared on logout",
      chapterIndex: 2,
      outsideDiff: true,
    },
    {
      id: "f-0000dddd",
      path: "src/legacy/cookies.ts",
      line: 14,
      side: "new",
      severity: "pre_existing",
      title: "Cookies are set without SameSite",
      body: "Not from this change, but the new middleware reads these cookies.",
      source: "/security-review",
    },
  ],
};

/**
 * Round 2 of the same change: the agent touched the auth middleware again, so
 * that file is new work; the others keep the marks the reviewer gave them.
 */
export const fakeReviewRoundTwo: ResolvedReview = {
  ...fakeResolvedReview,
  round: {
    number: 2,
    changedPaths: ["src/server/auth/middleware.ts"],
    viewedPaths: ["src/example.ts", "src/server/auth/session.ts", "src/jobs/backoff.ts"],
    previousComments: [
      {
        chapterIndex: 2,
        path: "src/server/auth/middleware.ts",
        side: "new",
        line: 20,
        body: "This accepts an expired token when the skew is negative.",
        status: "lines_changed",
      },
      {
        chapterIndex: 3,
        path: "src/jobs/backoff.ts",
        side: "new",
        line: 3,
        body: "Where does 500ms come from?",
        status: "lines_unchanged",
      },
    ],
  },
};

/**
 * In-memory ReviewApi for stories and tests. Serves `review`, never touches the
 * network, and returns "" (unavailable) for any file not in `files`.
 */
export function fakeReviewApi(
  options: {
    review?: ResolvedReview;
    files?: Record<string, string>;
    roundtrip?: boolean;
    overrides?: Partial<ReviewApi>;
  } = {},
): ReviewApi {
  const { review = fakeResolvedReview, files = {}, roundtrip = false, overrides } = options;
  return {
    reviewKey: "fake-review",
    getReview: async () => review,
    getFileContent: async (path, side) => ({
      path,
      side,
      language: "",
      content: files[`${side}:${path}`] ?? "",
    }),
    getConfig: async () => ({ roundtrip }),
    done: async () => {},
    ...overrides,
  };
}
