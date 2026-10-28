/**
 * Which review a click on a "review ended" notification shows (main shows
 * the notification: src/main/job-notice.ts).
 */
import type { ReviewJobStatus } from "../../shared/ipc.ts";

/**
 * The job while the job list keeps it; once the list has dropped it (it keeps
 * the last finished ones only), its saved review; nothing for a failed job
 * that is gone.
 */
export function viewForEndedJob(
  jobs: readonly ReviewJobStatus[],
  ended: ReviewJobStatus,
): { kind: "job"; id: number } | { kind: "review"; reviewKey: string; pr: string } | null {
  if (jobs.some((j) => j.id === ended.id)) return { kind: "job", id: ended.id };
  if (ended.reviewKey) return { kind: "review", reviewKey: ended.reviewKey, pr: ended.pr };
  return null;
}

/**
 * The job a new page follows: the one in `?job=` (main opened the window for
 * a notification click), else the newest.
 */
export function jobToFollow(
  jobs: readonly ReviewJobStatus[],
  search: string,
): ReviewJobStatus | undefined {
  const asked = Number(new URLSearchParams(search).get("job"));
  return jobs.find((j) => j.id === asked) ?? jobs.at(-1);
}
