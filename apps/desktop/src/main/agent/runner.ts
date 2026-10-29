/**
 * One PR review by the agent (US-12): read the PR through GitHubApiSource,
 * run Agent SDK `query()` with the desktop prompt and the three review tools,
 * and return the last review the agent submitted.
 *
 * Progress (US-15) comes with a phase: GitHub, reading, writing, checking.
 * "Writing" is seen live: Claude's output is streamed, and the submit_review
 * call shows up as it is written, chapter by chapter. A failure says what
 * failed (`errorKind`): GitHub, a PR too large, Claude itself, or the agent.
 *
 * The agent gets no built-in tools (no shell, no file read or write, no web):
 * only get_pr_diff, read_file and submit_review. No settings files are read,
 * so the user's MCP servers, hooks and CLAUDE.md files stay out of it.
 *
 * `query` is passed in, so the run is tested without a real agent.
 */
import { tmpdir } from "node:os";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ReviewDataSource } from "@review-buddy/core/source";
import type { ResolvedReview } from "@review-buddy/core/types";
import type { ModelChoice, ReviewEffort, ReviewErrorKind } from "../../shared/ipc.ts";
import { PrTooLargeError } from "../github/api-source.ts";
import type { QueryFn } from "./check.ts";
import {
  ALLOWED_TOOLS,
  createReviewTools,
  type ReviewProgress,
  SERVER_NAME,
} from "./review-tools.ts";

export type { ReviewProgress } from "./review-tools.ts";

export interface ReviewRunOptions {
  /** `owner/repo#123`. */
  label: string;
  source: ReviewDataSource;
  /** The desktop prompt (packages/core/prompts/review-desktop.md). */
  systemPrompt: string;
  pathToClaudeCodeExecutable: string;
  clientApp: string;
  onProgress?: (progress: ReviewProgress) => void;
  /** Stops the run (the app quits, or the user starts another). */
  signal?: AbortSignal;
  /** The base limit; more effort gets more of it (see `timeoutFor`). */
  timeoutMs?: number;
  maxTurns?: number;
  /**
   * The model and effort for this review (US-22). Absent fields are left to
   * Claude Code's own default.
   */
  choice?: ModelChoice;
}

/** The base time a review gets. */
export const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/**
 * More thinking takes longer, not more turns: a review at xhigh or max on a
 * big PR does not fit the time a default one needs.
 */
export function timeoutFor(effort: ReviewEffort | undefined, base = DEFAULT_TIMEOUT_MS): number {
  switch (effort) {
    case "high":
      return Math.round(base * 1.5);
    case "xhigh":
    case "max":
      return base * 2;
    default:
      return base;
  }
}

export interface ReviewRunResult {
  ok: boolean;
  review?: ResolvedReview;
  /** Resolution notes of the review shown. */
  warnings: string[];
  /** How many submissions passed validation (the last one is shown). */
  submissions: number;
  model?: string;
  /** The effort the review actually ran at (what was sent to Claude). */
  effort?: ReviewEffort;
  turns?: number;
  costUsd?: number;
  durationMs: number;
  error?: string;
  /** Set when there is no review: what failed. */
  errorKind?: ReviewErrorKind;
  /** No run: a saved review of this PR head was opened (US-16). */
  cached?: boolean;
}

/** The submit_review tool as Claude names it in its output. */
const SUBMIT_TOOL = `mcp__${SERVER_NAME}__submit_review`;

/**
 * The chapter titles complete so far in a submit_review input that is still
 * being written (streamed JSON). Only chapters have a "title" key.
 */
export function chapterTitles(partialJson: string): string[] {
  const titles: string[] = [];
  for (const m of partialJson.matchAll(/(?<!\\)"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try {
      titles.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      titles.push(m[1]!);
    }
  }
  return titles;
}

/** What an Agent SDK error code means for the user. */
const CLAUDE_ERRORS: Record<string, string> = {
  authentication_failed:
    "Claude is not signed in, or the login expired. Run `claude /login` in a terminal, then try again.",
  oauth_org_not_allowed:
    "Your Claude login is not allowed for this organization. Run `claude /login` with another account.",
  verification_required: "Claude needs you to verify your account. Run `claude /login`.",
  cloud_credential_error: "Claude could not use its cloud credentials. Check the Claude setup.",
  billing_error: "Claude cannot run for this account (billing). Check your Claude account.",
  account_on_hold: "Your Claude account is on hold. Check your Claude account.",
  rate_limit: "Claude's usage limit is reached. Try again later.",
  overloaded: "Claude is overloaded right now. Try again in a moment.",
  server_error: "Claude had a server error. Try again in a moment.",
  model_not_found: "Claude's model is not available to this account.",
};

export async function runReview(
  query: QueryFn,
  options: ReviewRunOptions,
): Promise<ReviewRunResult> {
  const started = Date.now();
  const progress = options.onProgress ?? (() => {});
  const result: ReviewRunResult = {
    ok: false,
    warnings: [],
    submissions: 0,
    durationMs: 0,
    // What this run asks for, known before it starts (also kept on a failure).
    ...(options.choice?.effort ? { effort: options.choice.effort } : {}),
  };
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  options.signal?.addEventListener("abort", abort);
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutFor(options.choice?.effort, options.timeoutMs));
  const stderr: string[] = [];
  let tools: ReturnType<typeof createReviewTools> | undefined;
  /** An error code Claude reported (login, rate limit, …). */
  let claudeError: string | undefined;
  try {
    // Read the PR first: a PR too large for the API fails here, before any tokens.
    progress({ phase: "github", step: `Loading ${options.label} from GitHub` });
    let pr: Awaited<ReturnType<ReviewDataSource["pr"]>>;
    let diff: string;
    try {
      [pr, diff] = await Promise.all([options.source.pr(), options.source.diff()]);
    } catch (e) {
      result.errorKind = e instanceof PrTooLargeError ? "too-large" : "github";
      throw e;
    }
    tools = createReviewTools({
      label: options.label,
      pr,
      diff,
      fileContent: (path, side) => options.source.fileContent(path, side),
      generatedBy: () => result.model ?? "claude",
      onProgress: progress,
    });
    progress({ phase: "reading", step: "Starting Claude" });
    const q = query({
      prompt:
        `Review pull request ${options.label}: "${pr.title}". ` +
        "Start with get_pr_diff, and finish by calling submit_review.",
      options: {
        abortController,
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        systemPrompt: options.systemPrompt,
        // The model and effort for this review (US-22); absent: Claude Code's default.
        ...(options.choice?.model ? { model: options.choice.model } : {}),
        ...(options.choice?.effort ? { effort: options.choice.effort } : {}),
        // Not the user's projects: no CLAUDE.md, settings, plugins or saved session.
        cwd: tmpdir(),
        settingSources: [],
        // No built-in tools at all; the review tools are the only ones, and
        // anything else is denied without asking.
        tools: [],
        mcpServers: { [SERVER_NAME]: tools.server },
        strictMcpConfig: true,
        allowedTools: ALLOWED_TOOLS,
        permissionMode: "dontAsk",
        maxTurns: options.maxTurns ?? 40,
        persistSession: false,
        // Streamed output: the review is seen while Claude writes it.
        includePartialMessages: true,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: options.clientApp },
        stderr: (data) => stderr.push(data),
      },
    });
    const writing = new WritingWatcher(progress);
    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === "system" && message.subtype === "init") {
        result.model = message.model;
        // The model travels with the step: the progress view shows it while
        // the review runs, not only when it ends.
        progress({
          phase: "reading",
          step: `Claude is reading the PR (${message.model})`,
          model: message.model,
        });
      } else if (message.type === "stream_event") {
        writing.event(message.event as StreamEvent);
      } else if (message.type === "assistant" && message.error) {
        claudeError ??= message.error;
      } else if (message.type === "result") {
        result.turns = message.num_turns;
        result.costUsd = message.total_cost_usd;
        if (message.subtype !== "success") {
          result.error = [message.subtype, ...message.errors].join(": ");
        } else if (message.is_error) {
          result.error = message.result;
        }
      }
    }
  } catch (e) {
    // The SDK also throws after an error result; keep the first message.
    if (abortController.signal.aborted) {
      const stopped = options.signal?.aborted === true;
      result.error ??= stopped ? "stopped" : "timed out";
      result.errorKind ??= stopped ? "stopped" : "agent";
    } else {
      result.error ??= e instanceof Error ? e.message : String(e);
      // Not GitHub's: Claude Code itself could not run.
      result.errorKind ??= "claude";
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }

  // The last submission counts, even when the run ended badly afterwards
  // (out of turns, for example): it passed validation and resolution.
  const latest = tools?.latest();
  if (latest) {
    Object.assign(result, {
      ok: true,
      review: latest.review,
      warnings: latest.warnings,
      submissions: latest.number,
    });
    result.errorKind = undefined;
  } else {
    const told = claudeError ? CLAUDE_ERRORS[claudeError] : undefined;
    const said = result.error;
    result.error ??= "Claude finished without submitting a review.";
    if (result.errorKind === undefined || result.errorKind === "claude") {
      if (told || (said && /\/login|not logged in|invalid api key/i.test(said))) {
        result.errorKind = "claude";
        if (told) result.error = said ? `${told}\n${said}` : told;
      }
      // Claude ran, but no review came out (out of turns, gave up, …).
      result.errorKind ??= "agent";
    }
    if (stderr.length && result.errorKind !== "github" && result.errorKind !== "too-large") {
      result.error += `\n${stderr.join("").trim().slice(-2000)}`;
    }
  }
  result.durationMs = Date.now() - started;
  return result;
}

/** The streaming events this file reads (Anthropic Messages API stream). */
interface StreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; name?: string };
  delta?: { type: string; partial_json?: string };
}

/**
 * Watches the stream for a submit_review call being written: says "writing"
 * when it starts, then "Writing chapter N: title" as each title completes.
 */
class WritingWatcher {
  #block: number | undefined;
  #json = "";
  #titles = 0;

  constructor(private readonly progress: (p: ReviewProgress) => void) {}

  event(e: StreamEvent): void {
    if (e.type === "message_start") {
      this.#block = undefined;
    } else if (
      e.type === "content_block_start" &&
      e.content_block?.type === "tool_use" &&
      e.content_block.name === SUBMIT_TOOL
    ) {
      this.#block = e.index;
      this.#json = "";
      this.#titles = 0;
      this.progress({ phase: "writing", step: "Claude is writing the review" });
    } else if (
      e.type === "content_block_delta" &&
      e.index === this.#block &&
      e.delta?.type === "input_json_delta"
    ) {
      this.#json += e.delta.partial_json ?? "";
      const titles = chapterTitles(this.#json);
      for (; this.#titles < titles.length; this.#titles++) {
        this.progress({
          phase: "writing",
          step: `Writing chapter ${this.#titles + 1}: ${titles[this.#titles]}`,
        });
      }
    } else if (e.type === "content_block_stop" && e.index === this.#block) {
      this.#block = undefined;
    }
  }
}
