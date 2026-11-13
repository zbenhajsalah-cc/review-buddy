/**
 * Shared review-session lifecycle: capture the authoritative diff (source B),
 * resolve the agent's narrative (source A) onto it, serve the viewer, open the
 * browser. Two entry points share this module:
 *
 *  - Claude Code: the PreToolUse hook (src/cli/index.ts) opens a session and
 *    BLOCKS on `server.done` before answering the hook event.
 *  - Other harnesses (Cursor, VS Code Copilot, Codex): the MCP server runs in
 *    standalone mode (src/mcp/server.ts) — `submit_review` itself opens a
 *    session and returns the URL, keeping the viewer alive in the MCP process.
 *
 * All progress goes to stderr: for the hook that's the transcript, for the MCP
 * server stderr is the only stream that doesn't corrupt the stdio protocol.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDiff } from "@review-buddy/core/diff";
import { buildMeta } from "@review-buddy/core/meta";
import { repoToplevel } from "@review-buddy/core/node/git";
import { localGitSource } from "@review-buddy/core/node/local-source";
import { resolveReview } from "@review-buddy/core/resolve";
import {
  type FindingIdentity,
  fileFingerprints,
  findingIdentities,
  nextRoundState,
  type RememberedFinding,
  roundInfo,
  sharesAnyPath,
  withoutDismissed,
} from "@review-buddy/core/rounds";
import type {
  AgentReview,
  ResolvedFinding,
  ResolvedReview,
  RoundInfo,
} from "@review-buddy/core/types";
import { pluginRoot } from "../plugin-root.ts";
import { openBrowser } from "./browser.ts";
import { type DoneResult, type RunningServer, startServer } from "./http.ts";
import { cleanupRounds, roundStore } from "./round-store.ts";

function uiDir(): string | undefined {
  const root = pluginRoot();
  if (!root) return undefined;
  const dir = join(root, "ui", "dist");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}

/**
 * Whether the reviewer's verdict and comments go back to the agent: on unless
 * REVIEW_BUDDY_ROUNDTRIP is "0", "false", "off" or "no".
 */
export function roundtripEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.REVIEW_BUDDY_ROUNDTRIP?.trim().toLowerCase();
  return !(value && ["0", "false", "off", "no"].includes(value));
}

export interface SessionOptions {
  /**
   * Remember this round, so the next submission of the same change can say
   * what moved and carry the reviewer's viewed marks over. Default: on with
   * round-trip, since a round only exists when a verdict can travel.
   */
  rounds?: boolean;
  /**
   * Show the verdict (approve / request changes) UI. Default:
   * `roundtripEnabled()`. Standalone mode decides itself: blocking forces it
   * on (its whole point is returning the verdict), detached forces it off
   * (nothing can carry a verdict back).
   */
  roundtrip?: boolean;
}

/**
 * The round this review is, and how to record it when the reviewer finishes.
 * Exported for tests; `openReviewSession` is the only caller in production.
 *
 * The diff is parsed a second time here (resolveReview parses it too): string
 * work in microseconds, in exchange for resolution and rounds not having to
 * share an intermediate shape.
 */
export function openRounds(
  cwd: string,
  agent: AgentReview,
  diff: string,
  findings?: readonly ResolvedFinding[],
): {
  info?: RoundInfo;
  identities: FindingIdentity[];
  memory: RememberedFinding[];
  save: (result: DoneResult) => void;
} {
  // Keyed by the repository, not by where the agent happened to run: the hook
  // passes its own cwd, so two directories of one repo would otherwise be two
  // chains and a re-review from a subdirectory would start over at round 1.
  const store = roundStore(repoToplevel(cwd) ?? cwd, agent.source);
  cleanupRounds();
  const parsed = parseDiff(diff);
  const current = fileFingerprints(parsed);
  const identities = findingIdentities(findings, parsed);
  let previous = store.read();
  // A worktree review has no ref, so all of them in one repo share this file.
  // A diff that shares no path with the last round is another change: it
  // starts over at round 1 (its "request changes" overwrites the old state).
  const worktree = (agent.source?.type ?? "worktree") === "worktree";
  if (previous && worktree && !sharesAnyPath(previous, current)) previous = undefined;
  const info = roundInfo(previous, current);
  return {
    info,
    identities,
    memory: previous?.findingMemory ?? [],
    /**
     * "Request changes" starts another round, so the state is written; an
     * approval ends the chain, so it is cleared. A Done with no verdict (no
     * round-trip) is an approval too — nothing goes back to the agent.
     */
    save(result) {
      if (result.verdict !== "request_changes") return store.clear();
      store.write(
        nextRoundState(
          info,
          current,
          {
            viewed: result.viewed,
            comments: result.comments,
            dismissed: result.findings?.filter((a) => a.decision === "dismiss").map((a) => a.id),
            identities,
          },
          previous,
        ),
      );
    },
  };
}

/**
 * Put the round on the review. "No repeats": a finding the reviewer dismissed
 * in an earlier round is not shown again, even if the agent raises it again;
 * the round says how many were left out. Exported for tests.
 */
export function applyRound(
  review: ResolvedReview,
  rounds: {
    info?: RoundInfo;
    identities: readonly FindingIdentity[];
    memory: readonly RememberedFinding[];
  },
): void {
  if (!rounds.info) return;
  const { findings, hidden } = withoutDismissed(review.findings, rounds.identities, rounds.memory);
  if (findings.length > 0) review.findings = findings;
  else delete review.findings;
  review.round = hidden > 0 ? { ...rounds.info, hiddenFindings: hidden } : rounds.info;
  console.error(`[review-buddy] Round ${rounds.info.number} of this change.`);
  if (hidden > 0) {
    console.error(`[review-buddy] ${hidden} finding(s) dismissed in an earlier round not shown.`);
  }
}

/**
 * Capture + resolve + serve + open the browser. Returns the running server;
 * the caller decides whether to await `server.done` (blocking flows) or return
 * immediately (standalone detached mode). Throws on capture/resolve errors.
 */
export async function openReviewSession(
  agent: AgentReview,
  cwd: string,
  opts: SessionOptions = {},
): Promise<RunningServer> {
  // Capture the authoritative diff (source B) matching what the agent reviewed;
  // the same source then serves full-file reads (source C).
  const source = localGitSource(cwd, agent.source, process.env.REVIEW_BUDDY_BASE);
  const diff = await source.diff();
  const pr = await source.pr();
  const { review, warnings } = resolveReview(
    agent,
    diff,
    buildMeta({ generatedBy: process.env.REVIEW_BUDDY_MODEL ?? "claude" }),
    pr,
  );
  for (const w of warnings) console.error(`[review-buddy] ${w}`);
  if (source.headRef === null) {
    console.error("[review-buddy] PR head not fetchable — full-file expansion disabled.");
  }

  // A round only exists where a verdict can travel: with no round-trip there
  // is no "request changes", so there is never a second round to compare with.
  const roundtrip = opts.roundtrip ?? roundtripEnabled();
  const rounds =
    (opts.rounds ?? roundtrip) ? openRounds(cwd, agent, diff, review.findings) : undefined;
  if (rounds) applyRound(review, rounds);

  const server = startServer({
    review,
    cwd,
    source,
    uiDir: uiDir(),
    roundtrip,
    onDone: rounds?.save,
  });
  console.error(`[review-buddy] Review ready at ${server.url}`);
  if (process.env.REVIEW_BUDDY_NO_OPEN) {
    console.error(`[review-buddy] REVIEW_BUDDY_NO_OPEN set — not opening a browser.`);
  } else if (!openBrowser(server.url)) {
    console.error(`[review-buddy] Could not open a browser — open the URL above manually.`);
  }
  return server;
}
