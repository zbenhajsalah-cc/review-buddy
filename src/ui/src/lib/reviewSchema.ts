import type { ResolvedReview } from "@review-buddy/core/types";
import { z } from "zod";

const RiskSchema = z.enum(["Low", "Medium", "High"]);
const ChangeTypeSchema = z.enum(["added", "modified", "deleted", "renamed"]);

const KeyChangeSchema = z.object({
  headline: z.string(),
  detail: z.string(),
});

const ReviewFocusSchema = z.object({
  summary: z.string(),
  file: z.string(),
});

const PrologueSchema = z.object({
  why: z.string(),
  what: z.string(),
  key_changes: z.array(KeyChangeSchema),
  review_focus: ReviewFocusSchema,
});

const ReviewMetaSchema = z.object({
  aiGenerated: z.boolean(),
  generatedBy: z.string(),
  generatedAt: z.string(),
  promptVersion: z.string(),
});

const PrMetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  author: z.string(),
  createdAt: z.string(),
  base: z.string(),
  head: z.string(),
  url: z.string().optional(),
  ciStatus: z.string().optional(),
});

const ResolvedHunkSchema = z.object({
  old_start: z.number(),
  old_lines: z.number(),
  new_start: z.number(),
  new_lines: z.number(),
  header: z.string(),
  lines: z.array(z.string()),
});

const ResolvedFileSchema = z.object({
  path: z.string(),
  change_type: ChangeTypeSchema,
  additions: z.number(),
  deletions: z.number(),
  language: z.string(),
  hunks: z.array(ResolvedHunkSchema),
  binary: z.boolean().optional(),
  old_path: z.string().optional(),
});

const ResolvedChapterSchema = z.object({
  index: z.number(),
  title: z.string(),
  risk: RiskSchema,
  risk_reason: z.string(),
  additions: z.number(),
  deletions: z.number(),
  fileCount: z.number(),
  description: z.string(),
  files: z.array(ResolvedFileSchema),
});

const ReviewStatsSchema = z.object({
  additions: z.number(),
  deletions: z.number(),
  filesChanged: z.number(),
});

export const ReviewSchema = z.object({
  meta: ReviewMetaSchema,
  pr: PrMetadataSchema,
  prologue: PrologueSchema,
  stats: ReviewStatsSchema,
  chapters: z.array(ResolvedChapterSchema),
  warnings: z.array(z.string()),
});

/**
 * Compile-time drift guard (reverse direction). `parseReview`'s `: ResolvedReview`
 * return already enforces schema ⊆ contract (the schema can't be missing a
 * required field). This assignment enforces contract ⊆ schema (the schema can't
 * require a field the contract dropped, nor go stale when the contract shrinks).
 * Together the two directions keep ReviewSchema and ResolvedReview in lockstep.
 */
const _contractSubsetOfSchema: z.infer<typeof ReviewSchema> = {} as ResolvedReview;
void _contractSubsetOfSchema;

/**
 * Parse + validate a GET /api/review payload against the ResolvedReview
 * contract. Throws a concise, human-readable Error (which lands in App's
 * existing error panel) when the payload is malformed.
 *
 * The `: ResolvedReview` return annotation is a COMPILE-TIME drift guard: if
 * this schema ever produces a shape incompatible with ResolvedReview, the build
 * fails right here — so the validation can never silently lie about the type.
 */
export function parseReview(data: unknown): ResolvedReview {
  const result = ReviewSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first && first.path.length > 0 ? first.path.join(".") : "payload";
    throw new Error(`Malformed review payload: ${where}: ${first?.message ?? "invalid"}`);
  }
  return result.data;
}
