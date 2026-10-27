/**
 * Electron main: one window that shows a review in the shared viewer.
 *
 * Security (see docs/DESIGN-desktop-app-shared-code.md §4): the renderer has
 * no Node access (contextIsolation, no nodeIntegration, sandbox) and talks to
 * main only through the preload's small IPC API. The built renderer is served
 * from app:// with the plugin viewer's CSP. Links open in the system browser;
 * the window never navigates away from the app.
 */
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { app, BrowserWindow, protocol, session, shell } from "electron";
import { FIXTURE_REVIEW_KEY } from "../shared/ipc.ts";
import { loadFixtureReview } from "./fixture/index.ts";
import { registerReviewIpc } from "./ipc.ts";
import { ReviewStore } from "./reviews.ts";
import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
  appFilePath,
  isExternalWebUrl,
  isRendererUrl,
  rendererCsp,
} from "./security.ts";

// electron-vite sets this for `dev`. Ignored in a packaged app, so an env var
// can never point the window at another page.
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const rendererDir = join(import.meta.dirname, "../renderer");

// The Vite build emits only these (the viewer inlines its fonts and icons).
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

// Must run before `ready`. "standard" + "secure" give app:// a real origin, so
// CSP 'self', ES module scripts and module workers work as on https.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const isTrustedPage = (url: string) => isRendererUrl(url, devServerUrl);

function openExternal(url: string): void {
  if (isExternalWebUrl(url)) void shell.openExternal(url);
}

/** Serves the built renderer (out/renderer) on app://renderer/ with the CSP. */
function serveRenderer(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = url.host === APP_HOST ? appFilePath(rendererDir, url.pathname) : null;
    if (!file) return new Response("Not found", { status: 404 });
    try {
      return new Response(await readFile(file), {
        headers: {
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
          "content-security-policy": rendererCsp(false),
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function hardenSessions(): void {
  // Only the clipboard write behind "copy" buttons; no camera, notifications, …
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });
  if (devServerUrl) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [rendererCsp(true)],
        },
      });
    });
  }
}

app.on("web-contents-created", (_event, contents) => {
  // target=_blank links and window.open: system browser, never a new window.
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isTrustedPage(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: "Review Buddy",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  void win.loadURL(devServerUrl ?? APP_URL);
  return win;
}

app.whenReady().then(async () => {
  const store = new ReviewStore();
  const fixture = await loadFixtureReview();
  for (const warning of fixture.warnings) console.warn(`[review-buddy] fixture: ${warning}`);
  store.add(FIXTURE_REVIEW_KEY, fixture.review, fixture.source);

  hardenSessions();
  serveRenderer();
  registerReviewIpc(store, isTrustedPage);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
