/**
 * Smoke test of the built desktop app (out/): launches the real Electron app
 * with Playwright and checks the fixture review end to end — the viewer
 * renders, "Expand full file" gets file bytes over IPC, the security settings
 * hold, links go to the system browser, and "Done" reaches main. The GitHub
 * login and the repository and PR lists run against a fake GitHub. The agent review
 * of a PR is checked up to the point where Claude would start
 * (scripts/review-e2e.ts runs the real agent), with a fake `claude` chosen
 * in the settings (US-21): too old at first, then new enough.
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

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { loadFixtureReview } from "../src/main/fixture/index.ts";

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

// Two saved reviews (US-16), as earlier runs would have left them: one of the
// current head of octo-org/widgets#12, one of an older head of #5. Written
// here in the saved format (src/main/review-cache.ts), so a format change
// that would lose users' saved reviews fails this test.
const HEAD_12 = "12".padStart(40, "c");
const OLD_5 = "e".repeat(40);
{
  const dir = join(userDataDir, "reviews");
  const { review: fixture } = await loadFixtureReview();
  // By @mona, like the fake PR list: the login (@octocat) may approve it.
  const review = { ...fixture, pr: { ...fixture.pr, author: "mona" } };
  const index = [];
  for (const [n, headSha] of [
    [12, HEAD_12],
    [5, OLD_5],
  ] as const) {
    const pr = `octo-org/widgets#${n}`;
    const reviewKey = `${pr}@${headSha.slice(0, 12)}`;
    const savedAt = new Date().toISOString();
    const text = JSON.stringify({
      version: 1,
      reviewKey,
      pr,
      headSha,
      baseSha: "d".repeat(40),
      savedAt,
      files: [],
      review,
    });
    mkdirSync(join(dir, "octo-org", "widgets"), { recursive: true });
    writeFileSync(join(dir, "octo-org", "widgets", `${n}@${headSha}.json`), text);
    index.push({ reviewKey, pr, title: review.pr.title, headSha, savedAt, bytes: text.length });
  }
  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
}
// The Claude Code the app uses (US-21): a fake `claude` that prints the
// version in a file, chosen in the settings, so only it is checked (not one
// installed on this machine). The test changes the version to "update" it.
const fakeClaude = join(userDataDir, "fake-claude", "claude");
const fakeClaudeVersion = join(userDataDir, "fake-claude", "version");
mkdirSync(join(userDataDir, "fake-claude"));
writeFileSync(fakeClaudeVersion, "2.1.0 (Claude Code)\n");
writeFileSync(fakeClaude, `#!/bin/sh\ncat "${fakeClaudeVersion}"\n`);
chmodSync(fakeClaude, 0o755);
writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ claudePath: fakeClaude }));

// A local copy of a repository (US-19), as a large PR's review leaves it.
const copyDir = join(userDataDir, "clones", "octo-org", "big-repo.git");
mkdirSync(copyDir, { recursive: true });
execFileSync("git", ["init", "--bare", "--quiet", copyDir]);
writeFileSync(join(copyDir, "review-buddy-used"), new Date().toISOString());

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

  // The app opens on the repository list (empty or failing here: no fake
  // GitHub yet); the sample review is one click away.
  await page.getByRole("heading", { name: "Repositories" }).waitFor();
  check(page.url().startsWith("app://renderer/"), `renderer served from app:// (${page.url()})`);
  await page.getByRole("button", { name: "Sample review", exact: true }).click();
  await page.getByText("Friendlier greetings and calmer retries").first().waitFor();
  check(true, "the sample review is one click away");

  // Claude Code (US-21): too old, so reviews cannot run, and the app says why.
  const banner = page.getByRole("alert").filter({ hasText: "Reviews cannot run." });
  await banner
    .getByText(/Claude Code 2\.1\.0 is too old for this app \(needs \d+\.\d+\.\d+ or newer\)/)
    .waitFor();
  await page.getByLabel("Pull request").fill("octo-org/widgets#12");
  const barReview = page.getByRole("button", { name: "Review", exact: true });
  check(
    (await barReview.isDisabled()) &&
      ((await barReview.getAttribute("title")) ?? "").includes("claude update"),
    "a too-old Claude Code: a banner says why, and Review is off",
  );
  await banner.getByRole("button", { name: "Claude Code settings" }).click();
  const claudeStatus = page.getByRole("status", { name: "Claude Code status" });
  await claudeStatus.getByText("Claude Code 2.1.0 is too old", { exact: true }).waitFor();
  check(
    (await claudeStatus.innerText()).includes(`${fakeClaude} (chosen)`),
    "the settings show the Claude Code in use, its path, and that it was chosen",
  );
  writeFileSync(fakeClaudeVersion, "99.0.0 (Claude Code)\n"); // `claude update`
  await page.getByRole("button", { name: "Check again" }).click();
  await claudeStatus.getByText("✓ Claude Code 99.0.0").waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  check(
    (await banner.count()) === 0 && (await barReview.isEnabled()),
    "after an update and Check again, reviews can run",
  );
  await page.getByLabel("Pull request").fill("");

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
  // (Focus off the tab just clicked: Enter on a button clicks it.)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
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

  // Done reaches main. The app keeps reviews, so Done keeps the viewed state
  // and the review stays open (US-17).
  await page.getByRole("switch", { name: "viewed" }).first().click();
  await page.getByRole("button", { name: /^done/i }).first().click();
  await page.getByRole("button", { name: "Done ✓" }).waitFor();
  await page.waitForTimeout(300);
  check(mainLog.join("").includes("review fixture done"), "Done reaches main over IPC");
  check(
    (await page.evaluate(() => localStorage.getItem("rb.viewed.fixture"))) !== null,
    "Done keeps the viewed files, and the review stays open",
  );

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
  // It knows the token ghp_smoke (until `__expired` is set) and two pages of
  // repositories.
  await app.evaluate(({ net }) => {
    const g = globalThis as Record<string, unknown>;
    const repo = (fullName: string, extra: Record<string, unknown> = {}) => ({
      full_name: fullName,
      name: fullName.split("/")[1],
      owner: { login: fullName.split("/")[0] },
      private: false,
      archived: false,
      fork: false,
      description: null,
      pushed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      ...extra,
    });
    const page = (n: number) =>
      `https://api.github.com/user/repos?per_page=100&page=${n}&sort=pushed`;
    const widgets = "https://api.github.com/repos/octo-org/widgets";
    const pulls = (n: number) =>
      `${widgets}/pulls?state=open&sort=updated&direction=desc&per_page=30&page=${n}`;
    const pull = (n: number, title: string, extra: Record<string, unknown> = {}) => ({
      number: n,
      title,
      user: { login: "mona" },
      updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      draft: false,
      html_url: `https://github.com/octo-org/widgets/pull/${n}`,
      head: { sha: String(n).padStart(40, "c"), ref: `feature-${n}` },
      base: { sha: "d".repeat(40), ref: "main" },
      ...extra,
    });
    const answers: Record<string, () => Response> = {
      "https://api.github.com/user": () => Response.json({ login: "octocat", name: "Mona" }),
      [page(1)]: () =>
        Response.json(
          [
            repo("octocat/hello-world", { description: "My first repository" }),
            repo("octocat/secret-plans", { private: true }),
            repo("octo-org/old-site", { archived: true }),
          ],
          { headers: { link: `<${page(2)}>; rel="next"` } },
        ),
      [page(2)]: () => Response.json([repo("octo-org/widgets", { description: "Widget factory" })]),
      [widgets]: () => Response.json(repo("octo-org/widgets", { description: "Widget factory" })),
      // #11 has no single-PR answer: no size, and its review fails at once.
      [pulls(1)]: () =>
        Response.json(
          [pull(12, "Add the gear API"), pull(11, "WIP: spring cleaning", { draft: true })],
          { headers: { link: `<${pulls(2)}>; rel="next"` } },
        ),
      [pulls(2)]: () => Response.json([pull(5, "Fix the README")]),
      [`${widgets}/pulls/12`]: () =>
        Response.json({
          ...pull(12, "Add the gear API"),
          additions: 40,
          deletions: 2,
          changed_files: 3,
        }),
      // The merge base is d…d. The diff is not faked (the PR JSON comes
      // back instead), so a review that gets that far fails before Claude.
      [`${widgets}/compare/${"d".repeat(40)}...${"12".padStart(40, "c")}?per_page=1&page=2`]: () =>
        Response.json({ merge_base_commit: { sha: "d".repeat(40) } }),
      [`${widgets}/compare/${"d".repeat(40)}...${"5".padStart(40, "c")}?per_page=1&page=2`]: () =>
        Response.json({ merge_base_commit: { sha: "d".repeat(40) } }),
      [`${widgets}/pulls/5`]: () =>
        Response.json({
          ...pull(5, "Fix the README"),
          additions: 1,
          deletions: 1,
          changed_files: 1,
        }),
    };
    net.fetch = async (input, init) => {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== "Bearer ghp_smoke" || g.__expired) {
        return Response.json({ message: "Bad credentials" }, { status: 401 });
      }
      // Posting a review (US-20): refused while `__postRefused`, else kept in `__posts`.
      if (init?.method === "POST") {
        if (String(input) !== `${widgets}/pulls/12/reviews`) {
          return Response.json({ message: "Not Found" }, { status: 404 });
        }
        if (g.__postRefused) {
          return Response.json(
            { message: "Resource not accessible by personal access token" },
            { status: 403 },
          );
        }
        g.__posts ??= [];
        (g.__posts as unknown[]).push(JSON.parse(String(init.body)));
        return Response.json({
          id: 1,
          html_url: "https://github.com/octo-org/widgets/pull/12#pullrequestreview-1",
          user: { login: "octocat" },
        });
      }
      const answer = answers[String(input)];
      return answer ? answer() : Response.json({ message: "Not Found" }, { status: 404 });
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
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByRole("button", { name: "Done ✓" })
    .or(page.getByText("Friendlier greetings"))
    .first()
    .waitFor();
  check(true, "Back returns to the screen the settings were opened from");

  // The repository list (US-13): pages, search, recently used first.
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  const repoButton = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });
  await repoButton("octocat/hello-world").waitFor();
  check(
    (await repoButton("octocat/secret-plans").innerText()).includes("Private") &&
      (await repoButton("octo-org/old-site").innerText()).includes("Archived"),
    "the repositories of page 1 show, with private and archived flags",
  );
  check(
    (await repoButton("octocat/hello-world").innerText()).includes("pushed 3 days ago"),
    "each repository shows its last push",
  );
  const search = page.getByLabel("Search repositories");
  await search.fill("widget");
  await page.getByText("No loaded repository matches").waitFor();
  await page.getByText("The search covers the 3 repositories loaded so far.").waitFor();
  check(true, "the search covers the loaded pages and says so");
  await page.getByRole("button", { name: "Load more" }).click();
  await repoButton("octo-org/widgets").waitFor();
  check(
    (await page.getByRole("button", { name: "Load more" }).count()) === 0 &&
      !(await repoButton("octocat/hello-world").isVisible()),
    "Load more brings page 2; the search filters it",
  );

  // Its PR list (US-14): sizes, draft, Load more; reviews of the selected PRs
  // run one after another (they fail at the merge base here: no Claude needed).
  await repoButton("octo-org/widgets").click();
  await page.getByRole("heading", { name: "octo-org/widgets" }).waitFor();
  const pullRow = (n: number) =>
    page.getByRole("listitem").filter({ has: page.getByLabel(`Select #${n}`) });
  await pullRow(12).waitFor();
  const row12 = await pullRow(12).innerText();
  const row11 = await pullRow(11).innerText();
  check(
    row12.includes("Add the gear API") &&
      row12.includes("@mona") &&
      row12.includes("updated 2 hours ago") &&
      row12.includes("+40 −2 · 3 files"),
    "picking a repository opens its open PRs: title, author, updated, size",
  );
  check(
    row11.includes("Draft") && !row11.includes("files"),
    "a draft PR is flagged; a size GitHub does not send is left out",
  );
  await page.getByRole("button", { name: "Load more" }).click();
  await pullRow(5).waitFor();
  check(true, "Load more brings the next page of PRs");

  // Saved reviews (US-16): #12's is for its current head, #5's for an older one.
  const row12Text = await pullRow(12).innerText();
  check(
    row12Text.includes("Reviewed") &&
      (await page.getByRole("button", { name: "Run the review of #12 again" }).isVisible()),
    "a PR whose head has a saved review shows Reviewed, with Open review and Run again",
  );
  check(
    (await pullRow(5).innerText()).includes("Outdated review") &&
      (await page.getByRole("button", { name: "Review #5" }).innerText()) === "Review again",
    "a saved review of an older head is Outdated, with Review again",
  );
  await page.getByRole("button", { name: "Open the review of #12" }).click();
  await page.getByText("Friendlier greetings and calmer retries").first().waitFor();
  check(
    !(await page.getByText("This review is for an older commit").isVisible()),
    "Open review shows the saved review at once, with no out-of-date banner",
  );
  // Done on it (US-17): the review says so, and so does the PR list.
  await page.getByText("Retry backoff with jitter").first().click();
  await page.getByRole("switch", { name: "viewed" }).first().click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Done ✓" }).waitFor();
  await page.getByText(/^You marked this review done/).waitFor();
  await page.getByRole("button", { name: "octo-org/widgets", exact: true }).click();
  await pullRow(12).getByText("Done ✓").waitFor();
  check(true, "Done marks the review finished: a banner on it, Done ✓ in the PR list");

  // Post it to GitHub (US-20): write, check, confirm; nothing before the confirm.
  await page.getByRole("button", { name: "Open the review of #12" }).click();
  const dialog = page.getByRole("dialog", { name: "Post your review of octo-org/widgets#12" });
  const confirm = page.getByRole("dialog", { name: "Post this review to octo-org/widgets#12?" });
  /** Opens the window and writes the review, up to the confirm step. */
  const writeReview = async (firstTime = false) => {
    await page.getByRole("button", { name: "Post to GitHub…" }).click();
    await dialog.waitFor();
    await dialog.getByLabel("Request changes").check();
    await dialog.getByLabel("Add the list of chapters (titles, risk and size)").check();
    if (firstTime) {
      check(
        await dialog.getByRole("button", { name: "Next: check and post" }).isDisabled(),
        "Request changes needs a summary before it can go on (the chapter list is not one)",
      );
    }
    await dialog.getByLabel(/^Summary/).fill("Please add a test for the jitter.");
    await dialog.getByRole("button", { name: "Next: check and post" }).click();
    await confirm.waitFor();
  };
  await writeReview(true);
  const shown = await confirm
    .getByRole("region", { name: "Text to post" })
    .locator("pre")
    .innerText();
  const confirmText = await confirm.innerText();
  check(
    confirmText.includes("Request changes") &&
      confirmText.includes("@octocat") &&
      confirmText.includes(HEAD_12.slice(0, 7)) &&
      shown.startsWith("Please add a test for the jitter.\n\n**Chapters** (from Review Buddy)") &&
      (await app.evaluate(() => (globalThis as Record<string, unknown>).__posts)) === undefined,
    "the confirm step shows the verdict, the login, the commit and the exact text; nothing is posted yet",
  );
  await app.evaluate(() => {
    (globalThis as Record<string, unknown>).__postRefused = true;
  });
  await confirm.getByRole("button", { name: "Post to GitHub" }).click();
  await confirm.getByRole("alert").waitFor();
  check(
    (await confirm.getByRole("alert").innerText()).includes('"Pull requests: Read and write"'),
    "a token that cannot write reviews: GitHub's answer and what the token needs",
  );
  await app.evaluate(() => {
    (globalThis as Record<string, unknown>).__postRefused = false;
    (globalThis as Record<string, unknown>).__expired = true;
  });
  await confirm.getByRole("button", { name: "Post to GitHub" }).click();
  await confirm
    .getByRole("alert")
    .getByText(/^GitHub rejected the token/)
    .waitFor();
  await page.getByRole("button", { name: "Connect GitHub" }).waitFor();
  await page.keyboard.press("Escape");
  await confirm.waitFor({ state: "detached" });
  check(
    await page.getByRole("button", { name: "Post to GitHub…" }).isDisabled(),
    "a token that expired during a post: the app shows it is signed out, and posting is off",
  );
  await app.evaluate(() => {
    (globalThis as Record<string, unknown>).__expired = false;
  });
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await signInWith("ghp_smoke");
  await page.getByText(/^Signed in as @octocat/).waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await writeReview();
  await confirm.getByRole("button", { name: "Post to GitHub" }).click();
  await confirm.waitFor({ state: "detached" });
  await page.getByText(/Changes requested on GitHub .* as @octocat/).waitFor();
  const posts = (await app.evaluate(
    () => (globalThis as Record<string, unknown>).__posts,
  )) as Record<string, string>[];
  check(
    posts.length === 1 &&
      posts[0]!.event === "REQUEST_CHANGES" &&
      posts[0]!.commit_id === HEAD_12 &&
      posts[0]!.body === shown,
    "Post to GitHub posts exactly the text shown, on the reviewed commit, once",
  );
  await page.getByRole("button", { name: "octo-org/widgets", exact: true }).click();
  await pullRow(12).getByText("Changes requested on GitHub").waitFor();
  check(true, "the review says what was posted, and so does the PR list");
  await page.getByRole("button", { name: "Load more" }).click();
  await pullRow(5).waitFor();
  await page.getByRole("button", { name: "octo-org/widgets", exact: true }).click();
  await page.getByRole("button", { name: "Open the review of #5" }).click();
  await page.getByText(/^This review is for an older commit/).waitFor();
  check(true, "an outdated saved review says so, with Review again");
  await page.getByRole("button", { name: "octo-org/widgets", exact: true }).click();

  // Starting #12 again uses its saved review: no Claude, no run.
  await page.getByLabel("Pull request").fill("octo-org/widgets#12");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText("Friendlier greetings and calmer retries").first().waitFor();
  const reopened = (await page.evaluate(() => window.reviewBuddy.review.jobs())).at(-1)!;
  check(
    reopened.state === "done" && reopened.steps.join() === "Opened the saved review of this commit",
    "reviewing a PR head that has a saved review opens it without a run",
  );
  // A reload forgets what the page knew: Done (and Post again) come from the saved review.
  await page.reload();
  await page.getByText(/^You marked this review done/).waitFor();
  check(
    await page.getByRole("button", { name: "Post again…" }).isEnabled(),
    "a saved review reopened by a job keeps its Done bar and Post again, after a reload",
  );
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  // (Listed twice: recently used, and in its page; not the review's tab.)
  await page
    .getByRole("button", { name: /^octo-org\/widgets(?!#)/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Load more" }).click();
  await pullRow(5).waitFor();

  await page.getByLabel("Select #11").check();
  await page.getByLabel("Select #5").check();
  await page.getByRole("button", { name: "Review selected (2)" }).click();
  // (No polling in the renderer: the rows change on main's job events.)
  await pullRow(11).getByText("Last review failed").waitFor({ timeout: 15_000 });
  await pullRow(5).getByText("Last review failed").waitFor();
  const queued = (await page.evaluate(() => window.reviewBuddy.review.jobs())).slice(-2);
  check(
    queued.map((j) => `${j.pr} ${j.state}`).join() ===
      "octo-org/widgets#11 failed,octo-org/widgets#5 failed" &&
      queued[0]!.error!.startsWith("PR octo-org/widgets#11: not found") &&
      // (The fake answers the diff request with JSON: not a diff that matches.)
      queued[1]!.error!.startsWith("The diff GitHub sent for octo-org/widgets#5"),
    "Review selected queues both PRs in order; each row shows why its review failed",
  );
  check(
    (await page.getByRole("button", { name: "Review #11" }).innerText()) === "Try again",
    "a failed PR offers Try again",
  );

  // Settings: the saved reviews, Delete, Delete all.
  await page.getByRole("button", { name: "GitHub: @octocat" }).click();
  const savedList = page.getByRole("list", { name: "Saved reviews" });
  await savedList.waitFor();
  check(
    (await savedList.getByRole("listitem").count()) === 2 &&
      (
        await savedList.getByRole("listitem").filter({ hasText: "widgets#12" }).innerText()
      ).includes("· done"),
    "the settings list both saved reviews; the one marked done says so",
  );
  await page
    .getByRole("button", {
      name: `Delete the saved review of octo-org/widgets#12 at ${HEAD_12.slice(0, 7)}`,
    })
    .click();
  await page.waitForFunction(() =>
    window.reviewBuddy.review.saved().then((list) => list.length === 1),
  );
  check(
    (await page.evaluate(
      (key) => localStorage.getItem(`rb.viewed.${key}`),
      `octo-org/widgets#12@${HEAD_12.slice(0, 12)}`,
    )) === null,
    "deleting a saved review also forgets its viewed files",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await pullRow(12).waitFor();
  check(
    (await page.getByRole("button", { name: "Review #12" }).innerText()) === "Review",
    "a deleted review is gone from the PR list",
  );
  await page.getByRole("button", { name: "GitHub: @octocat" }).click();
  await page.getByRole("button", { name: "Delete all", exact: true }).click();
  await page.getByRole("button", { name: "Yes, delete all" }).click();
  await page.getByText("No saved reviews.").waitFor();
  const savedOnDisk = await app.evaluate(async ({ app }) => {
    const fs = process.getBuiltinModule("node:fs/promises");
    return fs.readdir(`${app.getPath("userData")}/reviews`).then(
      (names) => names.join(),
      () => "gone",
    );
  });
  check(savedOnDisk === "gone", "Delete all removes the saved files");

  // Local copies of repositories (US-19): listed with their size, deletable.
  const copies = page.getByRole("list", { name: "Local copies" });
  const copyRow = copies.getByRole("listitem").filter({ hasText: "octo-org/big-repo" });
  check(
    /\d+ KB · used just now/.test(await copyRow.innerText()),
    "the settings list the local copy of a repository, with its size and when it was used",
  );
  await page.getByRole("button", { name: "Delete the local copy of octo-org/big-repo" }).click();
  await page.getByText("No local copies.").waitFor();
  const copyOnDisk = await app.evaluate(async ({ app }) => {
    const fs = process.getBuiltinModule("node:fs/promises");
    return fs.readdir(`${app.getPath("userData")}/clones`).then(
      (names) => names.join() || "empty",
      () => "gone",
    );
  });
  check(copyOnDisk === "empty", `Delete removes the copy from disk (${copyOnDisk})`);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "← Repositories" }).click();
  await search.fill("");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("region", { name: "Recently used" }).waitFor();
  const firstRepo = await page.getByRole("list").first().getByRole("button").first().innerText();
  check(
    firstRepo.startsWith("octo-org/widgets"),
    `a repository just used comes first, even from page 2 (${firstRepo.split("\n")[0]})`,
  );
  // A review started from the top bar moves its repository up too, without
  // a Refresh (#5 opens, then fails at its diff: no Claude).
  const firstRecent = (name: string) =>
    page
      .getByRole("region", { name: "Recently used" })
      .getByRole("button")
      .first()
      .filter({ hasText: new RegExp(`^${name}`) });
  await page.evaluate(() => window.reviewBuddy.github.markRepoUsed("octocat/hello-world"));
  await page.getByRole("button", { name: "Refresh" }).click();
  await firstRecent("octocat/hello-world").waitFor();
  await page.getByLabel("Pull request").fill("octo-org/widgets#5");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.waitForFunction(() =>
    window.reviewBuddy.review.jobs().then((jobs) => jobs.at(-1)?.state === "failed"),
  );
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await firstRecent("octo-org/widgets").waitFor();
  check(true, "a review started from the top bar moves its repository first, without Refresh");

  // The token expires: the list says so and the app is signed out.
  await app.evaluate(() => {
    (globalThis as Record<string, unknown>).__expired = true;
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText(/^GitHub rejected the token: it expired or was revoked/).waitFor();
  await page.getByRole("button", { name: "Connect GitHub" }).first().waitFor();
  const tokenAfterExpiry = await app.evaluate(async ({ app }) => {
    const fs = process.getBuiltinModule("node:fs/promises");
    return fs.access(`${app.getPath("userData")}/github-token`).then(
      () => "exists",
      () => "gone",
    );
  });
  check(tokenAfterExpiry === "gone", "an expired token: the list says so, the app signs out");

  // Sign in again, then sign out with the button.
  await app.evaluate(() => {
    (globalThis as Record<string, unknown>).__expired = false;
  });
  await page.getByRole("button", { name: "Connect GitHub" }).first().click();
  await signInWith("ghp_smoke");
  await page.getByText(/^Signed in as @octocat/).waitFor();
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
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByText("Connect GitHub to see your repositories").waitFor();
  check(true, "signed out, the repository list asks to connect GitHub");

  // A PR review (US-12) without Claude: a bad reference is refused in the bar,
  // and a review while signed out fails before the agent starts.
  const prField = page.getByLabel("Pull request");
  await prField.fill("not-a-pr");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText(/^Expected owner\/repo#123/).waitFor();
  check(true, "a malformed PR reference is refused");
  await prField.fill("https://github.com/octocat/hello-world/pull/42");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText("Could not read octocat/hello-world#42 from GitHub").waitFor();
  await page.getByText(/^Not signed in to GitHub/).waitFor();
  await page.getByText(/^Check the GitHub login in Settings/).waitFor();
  check(true, "a review while signed out fails as a GitHub error, with the reason and a hint");
  const before = (await page.evaluate(() => window.reviewBuddy.review.jobs())).length;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForFunction(
    (n) => window.reviewBuddy.review.jobs().then((jobs) => jobs.length === n + 1),
    before,
  );
  await page.getByText("Could not read octocat/hello-world#42 from GitHub").waitFor();
  check(true, "Try again runs the review again (a new job, followed)");
  await page.getByRole("button", { name: "Show the sample review" }).click();
  await page
    .getByRole("button", { name: "Done ✓" })
    .or(page.getByText("Friendlier greetings"))
    .first()
    .waitFor();
  check(true, "back to the sample review");

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
      "claude.check,claude.choose,claude.search,claude.status,github.markRepoUsed,github.pulls,github.repos,github.signInWithToken,github.signOut,github.status,github.useGh,review.clones,review.deleteAllClones,review.deleteAllSaved,review.deleteClone,review.deleteSaved,review.done,review.getConfig,review.getFileContent,review.getReview,review.jobs,review.onJobs,review.post,review.posted,review.saved,review.start,review.stop",
    `preload exposes only the review, GitHub and Claude Code calls (${inPage.bridge.join()})`,
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
