import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentReview, PrMetadata, ReviewMeta } from "../types/review.ts";
import { captureDiff, capturePr, resolveBase } from "./git.ts";
import { type RunningServer, startServer } from "./http.ts";
import { resolveReview } from "./resolve.ts";

let dir: string;
let server: RunningServer;
let base: string;

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
  const { review } = resolveReview(agent, await captureDiff(dir, base), META, pr);
  server = await startServer({ review, cwd: dir, baseRef: base });
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
    const s = await startServer({ review, cwd: dir, baseRef: base, roundtrip: true });
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
    const s = await startServer({ review, cwd: dir, baseRef: base, headRef: null });
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

  test("POST /api/done unblocks the hook", async () => {
    const res = await (
      await authed("api/done", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict: "approve" }),
      })
    ).json();
    expect(res.ok).toBe(true);
    const done = await server.done;
    expect(done.verdict).toBe("approve");
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
    const s = await startServer({ review, cwd: dir, baseRef: base });
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
    return await startServer({ review, cwd: dir, baseRef: base, uiDir });
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
    const s = await startServer({ review, cwd: dir, baseRef: base, uiDir });
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
