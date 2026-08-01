/**
 * A `Bun.serve`-shaped adapter over `node:http`, so the review server runs on
 * plain Node (the published npm package and the plugin both use `node`, not
 * `bun` — see docs/HARNESSES.md).
 *
 * The handler keeps the Web `Request` -> `Response` shape the server was
 * written against, which is what makes this a drop-in: every security check in
 * http.ts (Host validation, token gating, traversal guards) is untouched.
 */

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";

export interface FetchServer {
  port: number;
  stop: () => void;
}

/**
 * Max keep-alive idle (ms). The reviewer's browser reconnects per request, so
 * this doesn't cap the (potentially multi-day) hook block; it just avoids
 * tearing down connections mid-review.
 */
const KEEP_ALIVE_MS = 240_000;

/** Only what the built viewer actually emits, plus the usual static suspects. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * `Bun.file(path)` in a `Response` sets the content type from the extension;
 * Node has no equivalent, so do it explicitly. Read fully rather than stream:
 * these are the viewer's own bundled assets, not arbitrary user files.
 */
export function fileResponse(path: string): Response {
  const body = readFileSync(path);
  return new Response(body, {
    headers: { "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream" },
  });
}

/**
 * Wrap the request body as a lazy stream rather than buffering it up front.
 * Load-bearing: /api/done rejects an oversized `content-length` *before*
 * reading the body, and a forged header (declared huge, body tiny) must not
 * hang the server waiting for bytes that never arrive.
 */
function bodyStream(req: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      req.on("data", (chunk: Buffer) => {
        if (!closed) controller.enqueue(new Uint8Array(chunk));
      });
      req.on("end", close);
      // Client hung up, or we answered before reading it all — not an error
      // the handler needs to see; an unread body simply ends.
      req.on("error", close);
      req.on("aborted", close);
    },
    cancel() {
      req.destroy();
    },
  });
}

/**
 * Build a Web `Request` from a Node one. The URL is anchored to loopback
 * deliberately: the (attacker-controllable) Host header stays readable via
 * `request.headers.get("host")` for the DNS-rebinding check, but never decides
 * which origin we think we are.
 */
function toRequest(req: IncomingMessage, port: number): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(new URL(req.url ?? "/", `http://127.0.0.1:${port}`), {
    method,
    headers,
    // `duplex` is required whenever the body is a stream (undici/fetch spec)
    // but is missing from the DOM RequestInit types Node builds against.
    ...(hasBody ? { body: bodyStream(req), duplex: "half" } : {}),
  } as RequestInit);
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}

/**
 * Start a loopback HTTP server driven by a fetch-style handler. Async because
 * Node assigns the ephemeral port on `listen`, not on construction.
 */
export function serveFetch(opts: {
  hostname: string;
  fetch: (req: Request) => Response | Promise<Response>;
}): Promise<FetchServer> {
  const server = createServer();
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  // A review can sit open for days; never time out an in-flight request.
  server.requestTimeout = 0;
  server.timeout = 0;

  server.on("request", (req, res) => {
    const port = (server.address() as { port: number } | null)?.port ?? 0;
    void (async () => {
      try {
        await writeResponse(res, await opts.fetch(toRequest(req, port)));
        // Answered without draining the body (e.g. a rejected oversized POST):
        // the leftover bytes would be mis-parsed as the next keep-alive
        // request, so close the connection instead.
        if (!req.readableEnded) req.destroy();
      } catch (err) {
        console.error(`[review-buddy] request failed: ${String(err)}`);
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        res.end("Internal error");
      }
    })();
  });

  return new Promise<FetchServer>((resolve, reject) => {
    server.once("error", reject);
    // Port 0 = let the OS pick an ephemeral one.
    server.listen(0, opts.hostname, () => {
      server.removeListener("error", reject);
      resolve({
        port: (server.address() as { port: number } | null)?.port ?? 0,
        // Graceful: stop accepting, let in-flight responses finish. Idle
        // keep-alive sockets would hold the process open, so close those too.
        stop: () => {
          server.close();
          server.closeIdleConnections();
        },
      });
    });
  });
}
