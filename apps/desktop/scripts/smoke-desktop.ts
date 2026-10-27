/**
 * Smoke test of the built desktop app (out/): launches the real Electron app
 * with Playwright and checks the fixture review end to end — the viewer
 * renders, "Expand full file" gets file bytes over IPC, the security settings
 * hold, links go to the system browser, and "Done" reaches main.
 *
 *   pnpm --filter desktop smoke     (builds first; on Linux without a display,
 *                                    run it under `xvfb-run -a`)
 *   node scripts/smoke-desktop.ts --executable release/linux-unpacked/review-buddy
 *                                   (the same checks on a packaged app)
 */
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference path="../src/renderer/src/env.d.ts" />
// (page.evaluate callbacks run in the renderer: DOM types and window.reviewBuddy.)
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";

const appDir = join(import.meta.dirname, "..");
const flag = process.argv.indexOf("--executable");
// A packaged app is its own executable; in the repo, the electron binary runs appDir.
const packaged = flag >= 0 ? process.argv[flag + 1] : undefined;
// The electron package's main export is the path of its binary.
const electronPath = createRequire(join(appDir, "package.json"))("electron") as string;

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`FAIL: ${what}`);
  console.log(`ok - ${what}`);
}

/** All text in the page, including open shadow roots (the diff renders in one). */
function pageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? "");
      const shadow = (node as Element).shadowRoot;
      if (shadow) walk(shadow);
      for (const child of node.childNodes) walk(child);
    };
    walk(document.body);
    return parts.join("");
  });
}

async function waitForText(page: Page, text: string, present = true): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await pageText(page)).includes(text) === present) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`FAIL: timed out waiting for "${text}" to ${present ? "appear" : "disappear"}`);
}

const userDataDir = mkdtempSync(join(tmpdir(), "rb-desktop-smoke-"));
const app: ElectronApplication = await _electron.launch({
  executablePath: packaged ?? electronPath,
  // Chromium refuses to run as root with its sandbox on (CI containers).
  args: [
    ...(packaged ? [] : [appDir]),
    // A fresh profile: no saved GitHub token or settings from a real run.
    `--user-data-dir=${userDataDir}`,
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
  ],
  cwd: appDir,
});
const mainLog: string[] = [];
app.process().stdout?.on("data", (d) => mainLog.push(String(d)));

try {
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.getByText("Friendlier greetings and calmer retries").first().waitFor();
  check(page.url().startsWith("app://renderer/"), `renderer served from app:// (${page.url()})`);

  // Security settings, as main applied them and as the page sees them.
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences is internal (not in Electron's types). If it goes
    // away, this check fails loudly rather than passing.
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): Record<string, unknown>;
    };
    const p = wc.getLastWebPreferences();
    return {
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
      sandbox: p.sandbox,
    };
  });
  check(
    prefs.contextIsolation === true && prefs.nodeIntegration === false && prefs.sandbox === true,
    `webPreferences ${JSON.stringify(prefs)}`,
  );
  // Chapter 1 (src/retry.ts), then "Expand full file": line 21 is outside every
  // hunk, so it can only come from the file bytes sent over IPC.
  await page.keyboard.press("Enter");
  await waitForText(page, "Retry backoff with jitter");
  await waitForText(page, "lastError = error;");
  const sleepLine = "function sleep(ms: number): Promise<void> {";
  check(!(await pageText(page)).includes(sleepLine), "collapsed diff hides unchanged lines");
  await page
    .getByRole("button", { name: /expand/i })
    .first()
    .click();
  await waitForText(page, sleepLine);
  check(true, "expand full file shows lines from the head file over IPC");

  // Done reaches main.
  await page.getByRole("button", { name: /^done/i }).first().click();
  await page.getByText("Review submitted").waitFor();
  await page.waitForTimeout(300);
  check(mainLog.join("").includes("review fixture done"), "Done reaches main over IPC");

  // GitHub settings (US-10). The result depends on the machine: signed in
  // through a logged-in gh, or not connected.
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  check(userData === userDataDir, "the app uses the smoke test's own profile");
  await page.getByRole("button", { name: /^(GitHub: @|Connect GitHub)/ }).click();
  await page.getByText("Settings").first().waitFor();
  await page.getByText(/^(Signed in as|Not connected)/).waitFor();
  const statusKeys = await page.evaluate(async () =>
    Object.keys(await window.reviewBuddy.github.status()),
  );
  check(
    statusKeys.every((k) =>
      ["signedIn", "login", "name", "source", "tokenStorage", "ghInstalled", "error"].includes(k),
    ),
    `the GitHub status has no token (${statusKeys.join()})`,
  );
  if (await page.getByText(/^Signed in as/).isVisible()) {
    check(
      true,
      `signed in through ${(await page.getByText(/^From the GitHub CLI/).isVisible()) ? "gh" : "a token"}`,
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByText("Not connected.").waitFor();
    check(true, "sign out");
  }
  const tokenField = page.getByLabel("Personal access token");
  const signInWith = async (token: string) => {
    await tokenField.fill(token);
    await page.getByRole("button", { name: "Sign in" }).click();
  };
  await signInWith("not a token");
  await page.getByText("That does not look like a GitHub token.").waitFor();
  check(
    (await tokenField.inputValue()) === "",
    "a malformed token is refused and cleared from the form",
  );

  // Sign in with a pasted token against a fake GitHub: main's net.fetch is
  // replaced, so this runs the same everywhere (no network, no real token).
  await app.evaluate(({ net }) => {
    net.fetch = async (input, init) => {
      const auth = new Headers(init?.headers).get("authorization");
      const ok = String(input) === "https://api.github.com/user" && auth === "Bearer ghp_smoke";
      return ok
        ? Response.json({ login: "octocat", name: "Mona" })
        : Response.json({ message: "Bad credentials" }, { status: 401 });
    };
  });
  await signInWith("ghp_wrong");
  await page.getByText("GitHub rejected this token.", { exact: false }).waitFor();
  check(true, "a token GitHub rejects is refused");
  await signInWith("ghp_smoke");
  await page.getByText(/^Signed in as @octocat/).waitFor();
  await page.getByRole("button", { name: "GitHub: @octocat" }).waitFor();
  const encrypted = await page.getByText(/saved encrypted/).isVisible();
  const saved = await app.evaluate(async ({ app }) => {
    // (no import() inside evaluate)
    const fs = process.getBuiltinModule("node:fs/promises");
    return fs.readFile(`${app.getPath("userData")}/github-token`).then(
      (b) => b.toString("latin1"),
      () => null,
    );
  });
  check(
    encrypted ? saved !== null && !saved.includes("ghp_smoke") : saved === null,
    encrypted
      ? "a pasted token is saved encrypted (the file does not contain it)"
      : "no OS keychain here: the token is kept in memory, nothing is written",
  );
  check(!(await pageText(page)).includes("ghp_smoke"), "the token is not in the page");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByText("Not connected.").waitFor();
  const afterSignOut = await app.evaluate(async ({ app }) => {
    // (no import() inside evaluate)
    const fs = process.getBuiltinModule("node:fs/promises");
    return fs.access(`${app.getPath("userData")}/github-token`).then(
      () => "exists",
      () => "gone",
    );
  });
  check(afterSignOut === "gone", "sign out forgets the token");
  await page.getByRole("button", { name: "Back to review" }).click();
  await page
    .getByText("Review submitted")
    .or(page.getByText("Friendlier greetings"))
    .first()
    .waitFor();
  check(true, "back to the review");

  // The viewer flow ran without errors. (The probes below cause CSP errors on purpose.)
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // (Playwright's evaluate is exempt from the CSP's eval rule, so the CSP is
  // checked with an injected inline script and a remote fetch instead.)
  const inPage = await page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    script.textContent = "window.__inlineRan = true";
    document.head.append(script);
    const remoteFetch = await fetch("https://example.com/").then(
      () => "allowed",
      () => "blocked",
    );
    return {
      noNode: w.require === undefined && w.process === undefined,
      bridge: Object.entries(w.reviewBuddy as Record<string, object>)
        .flatMap(([group, calls]) => Object.keys(calls).map((call) => `${group}.${call}`))
        .sort(),
      inlineBlocked: w.__inlineRan === undefined,
      remoteFetch,
    };
  });
  check(inPage.noNode, "no Node globals in the renderer");
  check(
    inPage.bridge.join() ===
      "github.signInWithToken,github.signOut,github.status,github.useGh,review.done,review.getConfig,review.getFileContent,review.getReview",
    `preload exposes only the review and GitHub calls (${inPage.bridge.join()})`,
  );
  check(inPage.inlineBlocked, "CSP blocks inline scripts");
  check(inPage.remoteFetch === "blocked", "CSP blocks fetching remote hosts");

  // IPC checks its arguments: only the review's own files, only known reviews.
  const ipc = await page.evaluate(async () => {
    const outcome = (p: Promise<unknown>) =>
      p.then(
        () => "resolved",
        (e) => String(e),
      );
    return {
      traversal: await outcome(
        window.reviewBuddy.review.getFileContent("fixture", "../package.json", "head"),
      ),
      unknownReview: await outcome(window.reviewBuddy.review.getReview("nope")),
    };
  });
  check(/unknown path/.test(ipc.traversal), "IPC refuses a file outside the review");
  check(/unknown review/.test(ipc.unknownReview), "IPC refuses an unknown review");

  // Links go to the system browser; the window never leaves the app. Last:
  // Playwright keeps waiting for the blocked navigation afterwards.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as Record<string, unknown>).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  await page.evaluate(() => {
    window.open("https://example.com/from-window-open");
    window.open("file:///etc/passwd");
  });
  await page.evaluate(() => {
    location.href = "https://example.com/from-navigation";
  });
  await page.waitForTimeout(500);
  const opened = await app.evaluate(
    () => (globalThis as Record<string, unknown>).__opened as string[],
  );
  check(
    opened.join() === "https://example.com/from-window-open,https://example.com/from-navigation",
    `web links open externally, file: does not (${opened.join()})`,
  );
  check(page.url().startsWith("app://renderer/"), "navigation away from the app is blocked");
  check(app.windows().length === 1, "no new windows");

  console.log("desktop smoke: all checks passed");
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
