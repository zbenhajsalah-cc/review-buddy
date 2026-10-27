import { z } from "zod";

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

/**
 * Validate an agent review payload. Returns a concise human-readable reason on
 * failure, or null when the payload is usable. Never throws.
 */
export function validateAgentReview(agent: unknown): string | null {
  const parsed = AgentReviewSchema.safeParse(agent);
  if (parsed.success) return null;
  return parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
