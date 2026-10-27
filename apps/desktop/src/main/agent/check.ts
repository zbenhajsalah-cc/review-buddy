/**
 * The smallest Agent SDK run: one question, no tools, no settings files.
 * It proves the SDK starts Claude Code from Electron main and that Claude
 * Code finds a credential: normally the user's own Claude login
 * (`claude /login`), so the desktop app needs no API key.
 *
 * `query` is passed in, so the logic is tested without a real run.
 */
import { tmpdir } from "node:os";
import type { Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type QueryFn = (args: { prompt: string; options?: Options }) => Query;

export interface AgentCheckResult {
  ok: boolean;
  /** Claude's reply; the check asks for exactly "pong". */
  answer?: string;
  model?: string;
  claudeCodeVersion?: string;
  /**
   * Where the credential came from (see SDKSystemMessage.apiKeySource):
   * "none" with an Anthropic account = the user's Claude login (OAuth);
   * "ANTHROPIC_API_KEY" = an API key from the environment.
   */
  apiKeySource?: string;
  /** From accountInfo(); the email is left out on purpose (this is logged). */
  account?: { subscriptionType?: string; tokenSource?: string; apiProvider?: string };
  durationMs: number;
  error?: string;
}

const PROMPT = "Reply with exactly the word: pong";

export async function runAgentCheck(
  query: QueryFn,
  options: { pathToClaudeCodeExecutable: string; clientApp: string; timeoutMs?: number },
): Promise<AgentCheckResult> {
  const started = Date.now();
  const result: AgentCheckResult = { ok: false, durationMs: 0 };
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), options.timeoutMs ?? 120_000);
  const stderr: string[] = [];
  try {
    const q = query({
      prompt: PROMPT,
      options: {
        abortController,
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        // Not the user's projects: no CLAUDE.md, settings, tools or saved session.
        cwd: tmpdir(),
        settingSources: [],
        tools: [],
        maxTurns: 1,
        persistSession: false,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: options.clientApp },
        stderr: (data) => stderr.push(data),
      },
    });
    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === "system" && message.subtype === "init") {
        result.model = message.model;
        result.claudeCodeVersion = message.claude_code_version;
        result.apiKeySource = message.apiKeySource;
        const { subscriptionType, tokenSource, apiProvider } = await q.accountInfo();
        result.account = { subscriptionType, tokenSource, apiProvider };
      } else if (message.type === "result") {
        if (message.subtype !== "success") {
          result.error = [message.subtype, ...message.errors].join(": ");
        } else if (message.is_error) {
          // Auth and API failures end here, e.g. "Not logged in · Please run /login".
          result.error = message.result;
        } else {
          result.answer = message.result;
          result.ok = /\bpong\b/i.test(message.result);
          if (!result.ok) result.error = "unexpected answer";
        }
      }
    }
    if (!result.ok && !result.error) result.error = "no result";
  } catch (e) {
    // The SDK also throws after an error result; keep the CLI's own message.
    result.error ??= abortController.signal.aborted ? "timed out" : String(e);
  } finally {
    clearTimeout(timer);
  }
  if (!result.ok && stderr.length) result.error += `\n${stderr.join("").trim().slice(-2000)}`;
  result.durationMs = Date.now() - started;
  return result;
}
