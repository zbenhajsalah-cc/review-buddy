/**
 * Which models a review can run on (US-22), asked of the installed Claude
 * Code rather than listed in this app: the Agent SDK answers
 * `supportedModels()` once a session has started, narrowed to what the user's
 * account may use. Asking starts a `claude` process but costs no tokens — the
 * prompt is an iterable that never yields a message, and the session is
 * aborted as soon as the list is in.
 *
 * When Claude cannot be asked (not signed in, offline, no Claude Code), the
 * pickers fall back to the aliases in shared/models.ts, and a review still
 * runs: an alias this account does not have fails with "model_not_found",
 * which the runner already turns into a message for the user.
 *
 * The rules both sides need (which effort levels a model has, what a model
 * string may look like) live in shared/models.ts, so main checks what the
 * renderer sends with the same code the pickers show.
 *
 * No Electron imports: tested with bun and a fake `query`.
 */
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeModelCatalog, ClaudeModelOption } from "../../shared/ipc.ts";
import {
  FALLBACK_MODELS,
  isModelValue,
  REVIEW_EFFORTS,
  toReviewEffort,
} from "../../shared/models.ts";

/** How Claude Code lists its own default among the models. */
const DEFAULT_ROW = "default";

/** `query`, with a prompt that may be an async iterable (nothing is sent). */
export type ModelsQueryFn = (args: {
  prompt: AsyncIterable<never> | string;
  options?: Options;
}) => Query;

/** Only the fields the pickers need, from one `supportedModels()` row. */
function toOption(value: unknown): ClaudeModelOption | null {
  const v = value as Record<string, unknown> | null;
  if (!v || !isModelValue(v.value)) return null;
  const option: ClaudeModelOption = {
    value: v.value,
    displayName: typeof v.displayName === "string" && v.displayName ? v.displayName : v.value,
  };
  if (typeof v.description === "string") option.description = v.description;
  if (isModelValue(v.resolvedModel)) option.resolvedModel = v.resolvedModel;
  if (typeof v.supportsEffort === "boolean") option.supportsEffort = v.supportsEffort;
  if (Array.isArray(v.supportedEffortLevels)) {
    const levels = v.supportedEffortLevels.map(toReviewEffort).filter((e) => e !== undefined);
    option.supportedEffortLevels = REVIEW_EFFORTS.filter((e) => levels.includes(e));
  }
  return option;
}

/**
 * Asks the installed Claude Code which models this account can use. Starts a
 * session, reads the list, and aborts it; the prompt never yields, so no turn
 * is ever sent. Failures are answers, not rejections: the fallback list, with
 * `error` saying why.
 */
export async function fetchSupportedModels(
  query: ModelsQueryFn,
  options: {
    pathToClaudeCodeExecutable: string;
    clientApp: string;
    cwd: string;
    timeoutMs?: number;
  },
): Promise<ClaudeModelCatalog> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), options.timeoutMs ?? 60_000);
  try {
    const q = query({
      // Never yields: the session starts, answers the list, and is aborted
      // below, which ends this prompt (also if it is read after the abort).
      prompt: (async function* () {
        const { signal } = abortController;
        if (signal.aborted) return;
        await new Promise((resolve) => {
          signal.addEventListener("abort", resolve, { once: true });
        });
      })(),
      options: {
        abortController,
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        // Not the user's projects: no CLAUDE.md, settings, tools or saved session.
        cwd: options.cwd,
        settingSources: [],
        tools: [],
        persistSession: false,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: options.clientApp },
        stderr: () => {},
      },
    });
    try {
      const rows = (await q.supportedModels()).map(toOption).filter((m) => m !== null);
      // Claude Code lists its own default as a model ("default"): the pickers
      // have that option already, and would otherwise show it twice.
      const models = rows.filter((m) => m.value !== DEFAULT_ROW);
      const defaultModel = rows.find((m) => m.value === DEFAULT_ROW);
      if (!models.length) throw new Error("Claude Code listed no models.");
      return { models, fallback: false, ...(defaultModel ? { defaultModel } : {}) };
    } finally {
      abortController.abort();
    }
  } catch (e) {
    return {
      models: FALLBACK_MODELS,
      fallback: true,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface ModelCatalogDeps {
  /** Asks Claude Code (it answers the fallback list rather than rejecting). */
  fetch(): Promise<ClaudeModelCatalog>;
  log?(line: string): void;
}

/**
 * The model list as the app keeps it: asked for once, then remembered, and
 * asked again on request (Settings → Refresh, or when the chosen Claude Code
 * changes). A failed ask is remembered too — as the fallback list — so the
 * pickers never wait on a Claude that cannot run; Refresh tries again.
 */
export class ModelCatalog {
  #last: ClaudeModelCatalog | undefined;
  #running: Promise<ClaudeModelCatalog> | undefined;

  constructor(private readonly deps: ModelCatalogDeps) {}

  /** The list (one ask runs if there was none, or if `refresh` is true). */
  list(refresh?: unknown): Promise<ClaudeModelCatalog> {
    if (refresh !== true && this.#last) return Promise.resolve(this.#last);
    this.#running ??= (async () => {
      try {
        this.#last = await this.deps.fetch();
        if (this.#last.fallback) this.deps.log?.(`models: ${this.#last.error}`);
        return this.#last;
      } catch (e) {
        // No usable Claude Code (US-21), or the ask itself failed.
        const error = e instanceof Error ? e.message : String(e);
        this.deps.log?.(`models: ${error}`);
        this.#last = { models: FALLBACK_MODELS, fallback: true, error };
        return this.#last;
      } finally {
        this.#running = undefined;
      }
    })();
    return this.#running;
  }

  /** The list if it has been asked for, without asking. */
  known(): ClaudeModelOption[] {
    return this.#last?.models ?? FALLBACK_MODELS;
  }

  /** The list is asked for again after this (the Claude Code changed). */
  forget(): void {
    this.#last = undefined;
  }
}
