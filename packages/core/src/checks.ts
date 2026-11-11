/**
 * CI checks from GitHub, in one shape for every source: `gh pr view --json
 * statusCheckRollup` (plugin) and the REST check-runs and statuses (desktop).
 * Runtime-neutral: it only reads plain JSON.
 */
import type { CiCheck, CiCheckStatus, PrMetadata } from "./types.ts";

const FAILED = new Set([
  "failure",
  "error",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);
const PASSED = new Set(["success"]);
const SKIPPED = new Set(["skipped", "neutral"]);

/**
 * The state of one check from GitHub's words. Check runs have a `status`
 * (queued, in_progress, completed) and, once completed, a `conclusion`;
 * commit statuses have only a `state` (pass it as `conclusion`). Case does
 * not matter: GraphQL sends "SUCCESS", REST sends "success".
 */
export function ciCheckStatus(status: unknown, conclusion: unknown): CiCheckStatus {
  const c = typeof conclusion === "string" ? conclusion.toLowerCase() : "";
  if (PASSED.has(c)) return "passed";
  if (FAILED.has(c)) return "failed";
  if (SKIPPED.has(c)) return "skipped";
  // No conclusion yet (queued, in progress, "pending", "expected").
  const s = typeof status === "string" ? status.toLowerCase() : "";
  if (s === "completed" && c) return "skipped";
  return "pending";
}

/**
 * A link we are willing to show: https only (CI may live outside GitHub).
 * No `URL` here: core is runtime-neutral and has no DOM or Node types.
 */
function safeUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  return /^https:\/\/[^\s/?#]+[^\s]*$/i.test(url) ? url : undefined;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Failed first, then pending, passed, skipped; by name inside each group. */
const ORDER: Record<CiCheckStatus, number> = { failed: 0, pending: 1, passed: 2, skipped: 3 };
export function sortCiChecks(checks: CiCheck[]): CiCheck[] {
  return [...checks].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

/**
 * Checks from `gh pr view --json statusCheckRollup`: a list of CheckRun
 * (`name`, `status`, `conclusion`, `detailsUrl`, `workflowName`) and
 * StatusContext (`context`, `state`, `targetUrl`) objects. Returns undefined
 * when there is nothing usable, so "no data" and "no checks" look the same.
 */
export function checksFromRollup(rollup: unknown): CiCheck[] | undefined {
  if (!Array.isArray(rollup)) return undefined;
  const checks: CiCheck[] = [];
  for (const item of rollup) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (r.__typename === "StatusContext" || ("context" in r && "state" in r)) {
      const name = str(r.context);
      if (!name) continue;
      checks.push({ name, status: ciCheckStatus("", r.state), url: safeUrl(r.targetUrl) });
    } else {
      const name = str(r.name);
      if (!name) continue;
      const workflow = str(r.workflowName);
      checks.push({
        name: workflow && workflow !== name ? `${workflow} / ${name}` : name,
        status: ciCheckStatus(r.status, r.conclusion),
        url: safeUrl(r.detailsUrl),
      });
    }
  }
  return finish(checks);
}

/**
 * Checks from the REST API: `GET …/commits/{sha}/check-runs` (`check_runs`)
 * and `GET …/commits/{sha}/status` (`statuses`). Either may be missing.
 */
export function checksFromRest(checkRuns: unknown, combinedStatus: unknown): CiCheck[] | undefined {
  const checks: CiCheck[] = [];
  const runs = (checkRuns as { check_runs?: unknown } | null)?.check_runs;
  if (Array.isArray(runs)) {
    for (const item of runs) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const name = str(r.name);
      if (!name) continue;
      checks.push({
        name,
        status: ciCheckStatus(r.status, r.conclusion),
        url: safeUrl(r.html_url) ?? safeUrl(r.details_url),
      });
    }
  }
  const statuses = (combinedStatus as { statuses?: unknown } | null)?.statuses;
  if (Array.isArray(statuses)) {
    for (const item of statuses) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const name = str(r.context);
      if (!name) continue;
      checks.push({ name, status: ciCheckStatus("", r.state), url: safeUrl(r.target_url) });
    }
  }
  return finish(checks);
}

/**
 * Sorted, never cut: a cap taken before or after sorting would make the
 * counts wrong, and a cap before sorting could drop a failure. The callers
 * bound the size by how many pages they read.
 */
function finish(checks: CiCheck[]): CiCheck[] | undefined {
  if (checks.length === 0) return undefined;
  return sortCiChecks(checks).map((c) => (c.url ? c : { name: c.name, status: c.status }));
}

/** "12 passed, 1 failed, 2 pending" — only the counts that are not zero. */
export function ciSummary(checks: readonly CiCheck[]): string {
  const count = (s: CiCheckStatus) => checks.filter((c) => c.status === s).length;
  return (["failed", "pending", "passed", "skipped"] as const)
    .map((s) => [count(s), s] as const)
    .filter(([n]) => n > 0)
    .map(([n, s]) => `${n} ${s}`)
    .join(", ");
}

/**
 * The CI fields of PrMetadata. `incomplete`: some checks could not be read (a
 * page failed, or there were more pages than the source reads), so the list
 * may miss failures and must not be shown as the commit's whole CI.
 */
export function ciMetadata(
  checks: CiCheck[] | undefined,
  incomplete = false,
): Pick<PrMetadata, "checks" | "ciStatus" | "checksIncomplete"> {
  if (!checks || checks.length === 0) return {};
  const summary = ciSummary(checks);
  return incomplete
    ? { checks, ciStatus: `${summary} (incomplete)`, checksIncomplete: true }
    : { checks, ciStatus: summary };
}
