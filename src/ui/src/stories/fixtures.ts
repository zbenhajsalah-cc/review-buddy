import type { ResolvedFile, ResolvedReview } from "@review-buddy/core/types";
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
