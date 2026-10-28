import { z } from "zod";
import type { DoneResult } from "./types.ts";

const KeyChange = z.object({ headline: z.string(), detail: z.string() });
const ReviewFocus = z.object({ summary: z.string(), file: z.string() });
const Prologue = z.object({
  why: z.string(),
  what: z.string(),
  key_changes: z.array(KeyChange),
  review_focus: ReviewFocus,
});
const Hunk = z.object({ old_start: z.number(), new_start: z.number() });
const AgentFile = z.object({
  path: z.string(),
  change_type: z.string(),
  hunks: z.array(Hunk).max(5000).optional(),
});
const Chapter = z.object({
  index: z.number().int().min(1),
  title: z.string(),
  risk: z.enum(["Low", "Medium", "High"]),
  risk_reason: z.string(),
  description: z.string(),
  files: z.array(AgentFile).min(1).max(2000),
});
const Source = z
  .object({
    type: z.enum(["worktree", "pr", "branch"]),
    ref: z.string().min(1).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.type !== "worktree" && !s.ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ref"],
        message: `source.ref is required when source.type is "${s.type}"`,
      });
    }
  });

/** Structural schema for the agent's review payload (hook backstop; mirrors the
 *  load-bearing constraints of ../schemas/review.schema.json, not every field).
 *  When present, `source` is validated; unknown keys (e.g. advisory `stats`) are
 *  ignored, not rejected. */
export const AgentReviewSchema = z.object({
  prologue: Prologue,
  chapters: z.array(Chapter).min(1).max(500),
  source: Source.optional(),
});

const describeIssues = (error: z.ZodError): string =>
  error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

/**
 * Validate an agent review payload. Returns a concise human-readable reason on
 * failure, or null when the payload is usable. Never throws.
 */
export function validateAgentReview(agent: unknown): string | null {
  const parsed = AgentReviewSchema.safeParse(agent);
  if (parsed.success) return null;
  return describeIssues(parsed.error);
}

const CommentSide = z.enum(["old", "new"]);
const LineNumber = z.number().int().min(1);
// Generous limits: no reviewer reaches them, and the text the agent gets is
// cut much shorter anyway (messages.ts).
const ReviewCommentSchema = z.object({
  chapterIndex: z.number().int().min(1),
  path: z.string().min(1).max(4096),
  side: CommentSide,
  line: LineNumber,
  startSide: CommentSide.optional(),
  startLine: LineNumber.optional(),
  body: z.string().max(50_000),
});

/** Shape of POST /api/done. Unknown keys are dropped. */
export const DoneResultSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]).optional(),
  summary: z.string().max(50_000).optional(),
  comments: z.array(ReviewCommentSchema).max(2000).optional(),
});

/**
 * Parse what the viewer sent when the reviewer finished. Returns the result,
 * or a short reason when it is malformed. Never throws.
 */
export function parseDoneResult(
  body: unknown,
): { ok: true; value: DoneResult } | { ok: false; error: string } {
  const parsed = DoneResultSchema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: describeIssues(parsed.error) };
}
