/**
 * Local HTTP server for one review. Runs on an ephemeral port (Plannotator
 * pattern) and exposes its endpoints:
 *
 *   GET  /api/review        -> the merged ResolvedReview (sources A+B+computed)
 *   GET  /api/config        -> { roundtrip } — REVIEW_BUDDY_ROUNDTRIP flag for the client
 *   GET  /api/file-content  -> full file for expand/word-level (source C)
 *   POST /api/done          -> reviewer closed the viewer; unblocks the hook
 *
 * `done` resolves when the reviewer is finished, which is how the blocking
 * PreToolUse hook knows to return control to the agent.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { languageOf } from "@review-buddy/core/diff";
import { allowedPaths } from "@review-buddy/core/resolve";
import type { ReviewDataSource } from "@review-buddy/core/source";
import type { ResolvedReview } from "@review-buddy/core/types";
import { VIEWER_CSP } from "@review-buddy/core/viewer-csp";

/** True iff `rel` resolves lexically inside `root` (blocks `..` only; does not dereference symlinks — link escape is guarded at read time in fileContent). */
function isInside(root: string, rel: string): boolean {
  const r = resolve(root);
  const t = resolve(root, rel);
  return t === r || t.startsWith(r + sep);
}

export interface ServerContext {
  review: ResolvedReview;
  /** Repo root — /api/file-content paths must resolve inside it. */
  cwd: string;
  /** Serves /api/file-content (source C) for allowlisted paths. */
  source: Pick<ReviewDataSource, "fileContent">;
  /** Directory of the built React UI (ui/dist). Falls back to a placeholder. */
  uiDir?: string;
  /** Phase 2 spike: REVIEW_BUDDY_ROUNDTRIP — exposes the verdict UI via /api/config. */
  roundtrip?: boolean;
}

export interface DoneResult {
  /** Round-trip verdict. Absent/other ⇒ treated as approve (fail-open). */
  verdict?: "approve" | "request_changes";
  /** Reviewer's overall note when requesting changes (markdown). */
  summary?: string;
  /** True when the server was stopped before the reviewer finished (e.g. a
   *  newer review superseded it) — `stop()` settles `done` with this so
   *  awaiting callers never hang on a server that can't receive /api/done. */
  superseded?: boolean;
}

export interface RunningServer {
  port: number;
  /** Per-server secret required on every /api/* request (in the browser URL). */
  token: string;
  /** Browser URL, loopback + token: http://127.0.0.1:<port>/?token=<token> */
  url: string;
  /**
   * Resolution notes from `ctx.review.warnings` — the agent-feedback channel
   * (same list the viewer renders). Callers use this so they don't re-resolve.
   */
  warnings: readonly string[];
  done: Promise<DoneResult>;
  stop: () => void;
}

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);

// A verdict summary is short prose; anything larger is malformed/abusive.
const MAX_DONE_BODY = 256 * 1024;

function withViewerHeaders(res: Response): Response {
  res.headers.set("content-security-policy", VIEWER_CSP);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

/** Constant-time string equality (hash first: equal length, no early exit). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });

export function startServer(ctx: ServerContext): RunningServer {
  let resolveDone!: (r: DoneResult) => void;
  const done = new Promise<DoneResult>((res) => {
    resolveDone = res;
  });

  // Only files that are actually part of this review may be fetched via
  // /api/file-content — the tightest defense against path traversal.
  const allowed = allowedPaths(ctx.review);

  const token = crypto.randomUUID();

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1", // loopback only — never exposed on the LAN
    // Max keep-alive idle (seconds). The reviewer's browser reconnects per
    // request, so this doesn't cap the (potentially multi-day) hook block; it
    // just avoids tearing down connections mid-review. NOT 0 — in Bun, 0 closes
    // idle connections immediately rather than disabling the timeout.
    idleTimeout: 240,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      // Reject non-loopback Host headers (defeats DNS rebinding: the browser
      // sends the attacker-controlled hostname, which won't be localhost).
      const host = (req.headers.get("host") ?? "").split(":")[0] ?? "";
      if (!ALLOWED_HOSTS.has(host)) {
        return json({ error: "forbidden host" }, 403);
      }

      // Sensitive data (source code, diffs) lives behind /api/* — require the
      // per-server token. Blocks a malicious local page that scans the port
      // but can't know the token, and CSRF on /api/done.
      if (pathname.startsWith("/api/")) {
        const supplied = req.headers.get("x-review-buddy-token") ?? url.searchParams.get("token");
        if (!supplied || !safeEqual(supplied, token)) return json({ error: "unauthorized" }, 401);
      }

      if (pathname === "/api/review") {
        return json(ctx.review);
      }

      if (pathname === "/api/config") {
        return json({ roundtrip: ctx.roundtrip ?? false });
      }

      if (pathname === "/api/file-content") {
        const path = url.searchParams.get("path");
        const side = url.searchParams.get("side") === "base" ? "base" : "head";
        if (!path) return json({ error: "missing ?path" }, 400);
        // Allowlist (review files only) + containment guard against traversal.
        if (!allowed.has(path)) return json({ error: "unknown path" }, 403);
        if (!isInside(ctx.cwd, path)) return json({ error: "path outside repo" }, 400);
        const content = await ctx.source.fileContent(path, side);
        return json({ path, side, language: languageOf(path), content });
      }

      if (pathname === "/api/done" && req.method === "POST") {
        const len = Number(req.headers.get("content-length") ?? "0");
        if (len > MAX_DONE_BODY) return json({ error: "body too large" }, 413);
        let body: DoneResult = {};
        try {
          body = (await req.json()) as DoneResult;
        } catch {
          /* empty body is fine */
        }
        // Resolve on the next tick so THIS response flushes to the client
        // before the hook tears the server down (otherwise the client sees an
        // empty reply / connection reset).
        setTimeout(() => resolveDone(body), 50);
        return json({ ok: true });
      }

      // Static: built UI when available, else a placeholder viewer.
      if (ctx.uiDir) {
        let decoded: string;
        try {
          decoded = decodeURIComponent(pathname);
        } catch {
          return new Response("Not found", { status: 404 });
        }
        const rel = pathname === "/" ? "index.html" : decoded.replace(/^\/+/, "");
        // Reject traversal before touching the filesystem.
        const safe = !rel.split("/").includes("..") && isInside(ctx.uiDir, rel);
        const file = join(ctx.uiDir, rel);
        if (safe && existsSync(file)) return withViewerHeaders(new Response(Bun.file(file)));
        // SPA fallback.
        const index = join(ctx.uiDir, "index.html");
        if (existsSync(index)) return withViewerHeaders(new Response(Bun.file(index)));
      }

      if (pathname === "/") {
        return new Response(placeholderHtml(), {
          headers: {
            "content-type": "text/html",
            "content-security-policy":
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
          },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  const port = server.port ?? 0; // assigned once listening
  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    warnings: ctx.review.warnings,
    done,
    stop: () => {
      server.stop(); // graceful: let any in-flight response finish
      // A stopped server can never receive /api/done — settle `done` so any
      // awaiting caller unblocks. No-op when the reviewer already resolved it.
      resolveDone({ superseded: true });
    },
  };
}

/**
 * Minimal stand-in for the React app so the hook->server->browser loop is
 * testable before Phase 1 step 5 (the real viewer) is built. Fetches
 * /api/review and renders the prologue + chapter list with a Done button.
 */
function placeholderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Review Buddy</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 2rem;
         max-width: 960px; margin-inline: auto; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  .risk { font-size: .72rem; font-weight: 700; padding: .1rem .45rem; border-radius: 999px;
          text-transform: uppercase; letter-spacing: .03em; }
  .High { background:#fde2e1; color:#b42318; } .Medium { background:#fef0c7; color:#b54708; }
  .Low { background:#dcfae6; color:#067647; }
  .chapter { border:1px solid #e3e3e3; border-radius:10px; padding:1rem; margin:.6rem 0; }
  .meta { color:#888; font-size:.85rem; }
  pre { background:#f5f5f5; padding:1rem; border-radius:8px; overflow:auto; font-size:12px; }
  button { font-size:1rem; padding:.6rem 1.4rem; border-radius:8px; border:0;
           background:#1f6feb; color:#fff; cursor:pointer; margin-top:2rem; }
  ul { padding-left:1.1rem; }
</style>
</head>
<body>
  <div id="app">Loading review…</div>
  <button id="done">Done — return to agent</button>
<script type="module">
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  const riskClass = (x) => (["Low","Medium","High"].includes(x) ? x : "Low");
  const token = new URLSearchParams(location.search).get("token") || "";
  const authHeaders = { "x-review-buddy-token": token };
  const r = await (await fetch("/api/review", { headers: authHeaders })).json();
  const kc = r.prologue.key_changes.map(k => '<li><b>'+esc(k.headline)+'</b> — '+esc(k.detail)+'</li>').join("");
  const chapters = r.chapters.map(c =>
    '<div class="chapter"><span class="risk '+riskClass(c.risk)+'">'+esc(c.risk)+'</span> '+
    '<b>'+esc(c.title)+'</b> <span class="meta">+'+c.additions+' −'+c.deletions+
    ' · '+c.fileCount+' file(s)</span><p>'+esc(c.description)+'</p></div>').join("");
  document.getElementById("app").innerHTML =
    '<h1>'+esc(r.pr.title)+'</h1>'+
    '<p class="meta">'+esc(r.pr.author)+' · '+esc(r.pr.base)+' ← '+esc(r.pr.head)+
    ' · +'+r.stats.additions+' −'+r.stats.deletions+' across '+r.stats.filesChanged+' file(s)'+
    (r.meta.aiGenerated ? ' · <b>AI-generated</b> by '+esc(r.meta.generatedBy) : '')+'</p>'+
    '<h2>Why</h2><p>'+esc(r.prologue.why)+'</p>'+
    '<h2>What</h2><p>'+esc(r.prologue.what)+'</p>'+
    '<h2>Key changes</h2><ul>'+kc+'</ul>'+
    '<h2>Review focus</h2><p>'+esc(r.prologue.review_focus.summary)+
    ' <code>'+esc(r.prologue.review_focus.file)+'</code></p>'+
    '<h2>Chapters</h2>'+chapters;
  document.getElementById("done").onclick = async () => {
    await fetch("/api/done", { method: "POST", headers: {"content-type":"application/json", ...authHeaders}, body: "{}" });
    document.body.innerHTML = "<h1>Review submitted. You can close this tab.</h1>";
  };
</script>
</body>
</html>`;
}
