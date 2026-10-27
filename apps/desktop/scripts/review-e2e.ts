/**
 * End to end with the real agent (US-12): the built app reviews PR #28 of
 * zbenhajsalah-cc/review-buddy with your Claude login, and the viewer must
 * show its Prologue and Chapters and expand a full file.
 *
 * GitHub is faked inside main (net.fetch is replaced), so no GitHub login or
 * network is needed for it: the PR, merge base and diff come from the
 * recorded fixtures (src/main/github/fixtures), the file bytes from this
 * repo's own git history. Claude is real: this costs one review's tokens and
 * takes a few minutes. Not part of CI.
 *
 *   pnpm --filter desktop build && node scripts/review-e2e.ts [--screenshots <dir>]
 *                                   (on Linux without a display: xvfb-run -a)
 *   node scripts/review-e2e.ts --executable release/linux-unpacked/review-buddy
 *                                   (the same run in a packaged app)
 */
/// <reference lib="dom" />
/// <reference path="../src/renderer/src/env.d.ts" />
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff } from "@review-buddy/core/diff";
import { _electron, type ElectronApplication } from "playwright-core";

const appDir = join(import.meta.dirname, "..");
const electronPath = createRequire(join(appDir, "package.json"))("electron") as string;
const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
// A packaged app is its own executable; in the repo, the electron binary runs appDir.
const packaged = arg("--executable");
const shots = arg("--screenshots");
const fixtures = join(appDir, "src/main/github/fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");

const PR = "zbenhajsalah-cc/review-buddy#28";
const API = "https://api.github.com/repos/zbenhajsalah-cc/review-buddy";
const BASE = "dd0aba03f871da744fe6bc349f93ad9a3ab5b1ba";
const HEAD = "7e8e70534d5fdb0a8ef1a5a0bf8407774b007b00";
const TIMEOUT_MS = 15 * 60_000;

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`FAIL: ${what}`);
  console.log(`ok - ${what}`);
}

/** The fake GitHub's answers, keyed by "accept url". */
const diff = fixture("pr-28.diff");
const routes: Record<string, { status: number; body: string }> = {
  [`application/vnd.github+json ${API}/pulls/28`]: { status: 200, body: fixture("pr-28.json") },
  [`application/vnd.github+json ${API}/compare/${BASE}...${HEAD}?per_page=1&page=2`]: {
    status: 200,
    body: fixture("compare-page2.json"),
  },
  [`application/vnd.github.diff ${API}/pulls/28`]: { status: 200, body: diff },
};
const show = (sha: string, path: string) =>
  execFileSync("git", ["show", `${sha}:${path}`], { cwd: appDir, encoding: "utf8" });
for (const file of parseDiff(diff)) {
  const raw = "application/vnd.github.raw+json";
  const url = (path: string, sha: string) =>
    `${raw} ${API}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`;
  if (file.changeType !== "deleted") {
    routes[url(file.path, HEAD)] = { status: 200, body: show(HEAD, file.path) };
  }
  if (file.changeType !== "added") {
    const old = file.oldPath ?? file.path;
    routes[url(old, BASE)] = { status: 200, body: show(BASE, old) };
  }
}

const userDataDir = mkdtempSync(join(tmpdir(), "rb-desktop-e2e-"));
const app: ElectronApplication = await _electron.launch({
  executablePath: packaged ?? electronPath,
  args: [
    ...(packaged ? [] : [appDir]),
    `--user-data-dir=${userDataDir}`,
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
  ],
  cwd: appDir,
});
const mainLog: string[] = [];
app.process().stdout?.on("data", (d) => mainLog.push(String(d)));
app.process().stderr?.on("data", (d) => mainLog.push(String(d)));

try {
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.getByText("Friendlier greetings and calmer retries").first().waitFor();

  await app.evaluate(({ net }, routes) => {
    net.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      if (String(input) === "https://api.github.com/user") {
        return Response.json({ login: "e2e", name: null });
      }
      const route = routes[`${headers.get("accept")} ${String(input)}`];
      return route
        ? new Response(route.body, { status: route.status })
        : Response.json({ message: "Not Found" }, { status: 404 });
    };
  }, routes);
  const signedIn = await page.evaluate(() => window.reviewBuddy.github.signInWithToken("ghp_e2e"));
  check(signedIn.signedIn, "signed in to the fake GitHub");

  await page.getByLabel("Pull request").fill(PR);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText(`Reviewing ${PR}…`).waitFor();
  check(true, "the run started");

  // Wait for the run, printing its steps as they come.
  const started = Date.now();
  let printed = 0;
  let status = await page.evaluate(() => window.reviewBuddy.review.runStatus());
  while (status.state === "running") {
    if (Date.now() - started > TIMEOUT_MS) throw new Error("FAIL: the review timed out");
    for (const step of status.steps.slice(printed)) console.log(`  · ${step}`);
    printed = status.steps.length;
    await page.waitForTimeout(1000);
    status = await page.evaluate(() => window.reviewBuddy.review.runStatus());
  }
  for (const step of status.steps.slice(printed)) console.log(`  · ${step}`);
  console.log(mainLog.join("").match(/\[review-buddy\] review-run .*/)?.[0] ?? "");
  check(
    status.state === "done",
    `the run finished (${status.state}${status.error ? `: ${status.error}` : ""})`,
  );
  check(
    status.reviewKey === `${PR}@${HEAD.slice(0, 12)}`,
    `the review key names the PR head (${status.reviewKey})`,
  );
  console.log(`  resolution notes: ${status.notes?.length ?? 0}`);
  for (const note of status.notes ?? []) console.log(`    - ${note}`);

  // The viewer shows the agent's review: Prologue, then every chapter.
  const review = await page.evaluate(
    (key) => window.reviewBuddy.review.getReview(key),
    status.reviewKey!,
  );
  check(review.pr.title === JSON.parse(fixture("pr-28.json")).title, "the PR metadata is GitHub's");
  const files = review.chapters.flatMap((c) => c.files.map((f) => f.path));
  check(
    parseDiff(diff).every((f) => files.includes(f.path)),
    "every file of the diff is in a chapter",
  );
  const firstLine = (md: string) =>
    md
      .split("\n")[0]!
      .replace(/[*_`[\]]/g, "")
      .slice(0, 40);
  await page.getByText(firstLine(review.prologue.why), { exact: false }).first().waitFor();
  check(true, "the Prologue shows");
  for (const chapter of review.chapters) {
    await page.getByText(chapter.title.replace(/[*_`]/g, ""), { exact: false }).first().waitFor();
  }
  check(true, `all ${review.chapters.length} chapter titles show`);
  if (shots) await page.screenshot({ path: join(shots, "review-overview.png") });

  // "Expand full file" on ReviewViewer.tsx: a head line far from every hunk.
  const target = "packages/viewer/src/ReviewViewer.tsx";
  const chapter = review.chapters.findIndex((c) => c.files.some((f) => f.path === target));
  check(chapter >= 0, `a chapter holds ${target}`);
  await page
    .getByText(review.chapters[chapter]!.title.replace(/[*_`]/g, ""), { exact: false })
    .first()
    .click();
  const head = show(HEAD, target).split("\n");
  const hunks = review.chapters[chapter]!.files.find((f) => f.path === target)!.hunks;
  const far = head.findIndex(
    (line, i) =>
      line.trim().length > 25 &&
      hunks.every((h) => i + 1 < h.new_start - 20 || i + 1 > h.new_start + h.new_lines + 20),
  );
  const farLine = head[far]!.trim();
  const text = () =>
    page.evaluate(() => {
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
  await page.waitForTimeout(1000);
  check(!(await text()).includes(farLine), `line ${far + 1} is hidden before expanding`);
  const expandButtons = page.getByRole("button", { name: /expand/i });
  for (let i = 0; i < (await expandButtons.count()); i++) {
    await expandButtons.nth(i).click();
  }
  const deadline = Date.now() + 15_000;
  while (!(await text()).includes(farLine) && Date.now() < deadline) await page.waitForTimeout(250);
  check((await text()).includes(farLine), `expand full file shows line ${far + 1} of ${target}`);
  if (shots) await page.screenshot({ path: join(shots, "review-chapter.png") });

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  console.log("desktop review e2e: all checks passed");
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
