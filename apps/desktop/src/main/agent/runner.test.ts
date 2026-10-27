import { describe, expect, test } from "bun:test";
import type {
  McpSdkServerConfigWithInstance,
  Options,
  Query,
} from "@anthropic-ai/claude-agent-sdk";
import { fixtureSource } from "../fixture/index.ts";
import fixture from "../fixture/review.json" with { type: "json" };
import { PrTooLargeError } from "../github/api-source.ts";
import type { QueryFn } from "./check.ts";
import { connectMcp } from "./mcp-test-client.ts";
import { ALLOWED_TOOLS } from "./review-tools.ts";
import { chapterTitles, runReview } from "./runner.ts";

type Call = (name: string, args?: Record<string, unknown>) => Promise<string>;

/**
 * A stand-in for the Agent SDK: it records the options, plays an "agent" that
 * calls the in-process tools over MCP, then ends with `end` as the result.
 */
function fakeQuery(
  agent: (call: Call) => Promise<void>,
  end: Record<string, unknown> = { subtype: "success", is_error: false, result: "Done." },
  /** Messages sent after init, before the agent calls tools (stream events, …). */
  before: Record<string, unknown>[] = [],
) {
  const seen: { prompt?: string; options?: Options } = {};
  const query: QueryFn = ({ prompt, options }) => {
    seen.prompt = prompt;
    seen.options = options;
    async function* messages() {
      yield { type: "system", subtype: "init", model: "test-model" };
      yield* before;
      const client = await connectMcp(
        options!.mcpServers!["review-buddy"] as McpSdkServerConfigWithInstance,
      );
      await agent(async (name, args = {}) => {
        const res = await client.callTool(name, args);
        return res.content.map((c) => c.text).join("");
      });
      yield { type: "result", num_turns: 4, total_cost_usd: 0.12, errors: [], ...end };
    }
    return messages() as unknown as Query;
  };
  return { query, seen };
}

const base = {
  label: "octocat/hello-world#42",
  systemPrompt: "THE DESKTOP PROMPT",
  pathToClaudeCodeExecutable: "/fake/claude",
  clientApp: "review-buddy-desktop/test",
};

describe("runReview", () => {
  test("only the review tools, the desktop prompt, no settings", async () => {
    const { query, seen } = fakeQuery(async () => {});
    await runReview(query, { ...base, source: fixtureSource() });
    const o = seen.options!;
    expect(seen.prompt).toBe(
      'Review pull request octocat/hello-world#42: "Friendlier greetings and calmer retries". ' +
        "Start with get_pr_diff, and finish by calling submit_review.",
    );
    expect(o.systemPrompt).toBe("THE DESKTOP PROMPT");
    expect(o.tools).toEqual([]);
    expect(o.allowedTools).toEqual(ALLOWED_TOOLS);
    expect(o.permissionMode).toBe("dontAsk");
    expect(o.settingSources).toEqual([]);
    expect(o.strictMcpConfig).toBe(true);
    expect(Object.keys(o.mcpServers!)).toEqual(["review-buddy"]);
    expect(o.persistSession).toBe(false);
    expect(o.includePartialMessages).toBe(true);
    expect(o.pathToClaudeCodeExecutable).toBe("/fake/claude");
    expect(o.env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("review-buddy-desktop/test");
  });

  test("the agent reads the diff the review is resolved against, then submits", async () => {
    let diffText = "";
    const steps: string[] = [];
    const { query } = fakeQuery(async (call) => {
      diffText = await call("get_pr_diff");
      await call("read_file", { path: "src/retry.ts" });
      await call("submit_review", fixture.agent);
    });
    const result = await runReview(query, {
      ...base,
      source: fixtureSource(),
      onProgress: ({ phase, step }) => steps.push(`${phase}: ${step}`),
    });
    expect(diffText).toEndWith(fixture.diff);
    expect(result).toMatchObject({
      ok: true,
      warnings: [],
      submissions: 1,
      model: "test-model",
      turns: 4,
      costUsd: 0.12,
    });
    expect(result.error).toBeUndefined();
    expect(result.review!.meta.generatedBy).toBe("test-model");
    expect(result.review!.chapters[0]!.title).toBe(fixture.agent.chapters[0]!.title);
    expect(steps).toEqual([
      "github: Loading octocat/hello-world#42 from GitHub",
      "reading: Starting Claude",
      "reading: Claude is reading the PR (test-model)",
      "reading: Reading the diff",
      "reading: Reading src/retry.ts",
      "checking: Checking the chapters against the diff",
      "checking: Review submitted",
    ]);
    expect(result.errorKind).toBeUndefined();
  });

  test("the last submission is shown, with its notes", async () => {
    const wrong = structuredClone(fixture.agent);
    wrong.chapters[0]!.files[0]!.path = "src/nope.ts";
    const { query } = fakeQuery(async (call) => {
      await call("submit_review", fixture.agent);
      await call("submit_review", wrong);
    });
    const result = await runReview(query, { ...base, source: fixtureSource() });
    expect(result.ok).toBe(true);
    expect(result.submissions).toBe(2);
    expect(result.warnings.join("\n")).toContain("src/nope.ts");
  });

  test("a submission survives a bad end (out of turns)", async () => {
    const { query } = fakeQuery(
      async (call) => {
        await call("submit_review", fixture.agent);
      },
      { subtype: "error_max_turns", errors: ["Reached maximum number of turns (40)"] },
    );
    const result = await runReview(query, { ...base, source: fixtureSource() });
    expect(result.ok).toBe(true);
    expect(result.error).toBe("error_max_turns: Reached maximum number of turns (40)");
  });

  test("no submission is a failure, with the CLI's error", async () => {
    const none = await runReview(fakeQuery(async () => {}).query, {
      ...base,
      source: fixtureSource(),
    });
    expect(none).toMatchObject({
      ok: false,
      error: "Claude finished without submitting a review.",
      errorKind: "agent",
    });

    const login = await runReview(
      fakeQuery(async () => {}, {
        subtype: "success",
        is_error: true,
        result: "Not logged in · Please run /login",
      }).query,
      { ...base, source: fixtureSource() },
    );
    expect(login).toMatchObject({
      ok: false,
      error: "Not logged in · Please run /login",
      errorKind: "claude",
    });

    const turns = await runReview(
      fakeQuery(async () => {}, {
        subtype: "error_max_turns",
        errors: ["Reached maximum number of turns (40)"],
      }).query,
      { ...base, source: fixtureSource() },
    );
    expect(turns).toMatchObject({ ok: false, errorKind: "agent" });
  });

  test("an error code from Claude is said in words", async () => {
    const result = await runReview(
      fakeQuery(
        async () => {},
        { subtype: "success", is_error: true, result: "API Error: 429 rate limited" },
        [{ type: "assistant", error: "rate_limit", message: { content: [] } }],
      ).query,
      { ...base, source: fixtureSource() },
    );
    expect(result).toMatchObject({
      ok: false,
      errorKind: "claude",
      error: "Claude's usage limit is reached. Try again later.\nAPI Error: 429 rate limited",
    });
  });

  test("Claude Code that cannot start is a Claude error", async () => {
    const query: QueryFn = () => {
      throw new Error("spawn /fake/claude ENOENT");
    };
    const result = await runReview(query, { ...base, source: fixtureSource() });
    expect(result).toMatchObject({ errorKind: "claude", error: "spawn /fake/claude ENOENT" });
  });

  test("the review is seen while it is written, chapter by chapter", async () => {
    const steps: string[] = [];
    const json = JSON.stringify(fixture.agent);
    const cut = (n: number) => json.slice((json.length * n) / 4, (json.length * (n + 1)) / 4);
    const delta = (text: string) => ({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: text },
      },
    });
    const { query } = fakeQuery(
      async (call) => {
        await call("submit_review", fixture.agent);
      },
      undefined,
      [
        { type: "stream_event", event: { type: "message_start" } },
        {
          type: "stream_event",
          event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", name: "mcp__review-buddy__submit_review" },
          },
        },
        ...[0, 1, 2, 3].map((n) => delta(cut(n))),
        { type: "stream_event", event: { type: "content_block_stop", index: 1 } },
      ],
    );
    await runReview(query, {
      ...base,
      source: fixtureSource(),
      onProgress: ({ phase, step }) => steps.push(`${phase}: ${step}`),
    });
    expect(steps.filter((s) => s.startsWith("writing"))).toEqual([
      "writing: Claude is writing the review",
      ...fixture.agent.chapters.map((c, i) => `writing: Writing chapter ${i + 1}: ${c.title}`),
    ]);
  });

  test("a PR that cannot be read fails before Claude starts", async () => {
    let started = false;
    const query: QueryFn = () => {
      started = true;
      throw new Error("should not start");
    };
    const source = {
      ...fixtureSource(),
      diff: async () => {
        throw new PrTooLargeError("octocat/hello-world#42 is too large for GitHub's diff API");
      },
    };
    const result = await runReview(query, { ...base, source });
    expect(started).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: "octocat/hello-world#42 is too large for GitHub's diff API",
      errorKind: "too-large",
    });

    const offline = await runReview(query, {
      ...base,
      source: {
        ...fixtureSource(),
        pr: async () => {
          throw new Error("Could not reach GitHub (offline).");
        },
      },
    });
    expect(offline).toMatchObject({
      errorKind: "github",
      error: "Could not reach GitHub (offline).",
    });
  });

  test("stopping aborts the run", async () => {
    const stop = new AbortController();
    const query: QueryFn = ({ options }) => {
      async function* messages() {
        yield { type: "system", subtype: "init", model: "test-model" };
        stop.abort();
        if (options!.abortController!.signal.aborted) throw new Error("aborted");
      }
      return messages() as unknown as Query;
    };
    const result = await runReview(query, {
      ...base,
      source: fixtureSource(),
      signal: stop.signal,
    });
    expect(result).toMatchObject({ ok: false, error: "stopped", errorKind: "stopped" });
  });
});

test("chapterTitles reads the titles complete so far", () => {
  const json = JSON.stringify({
    prologue: { why: 'A "title": "not this one"' },
    chapters: [
      { index: 1, title: 'Retry "backoff"', files: [] },
      { index: 2, title: "Greeting" },
    ],
  });
  expect(chapterTitles(json)).toEqual(['Retry "backoff"', "Greeting"]);
  // Cut inside the second title: only the first is complete.
  expect(chapterTitles(json.slice(0, json.indexOf("Greeting") + 3))).toEqual(['Retry "backoff"']);
  expect(chapterTitles("")).toEqual([]);
});
