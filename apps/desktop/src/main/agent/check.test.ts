import { describe, expect, test } from "bun:test";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type QueryFn, runAgentCheck } from "./check.ts";

const init = {
  type: "system",
  subtype: "init",
  model: "claude-test",
  claude_code_version: "9.9.9",
  apiKeySource: "none",
} as unknown as SDKMessage;

const success = (result: string, is_error = false) =>
  ({ type: "result", subtype: "success", result, is_error }) as unknown as SDKMessage;

/** A fake query() that yields `messages`, then throws or waits for abort if asked. */
function fakeQuery(messages: SDKMessage[], opts: { hang?: boolean; throws?: Error } = {}) {
  const calls: Parameters<QueryFn>[0][] = [];
  const query: QueryFn = (args) => {
    calls.push(args);
    async function* run() {
      for (const m of messages) yield m;
      if (opts.throws) throw opts.throws;
      if (opts.hang) {
        await new Promise((_, reject) =>
          args.options?.abortController?.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        );
      }
    }
    return Object.assign(run(), {
      accountInfo: async () => ({
        email: "me@example.com",
        subscriptionType: "max",
        tokenSource: "claude.ai",
        apiProvider: "firstParty" as const,
      }),
    }) as unknown as Query;
  };
  return { query, calls };
}

const options = { pathToClaudeCodeExecutable: "/bin/claude", clientApp: "test/1" };

describe("runAgentCheck", () => {
  test("ok when Claude answers pong; reports where the credential came from", async () => {
    const { query, calls } = fakeQuery([init, success("pong")]);
    const r = await runAgentCheck(query, options);
    expect(r).toMatchObject({
      ok: true,
      answer: "pong",
      model: "claude-test",
      claudeCodeVersion: "9.9.9",
      apiKeySource: "none",
      account: { subscriptionType: "max", tokenSource: "claude.ai", apiProvider: "firstParty" },
    });
    expect(JSON.stringify(r)).not.toContain("me@example.com");
    // A run that cannot touch the user's projects: no tools, no settings files.
    const o = calls[0]!.options!;
    expect(o).toMatchObject({
      pathToClaudeCodeExecutable: "/bin/claude",
      tools: [],
      settingSources: [],
      maxTurns: 1,
      persistSession: false,
    });
    expect(o.env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("test/1");
    expect(o.env?.PATH).toBe(process.env.PATH);
  });

  test("an error result keeps the CLI's message, even if the SDK then throws", async () => {
    const { query } = fakeQuery([init, success("Not logged in · Please run /login", true)], {
      throws: new Error("Claude Code returned an error result"),
    });
    const r = await runAgentCheck(query, options);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Not logged in · Please run /login");
  });

  test("error subtypes report their errors", async () => {
    const error = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["boom"],
    } as unknown as SDKMessage;
    const r = await runAgentCheck(fakeQuery([init, error]).query, options);
    expect(r).toMatchObject({ ok: false, error: "error_during_execution: boom" });
  });

  test("a different answer is not ok", async () => {
    const r = await runAgentCheck(fakeQuery([init, success("hello")]).query, options);
    expect(r).toMatchObject({ ok: false, answer: "hello", error: "unexpected answer" });
  });

  test("a failure to start is reported", async () => {
    const { query } = fakeQuery([], { throws: new Error("spawn ENOENT") });
    const r = await runAgentCheck(query, options);
    expect(r).toMatchObject({ ok: false, error: "Error: spawn ENOENT" });
  });

  test("gives up after the timeout", async () => {
    const r = await runAgentCheck(fakeQuery([init], { hang: true }).query, {
      ...options,
      timeoutMs: 50,
    });
    expect(r).toMatchObject({ ok: false, error: "timed out" });
  });
});
