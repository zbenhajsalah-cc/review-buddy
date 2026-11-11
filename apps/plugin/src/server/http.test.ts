import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureDiff, capturePr, fileContent, resolveBase } from "@review-buddy/core/node/git";
import { localGitSource } from "@review-buddy/core/node/local-source";
import { resolveReview } from "@review-buddy/core/resolve";
import type { AgentReview, PrMetadata, ResolvedReview, ReviewMeta } from "@review-buddy/core/types";
import { type DoneResult, type RunningServer, startServer } from "./http.ts";

let dir: string;
let server: RunningServer;
let base: string;
let review: ResolvedReview;

const META: ReviewMeta = {
  aiGenerated: true,
  generatedBy: "test-model",
  generatedAt: "2026-06-16T12:00:00Z",
  promptVersion: "1",
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rb-http-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "app.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  // Working-tree change (Phase 1 default base = HEAD).
  writeFileSync(join(dir, "app.ts"), "const a = 1;\nconst b = 22;\nconst c = 3;\n");

  base = resolveBase(dir);
  const agent: AgentReview = {
    prologue: {
      why: "w",
      what: "x",
      key_changes: [
        { headline: "h1", detail: "d1" },
        { headline: "h2", detail: "d2" },
      ],
      review_focus: { summary: "s", file: "app.ts" },
    },
    chapters: [
      {
        index: 1,
        title: "Tweak b",
        risk: "Low",
        risk_reason: "trivial",
        description: "changes b",
        files: [{ path: "app.ts", change_type: "modified" }],
      },
    ],
  };
  const pr: PrMetadata = capturePr(dir, base);
  ({ review } = resolveReview(agent, await captureDiff(dir, base), META, pr));
  server = startServer({ review, cwd: dir, source: localGitSource(dir) });
});

afterAll(() => {
  server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

// Loopback base + token-authenticated fetch (server set in beforeAll).
const apiUrl = (p: string) => `http://127.0.0.1:${server.port}/${p}`;
const authed = (p: string, init: RequestInit = {}) =>
  fetch(apiUrl(p), {
    ...init,
    headers: { "x-review-buddy-token": server.token, ...(init.headers ?? {}) },
  });

describe("HTTP server", () => {
  test("GET /api/config reports the roundtrip flag (default false)", async () => {
    const cfg = await (await authed("api/config")).json();
    expect(cfg.roundtrip).toBe(false);
  });

  test("GET /api/config reports roundtrip:true when the server is started with it", async () => {
    const agent: AgentReview = {
      prologue: {
        why: "w",
        what: "x",
        key_changes: [
          { headline: "h1", detail: "d1" },
          { headline: "h2", detail: "d2" },
        ],
        review_focus: { summary: "s", file: "app.ts" },
      },
      chapters: [
        {
          index: 1,
          title: "Tweak b",
          risk: "Low",
          risk_reason: "trivial",
          description: "changes b",
          files: [{ path: "app.ts", change_type: "modified" }],
        },
      ],
    };
    const pr = capturePr(dir, base);
    const { review } = resolveReview(agent, await captureDiff(dir, base), META, pr);
    const s = startServer({ review, cwd: dir, source: localGitSource(dir), roundtrip: true });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/config`, {
        headers: { "x-review-buddy-token": s.token },
      });
      expect((await res.json()).roundtrip).toBe(true);
    } finally {
      s.stop();
    }
  });

  test("GET /api/review returns the resolved review with real hunk content", async () => {
    const r = await (await authed("api/review")).json();
    expect(r.meta.generatedBy).toBe("test-model");
    expect(r.pr.author).toBe("t");
    expect(r.stats.filesChanged).toBe(1);
    const hunk = r.chapters[0].files[0].hunks[0];
    expect(hunk.lines).toContain("+const b = 22;");
    expect(hunk.lines).toContain("-const b = 2;");
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  test("GET /api/file-content serves head (working tree) and base (committed) bytes", async () => {
    const head = await (await authed("api/file-content?path=app.ts&side=head")).json();
    expect(head.content).toBe("const a = 1;\nconst b = 22;\nconst c = 3;\n");
    expect(head.language).toBe("typescript");

    const baseSide = await (await authed("api/file-content?path=app.ts&side=base")).json();
    expect(baseSide.content).toBe("const a = 1;\nconst b = 2;\nconst c = 3;\n");
  });

  test("PR-unavailable mode (headRef: null) serves empty head content, never worktree bytes", async () => {
    const agent: AgentReview = {
      prologue: {
        why: "w",
        what: "x",
        key_changes: [
          { headline: "h1", detail: "d1" },
          { headline: "h2", detail: "d2" },
        ],
        review_focus: { summary: "s", file: "app.ts" },
      },
      chapters: [
        {
          index: 1,
          title: "Tweak b",
          risk: "Low",
          risk_reason: "trivial",
          description: "changes b",
          files: [{ path: "app.ts", change_type: "modified" }],
        },
      ],
    };
    const pr: PrMetadata = capturePr(dir, base);
    const { review } = resolveReview(agent, await captureDiff(dir, base), META, pr);
    const s = startServer({
      review,
      cwd: dir,
      // PR mode with the head commit unavailable (LocalGitSource headRef: null).
      source: { fileContent: async (p, side) => fileContent(dir, p, side, base, null) },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/file-content?path=app.ts&side=head`, {
        headers: { "x-review-buddy-token": s.token },
      });
      const body = await res.json();
      expect(body.content).toBe(""); // PR mode, unavailable — NOT the worktree "const b = 22;"
    } finally {
      s.stop();
    }
  });

  test("rejects path traversal / non-review files on /api/file-content", async () => {
    const traversal = await authed(
      `api/file-content?path=${encodeURIComponent("../../../../etc/passwd")}`,
    );
    expect(traversal.status).toBe(403); // not in the review's file allowlist

    const absolute = await authed(`api/file-content?path=${encodeURIComponent("/etc/passwd")}`);
    expect(absolute.status).toBe(403);
  });

  test("requires the token on /api/* (401 without it)", async () => {
    const res = await fetch(apiUrl("api/review")); // no token header/query
    expect(res.status).toBe(401);
  });

  test("rejects non-loopback Host headers (DNS-rebinding guard)", async () => {
    // curl forges the Host header (fetch forbids it). Spawn ASYNC — a sync
    // execFileSync would block the event loop the in-process server runs on,
    // deadlocking against its own request.
    const proc = Bun.spawn([
      "curl",
      "-s",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "-H",
      "Host: evil.com",
      "-H",
      `x-review-buddy-token: ${server.token}`,
      apiUrl("api/review"),
    ]);
    const code = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(code).toBe("403");
  });

  test("GET / serves the placeholder viewer (no token needed for the shell)", async () => {
    const res = await fetch(server.url);
    const html = await res.text();
    expect(html).toContain("Review Buddy");
    expect(html).toContain("/api/review");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("POST /api/done refuses a malformed body and keeps waiting", async () => {
    const res = await authed("api/done", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "approve", comments: [{ path: "app.ts" }] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("comments.0");
    const settled = await Promise.race([
      server.done.then(() => true),
      Bun.sleep(100).then(() => false),
    ]);
    expect(settled).toBe(false);
  });

  test("POST /api/done refuses a body that is not JSON: it is not taken as a plain Done", async () => {
    const res = await authed("api/done", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"verdict":"request_changes","comments":[',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not valid JSON");
    const settled = await Promise.race([
      server.done.then(() => true),
      Bun.sleep(100).then(() => false),
    ]);
    expect(settled).toBe(false);
  });

  test("POST /api/done with an empty body is a plain Done", async () => {
    const s = startServer({ review, cwd: dir, source: localGitSource(dir) });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/done`, {
        method: "POST",
        headers: { "x-review-buddy-token": s.token },
      });
      expect(res.status).toBe(200);
      expect(await s.done).toEqual({});
    } finally {
      s.stop();
    }
  });

  test("POST /api/done unblocks the hook", async () => {
    const res = await (
      await authed("api/done", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A client cannot claim the server stopped: unknown keys are dropped.
        body: JSON.stringify({ verdict: "approve", superseded: true }),
      })
    ).json();
    expect(res.ok).toBe(true);
    expect(await server.done).toEqual({ verdict: "approve" });
  });

  test("POST /api/done joins the answers onto the findings this server served", async () => {
    const withFindings: ResolvedReview = {
      ...review,
      findings: [
        {
          id: "f1",
          path: "app.ts",
          line: 2,
          side: "new",
          severity: "important",
          title: "b is wrong",
          body: "The agent's own words.",
          chapterIndex: 1,
        },
      ],
    };
    const s = startServer({ review: withFindings, cwd: dir, source: localGitSource(dir) });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/done`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-review-buddy-token": s.token },
        body: JSON.stringify({
          verdict: "approve",
          findings: [
            { id: "f1", decision: "dismiss", reason: "intentional" },
            { id: "stale", decision: "fix" },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const done = await s.done;
      // The location, severity and title come from the review, not the browser,
      // and the agent's own body does not travel back.
      expect(done.answered).toEqual([
        {
          path: "app.ts",
          line: 2,
          start_line: undefined,
          side: "new",
          severity: "important",
          title: "b is wrong",
          decision: "dismiss",
          reason: "intentional",
        },
      ]);
      expect(done.findings).toHaveLength(2); // what the viewer sent, as it sent it
    } finally {
      s.stop();
    }
  });

  test("POST /api/done with nothing answered carries no answers", async () => {
    const s = startServer({ review, cwd: dir, source: localGitSource(dir) });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/done`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-review-buddy-token": s.token },
        body: JSON.stringify({ verdict: "approve", findings: [{ id: "f1", decision: "fix" }] }),
      });
      expect(res.status).toBe(200);
      expect((await s.done).answered).toBeUndefined();
    } finally {
      s.stop();
    }
  });

  test("POST /api/done hands what the reviewer sent to onDone, before done resolves", async () => {
    const seen: DoneResult[] = [];
    const s = startServer({
      review,
      cwd: dir,
      source: localGitSource(dir),
      onDone: (r) => seen.push(r),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/done`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-review-buddy-token": s.token },
        body: JSON.stringify({ verdict: "request_changes", viewed: ["app.ts"] }),
      });
      expect(res.status).toBe(200);
      // Called by the time the response is out, so the round is recorded
      // before the hook tears the server down.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ verdict: "request_changes", viewed: ["app.ts"] });
      expect((await s.done).verdict).toBe("request_changes");
    } finally {
      s.stop();
    }
  });

  test("POST /api/done: a malformed viewed list refuses the body, and records nothing", async () => {
    let calls = 0;
    const s = startServer({
      review,
      cwd: dir,
      source: localGitSource(dir),
      onDone: () => calls++,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/done`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-review-buddy-token": s.token },
        body: JSON.stringify({ verdict: "request_changes", viewed: ["app.ts", 7] }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("viewed") });
      expect(calls).toBe(0);
    } finally {
      s.stop();
    }
  });

  test("POST /api/done: an onDone that throws does not cost the reviewer their verdict", async () => {
    const s = startServer({
      review,
      cwd: dir,
      source: localGitSource(dir),
      onDone: () => {
        throw new Error("state folder is read-only");
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/done`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-review-buddy-token": s.token },
        body: JSON.stringify({ verdict: "approve", summary: "good" }),
      });
      expect(res.status).toBe(200);
      expect((await s.done).summary).toBe("good");
    } finally {
      s.stop();
    }
  });

  test("a second verdict is refused: one review, one verdict, one recorded round", async () => {
    const seen: DoneResult[] = [];
    const s = startServer({
      review,
      cwd: dir,
      source: localGitSource(dir),
      onDone: (r) => seen.push(r),
    });
    try {
      const post = (body: unknown) =>
        fetch(`http://127.0.0.1:${s.port}/api/done`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-review-buddy-token": s.token },
          body: JSON.stringify(body),
        });
      // The server keeps serving for a moment after the first Done (the
      // response has to flush), so a second tab of the same review can post
      // in that window.
      expect((await post({ verdict: "request_changes", viewed: ["app.ts"] })).status).toBe(200);
      const second = await post({ verdict: "approve" });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ error: expect.stringContaining("already") });
      // The approval neither reaches the agent nor clears the round the first
      // verdict stored.
      expect(seen).toEqual([{ verdict: "request_changes", viewed: ["app.ts"] }]);
      expect((await s.done).verdict).toBe("request_changes");
    } finally {
      s.stop();
    }
  });

  test("a malformed body is not a submission: the reviewer can still finish", async () => {
    const s = startServer({ review, cwd: dir, source: localGitSource(dir) });
    try {
      const post = (body: string) =>
        fetch(`http://127.0.0.1:${s.port}/api/done`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-review-buddy-token": s.token },
          body,
        });
      expect((await post('{"verdict":"nope"}')).status).toBe(400);
      expect((await post("{ not json")).status).toBe(400);
      expect((await post('{"verdict":"approve"}')).status).toBe(200);
      expect((await s.done).verdict).toBe("approve");
    } finally {
      s.stop();
    }
  });

  test("the server never calls onDone when it is stopped instead of finished", async () => {
    let calls = 0;
    const s = startServer({
      review,
      cwd: dir,
      source: localGitSource(dir),
      onDone: () => calls++,
    });
    s.stop();
    expect((await s.done).superseded).toBe(true);
    expect(calls).toBe(0);
  });

  test("POST /api/done rejects an oversized body (content-length guard)", async () => {
    const agent: AgentReview = {
      prologue: {
        why: "w",
        what: "x",
        key_changes: [
          { headline: "h1", detail: "d1" },
          { headline: "h2", detail: "d2" },
        ],
        review_focus: { summary: "s", file: "app.ts" },
      },
      chapters: [
        {
          index: 1,
          title: "Tweak b",
          risk: "Low",
          risk_reason: "trivial",
          description: "changes b",
          files: [{ path: "app.ts", change_type: "modified" }],
        },
      ],
    };
    const pr: PrMetadata = capturePr(dir, base);
    const { review } = resolveReview(agent, await captureDiff(dir, base), META, pr);
    const s = startServer({ review, cwd: dir, source: localGitSource(dir) });
    try {
      // fetch overwrites Content-Length from the real body — curl can forge it.
      const proc = Bun.spawn([
        "curl",
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-X",
        "POST",
        "-H",
        "content-type: application/json",
        "-H",
        `content-length: ${256 * 1024 + 1}`,
        "-H",
        `x-review-buddy-token: ${s.token}`,
        "-d",
        "{}",
        `http://127.0.0.1:${s.port}/api/done`,
      ]);
      const code = (await new Response(proc.stdout).text()).trim();
      await proc.exited;
      expect(code).toBe("413");
    } finally {
      s.stop();
    }
  });

  async function startUiServer(uiDir: string): Promise<RunningServer> {
    const agent: AgentReview = {
      prologue: {
        why: "w",
        what: "x",
        key_changes: [
          { headline: "h1", detail: "d1" },
          { headline: "h2", detail: "d2" },
        ],
        review_focus: { summary: "s", file: "app.ts" },
      },
      chapters: [
        {
          index: 1,
          title: "Tweak b",
          risk: "Low",
          risk_reason: "trivial",
          description: "changes b",
          files: [{ path: "app.ts", change_type: "modified" }],
        },
      ],
    };
    const pr: PrMetadata = capturePr(dir, base);
    const { review } = resolveReview(agent, await captureDiff(dir, base), META, pr);
    return startServer({ review, cwd: dir, source: localGitSource(dir), uiDir });
  }

  test("serves index and assets from uiDir", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rb-ui-parent-"));
    const uiDir = join(parent, "ui");
    mkdirSync(join(uiDir, "assets"), { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<html>UI</html>");
    writeFileSync(join(uiDir, "assets", "app.js"), "console.log('app')");
    const s = await startUiServer(uiDir);
    try {
      const indexRes = await fetch(`http://127.0.0.1:${s.port}/`);
      const index = await indexRes.text();
      expect(index).toContain("UI");
      expect(indexRes.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(indexRes.headers.get("x-content-type-options")).toBe("nosniff");

      const asset = await fetch(`http://127.0.0.1:${s.port}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("console.log('app')");
      expect(asset.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      s.stop();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("SPA fallback serves index.html for unknown routes", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rb-ui-parent-"));
    const uiDir = join(parent, "ui");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<html>UI</html>");
    const s = await startUiServer(uiDir);
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/nonexistent`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("UI");
    } finally {
      s.stop();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("static serving never escapes uiDir via traversal", async () => {
    const parent = mkdtempSync(join(tmpdir(), "rb-ui-parent-"));
    const uiDir = join(parent, "ui");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<html>UI</html>");
    writeFileSync(join(parent, "secret.txt"), "TOPSECRET");
    const s = await startUiServer(uiDir);
    try {
      const curlBody = async (path: string) => {
        const proc = Bun.spawn(["curl", "-s", "--path-as-is", `http://127.0.0.1:${s.port}${path}`]);
        const body = await new Response(proc.stdout).text();
        await proc.exited;
        return body;
      };

      const passwd = await curlBody("/../../../../etc/passwd");
      expect(passwd).not.toContain("TOPSECRET");
      expect(passwd).toContain("UI");

      const encoded = await curlBody("/..%2f..%2fsecret.txt");
      expect(encoded).not.toContain("TOPSECRET");
      expect(encoded).toContain("UI");

      // One level up resolves to <parent>/secret.txt — the real sentinel.
      // WITHOUT the guard, join(uiDir, "../secret.txt") exists and would be
      // served; WITH it, the ".." segment forces the SPA fallback. This is the
      // assertion that actually fails if containment breaks.
      const oneUp = await curlBody("/..%2fsecret.txt");
      expect(oneUp).not.toContain("TOPSECRET");
      expect(oneUp).toContain("UI");
    } finally {
      s.stop();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("malformed percent-encoding yields 404, not a 500", async () => {
    const uiDir = mkdtempSync(join(tmpdir(), "rb-ui-"));
    writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>x</title>");
    const agent: AgentReview = {
      prologue: {
        why: "w",
        what: "x",
        key_changes: [
          { headline: "h1", detail: "d1" },
          { headline: "h2", detail: "d2" },
        ],
        review_focus: { summary: "s", file: "app.ts" },
      },
      chapters: [
        {
          index: 1,
          title: "Tweak b",
          risk: "Low",
          risk_reason: "trivial",
          description: "changes b",
          files: [{ path: "app.ts", change_type: "modified" }],
        },
      ],
    };
    const pr: PrMetadata = capturePr(dir, base);
    const { review } = resolveReview(agent, await captureDiff(dir, base), META, pr);
    const s = startServer({ review, cwd: dir, source: localGitSource(dir), uiDir });
    try {
      const proc = Bun.spawn([
        "curl",
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-H",
        `x-review-buddy-token: ${s.token}`,
        `http://127.0.0.1:${s.port}/%`,
      ]);
      const code = (await new Response(proc.stdout).text()).trim();
      await proc.exited;
      expect(code).toBe("404");
    } finally {
      s.stop();
      rmSync(uiDir, { recursive: true, force: true });
    }
  });
});
