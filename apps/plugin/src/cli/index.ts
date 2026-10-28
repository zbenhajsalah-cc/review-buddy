/**
 * Review Buddy CLI — entry for the PreToolUse hook (and local dev).
 *
 * Modes:
 *   open-review (default)  Spawned by the PreToolUse hook. Reads the hook event
 *                          from stdin, captures the diff + PR (sources B/C),
 *                          resolves the agent review (A), serves it, opens the
 *                          browser, and BLOCKS until the reviewer finishes.
 *                          "Request changes" returns permissionDecision "deny"
 *                          with the reviewer's note and line comments as the
 *                          reason; Done (approve) returns "allow", with any
 *                          comments in additionalContext.
 *                          REVIEW_BUDDY_ROUNDTRIP=0 turns this off: plain Done,
 *                          always "allow" (Phase 1).
 *   dev --review <file>    Load an agent review JSON from a file and run the
 *                          same viewer against the current repo — for testing
 *                          the UI without going through the agent/hook. Prints
 *                          what the agent would get.
 */
import { readFileSync } from "node:fs";
import {
  approvalMessage,
  joinMessages,
  requestChangesMessage,
  resolutionNotesMessage,
} from "@review-buddy/core/messages";
import type { AgentReview } from "@review-buddy/core/types";
import { validateAgentReview } from "@review-buddy/core/validate";
import type { DoneResult } from "../server/http.ts";
import { openReviewSession, roundtripEnabled, type SessionOptions } from "../server/session.ts";

interface HookEvent {
  tool_name?: string;
  tool_input?: AgentReview;
  cwd?: string;
}

interface ServeResult {
  done: DoneResult;
  warnings: readonly string[];
}

/** Print a PreToolUse permission decision and exit. */
function respond(
  permissionDecision: "allow" | "deny",
  reason: string,
  additionalContext?: string,
): never {
  const hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason: string;
    additionalContext?: string;
  } = {
    hookEventName: "PreToolUse",
    permissionDecision,
    permissionDecisionReason: reason,
  };
  // Only emit the key when there is something to say — never undefined/null.
  if (additionalContext !== undefined) {
    hookSpecificOutput.additionalContext = additionalContext;
  }
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
  process.exit(0);
}

/** Let the agent proceed (Phase 1 default; also every fail-open path). */
function allow(reason: string, additionalContext?: string): never {
  respond("allow", reason, additionalContext);
}
/** Block the tool call and hand the reason back to the agent ("request changes"). */
function deny(reason: string, additionalContext?: string): never {
  respond("deny", reason, additionalContext);
}

/** Open a session (capture/resolve/serve/browser) and block until Done. */
async function serveAndBlock(
  agent: AgentReview,
  cwd: string,
  opts: SessionOptions,
): Promise<ServeResult> {
  const server = await openReviewSession(agent, cwd, opts);
  const done = await server.done;
  const { warnings } = server;
  server.stop();
  return { done, warnings };
}

async function runOpenReview(): Promise<never> {
  let event: HookEvent;
  try {
    const raw = await Bun.stdin.text();
    event = JSON.parse(raw) as HookEvent;
  } catch (err) {
    console.error(`[review-buddy] Failed to read hook event: ${String(err)}`);
    allow("Review Buddy could not read the hook event; proceeding.");
  }

  const agent = event.tool_input;
  const cwd = event.cwd ?? process.cwd();
  const invalid = validateAgentReview(agent);
  if (invalid) {
    console.error(`[review-buddy] Invalid review payload: ${invalid}`);
    allow("Review Buddy received no valid review payload; proceeding.");
  }

  const roundtrip = roundtripEnabled();
  let result: ServeResult;
  try {
    result = await serveAndBlock(agent as AgentReview, cwd, { roundtrip });
  } catch (err) {
    console.error(`[review-buddy] Viewer error: ${String(err)}`);
    allow("Review Buddy hit an error rendering the review; proceeding.");
  }
  const notes = resolutionNotesMessage(result.warnings);
  if (!roundtrip) allow("Review viewed by the human.", notes);
  const { verdict, summary, comments } = result.done;
  if (verdict === "request_changes") deny(requestChangesMessage(summary, comments), notes);
  // An approval's reason only reaches the debug log; additionalContext reaches the agent.
  allow("Review approved by the human.", joinMessages(approvalMessage(summary, comments), notes));
}

async function runDev(args: string[]): Promise<void> {
  const i = args.indexOf("--review");
  if (i === -1 || !args[i + 1]) {
    console.error("Usage: review-buddy dev --review <agent-review.json> [--cwd <dir>]");
    process.exit(2);
  }
  const agent = JSON.parse(readFileSync(args[i + 1]!, "utf8")) as AgentReview;
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? args[cwdIdx + 1]! : process.cwd();
  const roundtrip = roundtripEnabled();
  const { done } = await serveAndBlock(agent, cwd, { roundtrip });
  const feedback = !roundtrip
    ? undefined
    : done.verdict === "request_changes"
      ? requestChangesMessage(done.summary, done.comments)
      : approvalMessage(done.summary, done.comments);
  console.error(
    feedback ? `[review-buddy] Done. The agent would get:\n\n${feedback}` : "[review-buddy] Done.",
  );
  process.exit(0);
}

const [, , mode, ...rest] = process.argv;
if (mode === "dev") {
  await runDev(rest);
} else {
  await runOpenReview();
}
