/**
 * Smoke test for the committed plugin bundles (dist/), run the way users run
 * them: from a copy of the repo with NO node_modules (a GitHub plugin install is
 * a git clone), with Bun auto-install DISABLED (`--no-install`) and an empty
 * install cache. If a bundle still needed a package, this fails instead of
 * silently downloading one.
 *
 * Checks: the hook answers a bad payload; a full hook review serves the real
 * viewer, the resolved review, and file content, then returns "allow" on Done;
 * the MCP server lists submit_review; standalone mode opens a viewer.
 *
 * Usage: bun run scripts/smoke-plugin.ts   (also the last step of verify:ci)
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repo = join(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "rb-smoke-"));
const plugin = join(work, "plugin");
const target = join(work, "target");
const env = {
  ...process.env,
  BUN_INSTALL_CACHE_DIR: join(work, "bun-cache"),
  REVIEW_BUDDY_NO_OPEN: "1",
};
/** Run a bundle on this Bun with auto-install disabled. */
const bun = (script: string, ...args: string[]) => [
  process.execPath,
  "--no-install",
  join(plugin, script),
  ...args,
];

let failed = false;
function check(ok: boolean, what: string, detail?: unknown): void {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) {
    failed = true;
    if (detail !== undefined) console.log("   ", detail);
  }
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

// --- Setup: the plugin as a clone (tracked + new, non-ignored files) ---------
const files = git(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
  .split("\0")
  .filter((f) => f && existsSync(join(repo, f)));
for (const f of files) {
  mkdirSync(dirname(join(plugin, f)), { recursive: true });
  cpSync(join(repo, f), join(plugin, f));
}
check(!existsSync(join(plugin, "node_modules")), "plugin copy has no node_modules");

// A target repo with one pending edit to review.
mkdirSync(target);
git(target, "init", "-q");
git(target, "config", "user.email", "t@t.t");
git(target, "config", "user.name", "t");
git(target, "config", "commit.gpgsign", "false");
writeFileSync(join(target, "app.ts"), "let x = 1;\nlet y = 2;\n");
git(target, "add", "-A");
git(target, "commit", "-q", "-m", "base");
writeFileSync(join(target, "app.ts"), "let x = 1;\nlet y = 20;\nlet z = 3;\n");

const review = {
  prologue: {
    why: "y is wrong",
    what: "fix y and add z",
    key_changes: [{ headline: "Fix y", detail: "20 not 2" }],
    review_focus: { summary: "check z", file: "app.ts" },
  },
  chapters: [
    {
      index: 1,
      title: "Adjust bindings",
      risk: "Low",
      risk_reason: "tiny",
      description: "edits y and adds z",
      files: [{ path: "app.ts", change_type: "modified", hunks: [{ old_start: 1, new_start: 1 }] }],
    },
  ],
};

const URL_RE = /http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/;
const parseUrl = (u: string) => {
  const url = new URL(u);
  return { origin: url.origin, token: url.searchParams.get("token") ?? "" };
};

/** Fetch the review + file content + viewer page from a running viewer. */
async function checkViewer(label: string, viewerUrl: string): Promise<void> {
  const { origin, token } = parseUrl(viewerUrl);
  const headers = { "x-review-buddy-token": token };
  const r = (await (await fetch(`${origin}/api/review`, { headers })).json()) as {
    chapters: { title: string; files: { hunks: unknown[] }[] }[];
  };
  check(
    r.chapters[0]?.title === "Adjust bindings" && r.chapters[0]?.files[0]?.hunks.length === 1,
    `${label}: /api/review resolves the chapter onto the real hunk`,
    r.chapters,
  );
  const fc = (await (
    await fetch(`${origin}/api/file-content?path=app.ts&side=base`, { headers })
  ).json()) as { content: string };
  check(
    fc.content === "let x = 1;\nlet y = 2;\n",
    `${label}: /api/file-content serves the base side`,
    fc,
  );
  const html = await (await fetch(`${origin}/`)).text();
  check(html.includes('<div id="root">'), `${label}: serves the prebuilt viewer (src/ui/dist)`);
}

/** Read a child's stderr until `re` matches (or the child exits / times out). */
async function waitFor(stream: ReadableStream<Uint8Array>, re: RegExp, ms = 30_000) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      Bun.sleep(deadline - Date.now()).then(() => ({ value: undefined, done: true })),
    ]);
    if (done) break;
    text += decoder.decode(value);
    const m = re.exec(text);
    if (m) {
      reader.releaseLock();
      return m[0];
    }
  }
  reader.releaseLock();
  throw new Error(`timed out waiting for ${re} — output so far:\n${text}`);
}

try {
  // --- 1. Hook: bad payload → fail-open "allow" -----------------------------
  {
    const [cmd, ...args] = bun("dist/hook.js", "open-review");
    const out = spawnSync(cmd!, args, {
      input: JSON.stringify({ tool_input: { nope: 1 }, cwd: target }),
      env,
      encoding: "utf8",
    });
    const decision = JSON.parse(out.stdout || "{}").hookSpecificOutput?.permissionDecision;
    check(out.status === 0 && decision === "allow", "hook: bad payload → allow", out.stderr);
  }

  // --- 2. Hook: full review --------------------------------------------------
  {
    const proc = Bun.spawn(bun("dist/hook.js", "open-review"), {
      cwd: target,
      env,
      stdin: new Blob([JSON.stringify({ tool_input: review, cwd: target })]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const url = await waitFor(proc.stderr, URL_RE);
    await checkViewer("hook", url);
    const { origin, token } = parseUrl(url);
    await fetch(`${origin}/api/done`, {
      method: "POST",
      headers: { "x-review-buddy-token": token, "content-type": "application/json" },
      body: "{}",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    const decision = JSON.parse(stdout || "{}").hookSpecificOutput?.permissionDecision;
    check(code === 0 && decision === "allow", "hook: Done → allow", stdout);
  }

  // --- 3 + 4. MCP server: tools/list, then standalone submit_review ----------
  const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  for (const standalone of [false, true]) {
    const label = standalone ? "server --standalone" : "server";
    const args = standalone ? ["--standalone"] : [];
    const proc = Bun.spawn(bun("dist/server.js", ...args), {
      cwd: work,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const send = (msg: object) => proc.stdin.write(`${JSON.stringify(msg)}\n`);
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const response = async (id: number) => {
      while (true) {
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const msg = JSON.parse(line);
          if (msg.id === id) return msg;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) {
          const stderr = await new Response(proc.stderr).text();
          throw new Error(`${label} closed stdout before answering ${id}:\n${stderr}`);
        }
        buf += decoder.decode(value);
      }
    };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      },
    });
    const init = await response(1);
    check(
      init.result?.serverInfo?.version === version,
      `${label}: reports version ${version}`,
      init,
    );
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    if (!standalone) {
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const tool = (await response(2)).result?.tools?.[0];
      check(
        tool?.name === "submit_review" &&
          JSON.stringify(tool.inputSchema?.required) === '["prologue","chapters"]' &&
          !("$schema" in tool.inputSchema),
        `${label}: lists submit_review with the review schema`,
        tool,
      );
    } else {
      send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "submit_review", arguments: { ...review, cwd: target } },
      });
      const text: string = (await response(2)).result?.content?.[0]?.text ?? "";
      const url = URL_RE.exec(text)?.[0];
      check(!!url, `${label}: submit_review returns a viewer URL`, text);
      if (url) await checkViewer(label, url);
    }
    proc.stdin.end(); // client disconnect → the server shuts down
    const code = await Promise.race([proc.exited, Bun.sleep(10_000).then(() => "timeout")]);
    check(code === 0, `${label}: exits cleanly when the client disconnects`, code);
    if (code === "timeout") proc.kill();
  }
} catch (e) {
  check(false, "smoke test ran to completion", e);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed) {
  console.log("\nPlugin smoke test FAILED.");
  process.exit(1);
}
console.log("\nPlugin smoke test passed.");
