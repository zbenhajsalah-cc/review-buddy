/**
 * Security rules for the renderer, kept free of Electron imports so they are
 * unit-tested. The review text comes from PRs and the agent: treat everything
 * the renderer shows, and every IPC call it makes, as untrusted.
 */
import { VIEWER_CSP } from "@review-buddy/core/viewer-csp";

/** The built renderer is served from app://renderer/, never from file://. */
export const APP_SCHEME = "app";
export const APP_HOST = "renderer";
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/**
 * The renderer's CSP: the plugin viewer's rules. The Vite dev server also
 * needs React Refresh's inline script and the HMR websocket; dev only.
 */
export function rendererCsp(dev: boolean): string {
  if (!dev) return VIEWER_CSP;
  return VIEWER_CSP.replace("connect-src 'self'", "connect-src 'self' ws://localhost:*").concat(
    "; script-src 'self' 'unsafe-inline'",
  );
}

/**
 * True if `url` is a page of our renderer: the app:// origin, or the Vite dev
 * server in dev. Used for IPC senders and in-app navigation. (Compares scheme
 * and host: `URL.origin` is "null" for custom schemes.)
 */
export function isRendererUrl(url: string, devServerUrl: string | undefined): boolean {
  const u = parse(url);
  if (!u) return false;
  if (u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST) return true;
  const dev = devServerUrl ? parse(devServerUrl) : null;
  return !!dev && u.protocol === dev.protocol && u.host === dev.host;
}

/** Links the system browser may open: web pages only (no file:, no custom schemes). */
export function isExternalWebUrl(url: string): boolean {
  const u = parse(url);
  return !!u && (u.protocol === "https:" || u.protocol === "http:");
}

/**
 * Maps an app:// request path to a file under `root`, or null if it leaves
 * `root` (path traversal). `root` is an absolute directory without a trailing
 * slash; `/` serves index.html.
 */
export function appFilePath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." || part.includes("\\") || part.includes("\0")) return null;
    parts.push(part);
  }
  return `${root}/${parts.length ? parts.join("/") : "index.html"}`;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
