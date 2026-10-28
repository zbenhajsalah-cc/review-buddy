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
import {
  app,
  BrowserWindow,
  dialog,
  Notification,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import { FIXTURE_REVIEW_KEY, IPC, type ReviewJobStatus } from "../shared/ipc.ts";
import { type AgentCheckResult, runAgentCheck } from "./agent/check.ts";
import { ClaudeCode } from "./agent/claude-code.ts";
import { ReviewJobs } from "./agent/review-job.ts";
import { loadFixtureReview } from "./fixture/index.ts";
import { openGitHubPr, prFileReader } from "./github/api-source.ts";
import { GitHubAuth } from "./github/auth.ts";
import { findGits, PrClones } from "./github/clones.ts";
import { findGh, ghAuthToken } from "./github/gh-cli.ts";
import { ReviewPosting } from "./github/post-review.ts";
import { parsePrArg, runPrCheck } from "./github/pr-check.ts";
import { GitHubPulls } from "./github/pulls.ts";
import { GitHubRepos } from "./github/repos.ts";
import { TokenStore } from "./github/token-store.ts";
import { registerClaudeIpc, registerGitHubIpc, registerReviewIpc } from "./ipc.ts";
import { jobNotice, pageUrlForJob } from "./job-notice.ts";
import { ReviewCache } from "./review-cache.ts";
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

// The Vite build emits only these (the viewer's icons are inline SVG; its
// self-hosted woff2 faces are emitted as files, being over the inline limit).
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
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

/** `openJob`: the page follows that job (see pageUrlForJob), not the newest. */
function createWindow(openJob?: number): BrowserWindow {
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
  const page = devServerUrl ?? APP_URL;
  void win.loadURL(openJob === undefined ? page : pageUrlForJob(page, openJob));
  return win;
}

/** Shown notifications, until closed: one garbage-collected early loses its click. */
const notifications = new Set<Notification>();

/**
 * A review ended while the app was in the background: say so. A click brings
 * the window back and shows that review (the renderer picks the saved review
 * once the job list has dropped the job).
 */
function notifyJobEnded(status: ReviewJobStatus): void {
  const notice = jobNotice(status);
  if (!notice || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
  const notification = new Notification(notice);
  notifications.add(notification);
  notification.on("close", () => notifications.delete(notification));
  notification.on("click", () => {
    notifications.delete(notification);
    const win = BrowserWindow.getAllWindows()[0];
    // No window (macOS keeps the app open): a new one, told which job.
    if (!win) {
      createWindow(status.id);
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    const page = win.webContents;
    if (isTrustedPage(page.getURL())) page.send(IPC.openReviewJob, status);
  });
  notification.show();
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
    const claude = await createClaudeCode(appSettings()).ready();
    result = {
      ...(await runAgentCheck(query, {
        pathToClaudeCodeExecutable: claude.path,
        clientApp: `review-buddy-desktop/${app.getVersion()}`,
      })),
      claudePath: claude.path,
    };
  } catch (e) {
    // No usable Claude Code (US-21): the message says what to do.
    result = { ok: false, durationMs: 0, error: e instanceof Error ? e.message : String(e) };
  }
  console.log(`[review-buddy] agent-check ${JSON.stringify(result)}`);
  app.exit(result.ok ? 0 : 1);
}

/**
 * The reviews main serves (US-16): this run's, and the saved ones in
 * `<userData>/reviews`, whose file reads go to GitHub at the saved SHAs.
 */
async function createReviewStore(github: GitHubAuth): Promise<ReviewStore> {
  const cache = new ReviewCache(join(app.getPath("userData"), "reviews"));
  await cache.load();
  return new ReviewStore({
    cache,
    reopen: (saved) => {
      const files = new Map(saved.files.map((f) => [f.path, f]));
      return {
        fileContent: prFileReader(
          parsePrArg(saved.pr),
          { headSha: saved.headSha, baseSha: saved.baseSha },
          async () => files,
          { fetch: (url, init) => net.fetch(url, init), token: () => github.token() },
        ),
      };
    },
    log: (line) => console.warn(`[review-buddy] reviews: ${line}`),
  });
}

/** Calls `fn` once, `ms` after the first of a burst of calls. */
function atMostEvery(ms: number, fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
}

/**
 * The user's installed Claude Code (US-21), at least the SDK's version; the
 * one chosen in Settings is kept in the app settings.
 */
function createClaudeCode(settings: SettingsFile): ClaudeCode {
  return new ClaudeCode({
    minVersion: __CLAUDE_CODE_MIN_VERSION__,
    chosen: {
      get: async () => {
        const path = (await settings.read()).claudePath;
        return typeof path === "string" && path ? path : undefined;
      },
      set: (claudePath) => settings.update({ claudePath }),
    },
  });
}

/** Settings → Choose…: a file dialog in main (the renderer never sends a path). */
async function chooseClaudePath(): Promise<string | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose your Claude Code (claude)",
    properties: ["openFile", "showHiddenFiles"],
    // A .cmd shim (npm on Windows) cannot be started without a shell.
    filters: process.platform === "win32" ? [{ name: "Claude Code", extensions: ["exe"] }] : [],
  };
  const win = BrowserWindow.getFocusedWindow();
  const answer = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return answer.canceled ? undefined : answer.filePaths[0];
}

/** Local copies of repositories, for PRs too large for the API (US-19). */
function createPrClones(github: GitHubAuth): PrClones {
  return new PrClones({
    dir: join(app.getPath("userData"), "clones"),
    git: () => findGits(),
    token: () => github.token(),
  });
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
function createReviewJobs(
  store: ReviewStore,
  github: GitHubAuth,
  repos: GitHubRepos,
  claudeCode: ClaudeCode,
  clones: PrClones,
): ReviewJobs {
  const jobs: ReviewJobs = new ReviewJobs({
    store,
    open: async (ref, signal, onProgress) => {
      const source = await openGitHubPr(ref, {
        fetch: (url, init) => net.fetch(url, init),
        token: () => github.token(),
        signal,
        // Too large for the API (US-19): git, from a local copy.
        largeDiff: (pr) => clones.diff(pr, (step) => onProgress({ phase: "github", step }), signal),
      });
      // Before the job shows the PR's head, which makes the repository list
      // read its recent repos again.
      await repos.markUsed(`${ref.owner}/${ref.repo}`).catch((e) => {
        console.warn(`[review-buddy] recent repos: ${e instanceof Error ? e.message : e}`);
      });
      return source;
    },
    run: async (source, label, onProgress, signal) => {
      // Checked again before each run: it may have been updated or removed
      // (throws a "claude" error that says what to do).
      const claude = await claudeCode.ready();
      const [{ query }, { runReview }] = await Promise.all([
        import("@anthropic-ai/claude-agent-sdk"),
        import("./agent/runner.ts"),
      ]);
      const result = await runReview(query, {
        label,
        source,
        systemPrompt: desktopPrompt,
        pathToClaudeCodeExecutable: claude.path,
        clientApp: `review-buddy-desktop/${app.getVersion()}`,
        onProgress,
        signal,
      });
      if (!result.ok && result.error && result.errorKind !== "stopped") {
        result.error += `\n(Claude Code ${claude.version}, ${claude.path})`;
      }
      return result;
    },
    log: (line) => console.log(`[review-buddy] review-run ${line}`),
    onEnded: notifyJobEnded,
    // Progress events (US-15): the whole list, to our own page only, at most
    // every 100 ms (a streamed review makes many small steps).
    onChange: atMostEvery(100, () => {
      const list = jobs.jobs();
      for (const win of BrowserWindow.getAllWindows()) {
        const page = win.webContents;
        if (isTrustedPage(page.getURL())) page.send(IPC.reviewJobsChanged, list);
      }
    }),
  });
  return jobs;
}

/**
 * `--pr-check=<owner/repo#123 | PR URL>`: read a real PR through the GitHub API
 * with the app's GitHub login (US-11), print a summary as one JSON line, exit
 * 0/1. No window.
 */
async function prCheck(value: string): Promise<void> {
  const github = createGitHubAuth(appSettings());
  const clones = createPrClones(github);
  let fromCopy = false;
  const result = await runPrCheck(async () =>
    openGitHubPr(parsePrArg(value), {
      fetch: (url, init) => net.fetch(url, init),
      token: () => github.token(),
      // The same fallback as a review (US-19): a PR too large for the API.
      largeDiff: (pr) => {
        fromCopy = true;
        return clones.diff(pr, (step) => console.log(`[review-buddy] pr-check: ${step}`));
      },
    }),
  );
  if (result.diff) result.diff.from = fromCopy ? "local copy" : "api";
  console.log(`[review-buddy] pr-check ${JSON.stringify(result)}`);
  app.exit(result.ok ? 0 : 1);
}

app.whenReady().then(async () => {
  if (app.commandLine.hasSwitch("agent-check")) return agentCheck();
  if (app.commandLine.hasSwitch("pr-check")) {
    return prCheck(app.commandLine.getSwitchValue("pr-check"));
  }

  const settings = appSettings();
  const github = createGitHubAuth(settings);
  const store = await createReviewStore(github);
  const fixture = await loadFixtureReview();
  for (const warning of fixture.warnings) console.warn(`[review-buddy] fixture: ${warning}`);
  store.add(FIXTURE_REVIEW_KEY, fixture.review, fixture.source);
  const repos = createGitHubRepos(settings, github);
  const claudeCode = createClaudeCode(settings);
  void claudeCode.check().then((status) => {
    const found = status.state === "ok" ? `${status.version} at ${status.path}` : status.message;
    console.log(`[review-buddy] claude code: ${status.state}: ${found}`);
  });
  const clones = createPrClones(github);
  const jobs = createReviewJobs(store, github, repos, claudeCode, clones);
  const pulls = new GitHubPulls({
    fetch: (url, init) => net.fetch(url, init),
    auth: github,
    reviewOf: (label) => store.newestFor(label),
  });
  // Quitting stops the reviews (and their Claude Code process).
  app.on("before-quit", () => jobs.stopAll());

  hardenSessions();
  serveRenderer();
  // Posting a review to GitHub (US-20), with the app's login.
  const posting = new ReviewPosting({
    fetch: (url, init) => net.fetch(url, init),
    auth: github,
    store,
  });
  registerReviewIpc(store, jobs, clones, posting, isTrustedPage);
  registerGitHubIpc(github, repos, pulls, isTrustedPage);
  registerClaudeIpc(claudeCode, chooseClaudePath, isTrustedPage);
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
