import type { CiCheck, ResolvedReview, VerificationCheck } from "@review-buddy/core/types";

/** The agent's checks with the failed ones first; the rest keep the agent's order. */
export function agentChecksInOrder(checks: readonly VerificationCheck[]): VerificationCheck[] {
  return [
    ...checks.filter((c) => c.status === "failed"),
    ...checks.filter((c) => c.status !== "failed"),
  ];
}

/** CI checks that need the reviewer's eyes: failed and still running. */
export function ciChecksToShow(checks: readonly CiCheck[]): CiCheck[] {
  return checks.filter((c) => c.status === "failed" || c.status === "pending");
}

/** True when the review has no CI checks and the agent reported nothing. */
export function hasNoEvidence(review: ResolvedReview): boolean {
  const ci = review.pr.checks ?? [];
  const agent = review.verification?.checks ?? [];
  return ci.length === 0 && agent.length === 0 && !review.verification?.not_covered?.trim();
}

/** The PR's checks page on GitHub, or undefined when the PR link is not one. */
export function prChecksUrl(prUrl: string | undefined): string | undefined {
  if (!prUrl) return undefined;
  try {
    const u = new URL(prUrl);
    if (u.protocol !== "https:" || !/\/pull\/\d+\/?$/.test(u.pathname)) return undefined;
    return `${u.origin}${u.pathname.replace(/\/$/, "")}/checks`;
  } catch {
    return undefined;
  }
}

/** Only https links are rendered (the URL comes from GitHub, but check anyway). */
export function safeLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export const AGENT_STATUS_LABEL: Record<VerificationCheck["status"], string> = {
  passed: "passed",
  failed: "failed",
  not_run: "not run",
};
