/**
 * Smoke test of the built desktop app (out/): launches the real Electron app
 * with Playwright and checks the fixture review end to end — the viewer
 * renders, "Expand full file" gets file bytes over IPC, the security settings
 * hold, links go to the system browser, and "Done" reaches main.
 *
 *   pnpm --filter desktop smoke     (builds first; on Linux without a display,
 *                                    run it under `xvfb-run -a`)
 */
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference path="../src/renderer/src/env.d.ts" />
// (page.evaluate callbacks run in the renderer: DOM types and window.reviewBuddy.)
import { createRequire } from "node:module";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";

const appDir = join(import.meta.dirname, "..");
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

const app: ElectronApplication = await _electron.launch({
  executablePath: electronPath,
  // Chromium refuses to run as root with its sandbox on (CI containers).
  args: [appDir, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
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
      bridge: Object.keys(w.reviewBuddy as object).sort(),
      inlineBlocked: w.__inlineRan === undefined,
      remoteFetch,
    };
  });
  check(inPage.noNode, "no Node globals in the renderer");
  check(
    inPage.bridge.join() === "done,getConfig,getFileContent,getReview",
    `preload exposes only the review calls (${inPage.bridge.join()})`,
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
        window.reviewBuddy.getFileContent("fixture", "../package.json", "head"),
      ),
      unknownReview: await outcome(window.reviewBuddy.getReview("nope")),
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
}
