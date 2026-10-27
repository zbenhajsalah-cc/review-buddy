/**
 * One PR review by the agent (US-12): read the PR through GitHubApiSource,
 * run Agent SDK `query()` with the desktop prompt and the three review tools,
 * and return the last review the agent submitted.
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
import type { QueryFn } from "./check.ts";
import { ALLOWED_TOOLS, createReviewTools, SERVER_NAME } from "./review-tools.ts";

export interface ReviewRunOptions {
  /** `owner/repo#123`. */
  label: string;
  source: ReviewDataSource;
  /** The desktop prompt (packages/core/prompts/review-desktop.md). */
  systemPrompt: string;
  pathToClaudeCodeExecutable: string;
  clientApp: string;
  onProgress?: (step: string) => void;
  /** Stops the run (the app quits, or the user starts another). */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTurns?: number;
}

export interface ReviewRunResult {
  ok: boolean;
  review?: ResolvedReview;
  /** Resolution notes of the review shown. */
  warnings: string[];
  /** How many submissions passed validation (the last one is shown). */
  submissions: number;
  model?: string;
  turns?: number;
  costUsd?: number;
  durationMs: number;
  error?: string;
}

export async function runReview(
  query: QueryFn,
  options: ReviewRunOptions,
): Promise<ReviewRunResult> {
  const started = Date.now();
  const progress = options.onProgress ?? (() => {});
  const result: ReviewRunResult = { ok: false, warnings: [], submissions: 0, durationMs: 0 };
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  options.signal?.addEventListener("abort", abort);
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 15 * 60_000);
  const stderr: string[] = [];
  let tools: ReturnType<typeof createReviewTools> | undefined;
  try {
    // Read the PR first: a PR too large for the API fails here, before any tokens.
    progress(`Loading ${options.label} from GitHub`);
    const [pr, diff] = await Promise.all([options.source.pr(), options.source.diff()]);
    tools = createReviewTools({
      label: options.label,
      pr,
      diff,
      fileContent: (path, side) => options.source.fileContent(path, side),
      generatedBy: () => result.model ?? "claude",
      onProgress: progress,
    });
    progress("Starting Claude");
    const q = query({
      prompt:
        `Review pull request ${options.label}: "${pr.title}". ` +
        "Start with get_pr_diff, and finish by calling submit_review.",
      options: {
        abortController,
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        systemPrompt: options.systemPrompt,
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
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: options.clientApp },
        stderr: (data) => stderr.push(data),
      },
    });
    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === "system" && message.subtype === "init") {
        result.model = message.model;
        progress(`Claude is reading the PR (${message.model})`);
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
    result.error ??= abortController.signal.aborted
      ? options.signal?.aborted
        ? "stopped"
        : "timed out"
      : e instanceof Error
        ? e.message
        : String(e);
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
  } else {
    result.error ??= "Claude finished without submitting a review.";
    if (stderr.length) result.error += `\n${stderr.join("").trim().slice(-2000)}`;
  }
  result.durationMs = Date.now() - started;
  return result;
}
