/**
 * Guards the distribution contract: `dist/cli.mjs` must run on plain **Node**.
 *
 * The source is developed under Bun, so a `Bun.*` API can slip into src/ and
 * every Bun-run test will still pass — while the plugin (`node dist/cli.mjs`)
 * and the npm package break for every user. These tests run the committed
 * bundle the way it actually ships.
 */
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const bundle = join(import.meta.dirname, "..", "..", "dist", "cli.mjs");

/** Run the bundle under Node, feed it stdin, and collect both streams. */
function runNode(
  args: string[],
  stdin: string,
  ms: number,
  /** Close stdin after writing — the hook reads to EOF; the MCP server must not. */
  endStdin = false,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [bundle, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => {
      stdout += String(c);
    });
    proc.stderr.on("data", (c) => {
      stderr += String(c);
    });
    proc.stdin.write(stdin);
    if (endStdin) proc.stdin.end();
    setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr });
    }, ms);
  });
}

// The bundle is committed, but a fresh clone that hasn't run `build:dist` (or a
// CI stage ordered before it) shouldn't fail the suite for a missing artifact.
describe.if(existsSync(bundle))("dist/cli.mjs under Node", () => {
  test("serves the MCP tool list", async () => {
    const requests = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    ].join("\n");
    const { stdout, stderr } = await runNode(["mcp"], `${requests}\n`, 4000);
    expect(stderr).toContain("MCP server ready");
    expect(stdout).toContain('"name":"submit_review"');
    // A Bun-only API reaching Node surfaces here first.
    expect(stderr).not.toContain("ReferenceError");
  });

  test("standalone flag reaches the bundled mode parser", async () => {
    const { stderr } = await runNode(["mcp", "--standalone"], "", 3000);
    expect(stderr).toContain("standalone: detached");
  });

  test("open-review answers the hook when the payload is unusable", async () => {
    // No valid review -> the hook must still emit a well-formed allow decision
    // rather than hanging the agent's turn. Exercises the Node stdin reader.
    const event = JSON.stringify({ tool_input: {} });
    const { stdout } = await runNode(["open-review"], `${event}\n`, 3000, true);
    expect(stdout).toContain('"permissionDecision":"allow"');
  });
});
