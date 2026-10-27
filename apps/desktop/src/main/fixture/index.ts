/**
 * A small fixed review for the Electron skeleton (US-08). It goes through the
 * same core steps a real review will (validateAgentReview → resolveReview over
 * a real `git diff`), so main proves core runs in Electron, not only in Bun.
 *
 * review.json holds: the agent's review (source A), the diff and PR metadata
 * (source B), and the full base/head file contents (source C). The diff was
 * made with `git diff` from those files; fixture.test.ts checks they agree.
 */
import { buildMeta } from "@review-buddy/core/meta";
import { resolveReview } from "@review-buddy/core/resolve";
import type { ReviewDataSource } from "@review-buddy/core/source";
import type { AgentReview, PrMetadata, ResolvedReview } from "@review-buddy/core/types";
import { validateAgentReview } from "@review-buddy/core/validate";
import fixture from "./review.json" with { type: "json" };

export interface FixtureReview {
  review: ResolvedReview;
  source: ReviewDataSource;
  warnings: string[];
}

export function fixtureSource(): ReviewDataSource {
  const files: Record<string, string> = fixture.files;
  return {
    diff: async () => fixture.diff,
    pr: async () => fixture.pr satisfies PrMetadata,
    fileContent: async (path, side) => files[`${side}:${path}`] ?? "",
  };
}

export async function loadFixtureReview(): Promise<FixtureReview> {
  const error = validateAgentReview(fixture.agent);
  if (error) throw new Error(`fixture review is invalid: ${error}`);
  const source = fixtureSource();
  const { review, warnings } = resolveReview(
    fixture.agent as AgentReview,
    await source.diff(),
    buildMeta({ generatedBy: "fixture" }),
    await source.pr(),
  );
  return { review, source, warnings };
}
