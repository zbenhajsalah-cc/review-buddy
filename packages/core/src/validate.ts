import { z } from "zod";
import type { DoneResult } from "./types.ts";
import { MAX_FINDING_REASON } from "./types.ts";

const KeyChange = z.object({ headline: z.string(), detail: z.string() });
const ReviewFocus = z.object({ summary: z.string(), file: z.string() });
const OpenQuestion = z.object({
  question: z.string().trim().min(1, "must not be empty"),
  context: z.string().optional(),
});
const Prologue = z.object({
  why: z.string(),
  what: z.string(),
  key_changes: z.array(KeyChange),
  review_focus: ReviewFocus,
  open_questions: z.array(OpenQuestion).max(3).optional(),
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

const VerificationCheck = z.object({
  command: z.string().trim().min(1, "must not be empty").max(500),
  status: z.enum(["passed", "failed", "not_run"]),
  summary: z.string().max(200, "one short line (at most 200 characters)").optional(),
});
const Verification = z.object({
  checks: z.array(VerificationCheck).max(20).optional(),
  not_covered: z.string().max(5000).optional(),
});

const Finding = z
  .object({
    path: z.string().trim().min(1, "must not be empty").max(4096),
    line: z.number().int().min(1),
    start_line: z.number().int().min(1).optional(),
    side: z.enum(["old", "new"]).optional(),
    severity: z.enum(["important", "nit", "pre_existing"]),
    title: z
      .string()
      .trim()
      .min(1, "must not be empty")
      .max(200, "one line (at most 200 characters)"),
    body: z.string().max(1000).optional(),
    source: z.string().max(100).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.start_line !== undefined && f.start_line > f.line) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["start_line"],
        message: "start_line must not be after line",
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
  verification: Verification.optional(),
  findings: z.array(Finding).max(50).optional(),
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

// An answer names a finding by id and says what the reviewer decided. The
// findings themselves are capped at 50 (AgentReviewSchema), so the answers are
// too; an id for a finding this review does not have is simply not joined.
const FindingAnswerSchema = z.object({
  id: z.string().min(1).max(100),
  decision: z.enum(["fix", "dismiss"]),
  reason: z.string().max(MAX_FINDING_REASON).optional(),
});

/** Shape of POST /api/done. Unknown keys are dropped. */
export const DoneResultSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]).optional(),
  summary: z.string().max(50_000).optional(),
  comments: z.array(ReviewCommentSchema).max(2000).optional(),
  findings: z.array(FindingAnswerSchema).max(50).optional(),
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
