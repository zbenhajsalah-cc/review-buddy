/**
 * The system notification for a review that ended while the app was in the
 * background: a review takes minutes, so the reviewer works elsewhere
 * meanwhile. No Electron imports: tested with bun.
 */
import type { ReviewJobStatus } from "../shared/ipc.ts";

const MAX_BODY = 140;

export interface JobNotice {
  title: string;
  body: string;
}

/** What to say about an ended job; null when there is nothing to say (stopped). */
export function jobNotice(status: ReviewJobStatus): JobNotice | null {
  if (status.state === "done") {
    return { title: "Review ready", body: `${status.pr} is ready to read.` };
  }
  if (status.state !== "failed" || status.errorKind === "stopped") return null;
  // The first line: later lines are details (the Claude Code version, …).
  const reason = (status.error ?? "The review failed.").split("\n")[0]!.trim();
  const body = `${status.pr}: ${reason}`;
  return {
    title: "Review failed",
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
  };
}
