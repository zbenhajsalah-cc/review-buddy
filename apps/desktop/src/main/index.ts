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
import desktopPrompt from "@review-buddy/core/prompts/review-desktop.md?raw";
import { app, BrowserWindow, net, protocol, safeStorage, session, shell } from "electron";
import { FIXTURE_REVIEW_KEY } from "../shared/ipc.ts";
import { type AgentCheckResult, runAgentCheck } from "./agent/check.ts";
import { claudeExecutablePath } from "./agent/executable.ts";
import { ReviewJobs } from "./agent/review-job.ts";
import { loadFixtureReview } from "./fixture/index.ts";
import { openGitHubPr } from "./github/api-source.ts";
import { GitHubAuth } from "./github/auth.ts";
import { findGh, ghAuthToken } from "./github/gh-cli.ts";
import { parsePrArg, runPrCheck } from "./github/pr-check.ts";
import { GitHubPulls } from "./github/pulls.ts";
import { GitHubRepos } from "./github/repos.ts";
import { TokenStore } from "./github/token-store.ts";
import { registerGitHubIpc, registerReviewIpc } from "./ipc.ts";
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
import { SettingsFile } from "./settings-file.ts";

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

/**
 * `--agent-check`: run the minimal Agent SDK query (US-09), print the result as
 * one JSON line, exit 0 if Claude answered. No window. Works the same in dev
 * (`pnpm --filter desktop agent-check`) and in a packaged app
 * (`<app> --agent-check`).
 */
async function agentCheck(): Promise<void> {
  // Loaded only here: the SDK is large and the normal start does not need it yet.
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  let result: AgentCheckResult;
  try {
    result = await runAgentCheck(query, {
      pathToClaudeCodeExecutable: claudeExecutablePath(),
      clientApp: `review-buddy-desktop/${app.getVersion()}`,
    });
  } catch (e) {
    // claudeExecutablePath throws when the platform binary is missing.
    result = { ok: false, durationMs: 0, error: String(e) };
  }
  console.log(`[review-buddy] agent-check ${JSON.stringify(result)}`);
  app.exit(result.ok ? 0 : 1);
}

/** Small app settings (never secrets) in the userData folder. */
function appSettings(): SettingsFile {
  return new SettingsFile(join(app.getPath("userData"), "settings.json"));
}

/** The app's GitHub login (US-10). The token lives here, in main, only. */
function createGitHubAuth(settings: SettingsFile): GitHubAuth {
  return new GitHubAuth({
    // Chromium's network stack: honors the system proxy settings.
    fetch: (url, init) => net.fetch(url, init),
    store: new TokenStore(join(app.getPath("userData"), "github-token"), safeStorage),
    ghDisabled: {
      get: async () => (await settings.read()).ghDisabled === true,
      set: (ghDisabled) => settings.update({ ghDisabled }),
    },
    ghToken: () => ghAuthToken(),
    ghInstalled: () => findGh() !== null,
  });
}

/** The login's repositories and the recently used ones (US-13). */
function createGitHubRepos(settings: SettingsFile, github: GitHubAuth): GitHubRepos {
  return new GitHubRepos({
    fetch: (url, init) => net.fetch(url, init),
    auth: github,
    recent: {
      get: async () => recentList((await settings.read()).recentRepos),
      update: (change) =>
        settings.update((current) => ({ recentRepos: change(recentList(current.recentRepos)) })),
    },
  });
}

function recentList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The agent reviews, one after another (US-12, US-14): GitHubApiSource with
 * the app's GitHub login, then the Agent SDK with the desktop prompt and the
 * review tools. The SDK is loaded on the first run only. A PR that opens makes
 * its repository "recently used".
 */
function createReviewJobs(store: ReviewStore, github: GitHubAuth, repos: GitHubRepos): ReviewJobs {
  return new ReviewJobs({
    store,
    open: async (ref, signal) => {
      const source = await openGitHubPr(ref, {
        fetch: (url, init) => net.fetch(url, init),
        token: () => github.token(),
        signal,
      });
      repos.markUsed(`${ref.owner}/${ref.repo}`).catch((e) => {
        console.warn(`[review-buddy] recent repos: ${e instanceof Error ? e.message : e}`);
      });
      return source;
    },
    run: async (source, label, onProgress, signal) => {
      const [{ query }, { runReview }] = await Promise.all([
        import("@anthropic-ai/claude-agent-sdk"),
        import("./agent/runner.ts"),
      ]);
      return runReview(query, {
        label,
        source,
        systemPrompt: desktopPrompt,
        pathToClaudeCodeExecutable: claudeExecutablePath(),
        clientApp: `review-buddy-desktop/${app.getVersion()}`,
        onProgress,
        signal,
      });
    },
    log: (line) => console.log(`[review-buddy] review-run ${line}`),
  });
}

/**
 * `--pr-check=<owner/repo#123 | PR URL>`: read a real PR through the GitHub API
 * with the app's GitHub login (US-11), print a summary as one JSON line, exit
 * 0/1. No window.
 */
async function prCheck(value: string): Promise<void> {
  const github = createGitHubAuth(appSettings());
  const result = await runPrCheck(async () =>
    openGitHubPr(parsePrArg(value), {
      fetch: (url, init) => net.fetch(url, init),
      token: () => github.token(),
    }),
  );
  console.log(`[review-buddy] pr-check ${JSON.stringify(result)}`);
  app.exit(result.ok ? 0 : 1);
}

app.whenReady().then(async () => {
  if (app.commandLine.hasSwitch("agent-check")) return agentCheck();
  if (app.commandLine.hasSwitch("pr-check")) {
    return prCheck(app.commandLine.getSwitchValue("pr-check"));
  }

  const store = new ReviewStore();
  const fixture = await loadFixtureReview();
  for (const warning of fixture.warnings) console.warn(`[review-buddy] fixture: ${warning}`);
  store.add(FIXTURE_REVIEW_KEY, fixture.review, fixture.source);
  const settings = appSettings();
  const github = createGitHubAuth(settings);
  const repos = createGitHubRepos(settings, github);
  const jobs = createReviewJobs(store, github, repos);
  const pulls = new GitHubPulls({
    fetch: (url, init) => net.fetch(url, init),
    auth: github,
    reviewOf: (label) => store.newestFor(label),
  });
  // Quitting stops the reviews (and their Claude Code process).
  app.on("before-quit", () => jobs.stopAll());

  hardenSessions();
  serveRenderer();
  registerReviewIpc(store, jobs, isTrustedPage);
  registerGitHubIpc(github, repos, pulls, isTrustedPage);
  createWindow();

  // `--review-pr=<owner/repo#123 | PR URL>`: start reviewing that PR at once.
  if (app.commandLine.hasSwitch("review-pr")) {
    try {
      jobs.start(app.commandLine.getSwitchValue("review-pr"));
    } catch (e) {
      console.error(`[review-buddy] --review-pr: ${e instanceof Error ? e.message : e}`);
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
