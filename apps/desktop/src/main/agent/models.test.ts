import { describe, expect, test } from "bun:test";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeModelCatalog } from "../../shared/ipc.ts";
import { FALLBACK_MODELS } from "../../shared/models.ts";
import { fetchSupportedModels, ModelCatalog, type ModelsQueryFn } from "./models.ts";

const DEFAULT_ROW = {
  value: "default",
  displayName: "Default (recommended)",
  description: "Opus 5.5 · Best for everyday, complex tasks",
  resolvedModel: "claude-opus-5-5",
  supportsEffort: true,
};

const ROWS = [
  {
    value: "opus",
    displayName: "Opus",
    description: "The most capable model.",
    resolvedModel: "claude-opus-5",
    supportsEffort: true,
    supportedEffortLevels: ["max", "low", "high"],
  },
  { value: "haiku", displayName: "Haiku", supportsEffort: false },
];

const base = {
  pathToClaudeCodeExecutable: "/fake/claude",
  clientApp: "review-buddy-desktop/test",
  cwd: "/tmp",
};

/** A stand-in for the SDK: it records the call and answers `rows`. */
function fakeQuery(rows: unknown[] | Error) {
  const seen: { prompt?: AsyncIterable<never> | string; options?: Options } = {};
  const query: ModelsQueryFn = ({ prompt, options }) => {
    seen.prompt = prompt;
    seen.options = options;
    return {
      supportedModels: async () => {
        if (rows instanceof Error) throw rows;
        return rows;
      },
    } as unknown as Query;
  };
  return { query, seen };
}

describe("fetchSupportedModels", () => {
  test("asks Claude Code and keeps the fields the pickers need", async () => {
    const { query, seen } = fakeQuery(ROWS);
    const catalog = await fetchSupportedModels(query, base);
    expect(catalog.fallback).toBe(false);
    expect(catalog.models).toEqual([
      {
        value: "opus",
        displayName: "Opus",
        description: "The most capable model.",
        resolvedModel: "claude-opus-5",
        supportsEffort: true,
        // In order, least to most, whatever order Claude Code listed them in.
        supportedEffortLevels: ["low", "high", "max"],
      },
      { value: "haiku", displayName: "Haiku", supportsEffort: false },
    ]);
    // None of the user's own settings, and no tools.
    expect(seen.options?.settingSources).toEqual([]);
    expect(seen.options?.tools).toEqual([]);
    expect(seen.options?.persistSession).toBe(false);
    expect(seen.options?.cwd).toBe("/tmp");
  });

  test("sends no turn, and ends the session", async () => {
    const { query, seen } = fakeQuery(ROWS);
    await fetchSupportedModels(query, base);
    expect(seen.options?.abortController?.signal.aborted).toBe(true);
    // The prompt never yielded a message: it ends with the session.
    const prompt = seen.prompt as AsyncIterable<never>;
    expect(await prompt[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
  });

  test("Claude Code's own default is not a model in the list", async () => {
    const { query } = fakeQuery([DEFAULT_ROW, ...ROWS]);
    const catalog = await fetchSupportedModels(query, base);
    expect(catalog.models.map((m) => m.value)).toEqual(["opus", "haiku"]);
    // Kept apart, so the pickers can name the model the default is.
    expect(catalog.defaultModel).toMatchObject({
      value: "default",
      displayName: "Default (recommended)",
      resolvedModel: "claude-opus-5-5",
    });
  });

  test("no default row: no defaultModel", async () => {
    const { query } = fakeQuery(ROWS);
    expect((await fetchSupportedModels(query, base)).defaultModel).toBeUndefined();
  });

  test("a Claude that cannot answer gives the fallback list and the reason", async () => {
    const { query } = fakeQuery(new Error("Not logged in"));
    const catalog = await fetchSupportedModels(query, base);
    expect(catalog).toEqual({
      models: FALLBACK_MODELS,
      fallback: true,
      error: "Not logged in",
    });
  });

  test("an empty list is a failure, not an empty picker", async () => {
    const { query } = fakeQuery([]);
    const catalog = await fetchSupportedModels(query, base);
    expect(catalog.fallback).toBe(true);
    expect(catalog.models).toEqual(FALLBACK_MODELS);
  });

  test("rows that are not models are dropped", async () => {
    const { query } = fakeQuery([{ value: "opus; ls", displayName: "Bad" }, ...ROWS]);
    const catalog = await fetchSupportedModels(query, base);
    expect(catalog.models.map((m) => m.value)).toEqual(["opus", "haiku"]);
  });
});

describe("ModelCatalog", () => {
  const list: ClaudeModelCatalog = {
    models: [{ value: "opus", displayName: "Opus" }],
    fallback: false,
  };

  test("asks once, then remembers; refresh asks again", async () => {
    let asks = 0;
    const catalog = new ModelCatalog({
      fetch: async () => {
        asks++;
        return list;
      },
    });
    expect(await catalog.list()).toEqual(list);
    expect(await catalog.list()).toEqual(list);
    expect(asks).toBe(1);
    await catalog.list(true);
    expect(asks).toBe(2);
    catalog.forget();
    await catalog.list();
    expect(asks).toBe(3);
  });

  test("calls at the same time share one ask", async () => {
    let asks = 0;
    const catalog = new ModelCatalog({
      fetch: async () => {
        asks++;
        await Bun.sleep(1);
        return list;
      },
    });
    await Promise.all([catalog.list(), catalog.list(), catalog.list()]);
    expect(asks).toBe(1);
  });

  test("no usable Claude Code: the fallback list, logged, and known() works", async () => {
    const logs: string[] = [];
    const catalog = new ModelCatalog({
      fetch: async () => {
        throw new Error("Claude Code cannot run.");
      },
      log: (line) => logs.push(line),
    });
    expect(catalog.known()).toEqual(FALLBACK_MODELS); // before any ask
    const answer = await catalog.list();
    expect(answer.fallback).toBe(true);
    expect(answer.error).toBe("Claude Code cannot run.");
    expect(logs).toEqual(["models: Claude Code cannot run."]);
    expect(catalog.known()).toEqual(FALLBACK_MODELS);
  });
});
