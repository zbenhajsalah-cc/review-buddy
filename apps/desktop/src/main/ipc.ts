import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { IPC } from "../shared/ipc.ts";
import type { ClaudeCode } from "./agent/claude-code.ts";
import type { ReviewJobs } from "./agent/review-job.ts";
import type { GitHubAuth } from "./github/auth.ts";
import type { PrClones } from "./github/clones.ts";
import type { GitHubPulls } from "./github/pulls.ts";
import type { GitHubRepos } from "./github/repos.ts";
import { parseDoneResult, type ReviewStore } from "./reviews.ts";

type Handler = (...args: unknown[]) => unknown;

/**
 * Registers handlers that answer only our own renderer page (`isTrusted`
 * checks the sending frame's URL). Arguments are checked by the handlers.
 */
function handle(channel: string, isTrusted: (url: string) => boolean, handler: Handler): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const url = event.senderFrame?.url ?? "";
    if (!isTrusted(url)) throw new Error(`IPC from untrusted page: ${url}`);
    return handler(...args);
  });
}

/** Answers the preload's review calls. */
export function registerReviewIpc(
  store: ReviewStore,
  jobs: ReviewJobs,
  clones: PrClones,
  isTrusted: (url: string) => boolean,
): void {
  handle(IPC.getReview, isTrusted, (reviewKey) => store.getReview(reviewKey));
  handle(IPC.getFileContent, isTrusted, (reviewKey, path, side) =>
    store.getFileContent(reviewKey, path, side),
  );
  handle(IPC.getConfig, isTrusted, () => ({ roundtrip: false }));
  handle(IPC.done, isTrusted, async (reviewKey, result) => {
    const { verdict } = parseDoneResult(result);
    // Marked finished, and kept with the saved review (US-17). Posting the
    // review to GitHub is US-20.
    await store.markDone(reviewKey); // unknown review → error
    console.log(`[review-buddy] review ${String(reviewKey)} done${verdict ? `: ${verdict}` : ""}`);
  });
  handle(IPC.startReview, isTrusted, (pr, options) => jobs.start(pr, options));
  handle(IPC.stopReview, isTrusted, (id) => jobs.stop(id));
  handle(IPC.reviewJobs, isTrusted, () => jobs.jobs());
  handle(IPC.savedReviews, isTrusted, () => store.saved());
  handle(IPC.deleteSavedReview, isTrusted, async (reviewKey) => {
    await store.delete(reviewKey);
    jobs.forgetReview(reviewKey);
    return store.saved();
  });
  handle(IPC.deleteAllSavedReviews, isTrusted, async () => {
    await store.deleteAll();
    jobs.forgetReview();
    return store.saved();
  });
  // Local copies of repositories (US-19); the renderer names one by owner/repo.
  handle(IPC.clones, isTrusted, () => clones.list());
  handle(IPC.deleteClone, isTrusted, (repo) => clones.delete(repo));
  handle(IPC.deleteAllClones, isTrusted, () => clones.deleteAll());
}

/**
 * Answers the settings view and the repository and PR lists. No answer
 * carries the token: a GitHubStatus, repositories, or PRs.
 */
export function registerGitHubIpc(
  auth: GitHubAuth,
  repos: GitHubRepos,
  pulls: GitHubPulls,
  isTrusted: (url: string) => boolean,
): void {
  handle(IPC.githubStatus, isTrusted, () => auth.status());
  handle(IPC.githubSignInWithToken, isTrusted, (token) => auth.signInWithToken(token));
  handle(IPC.githubUseGh, isTrusted, () => auth.useGh());
  handle(IPC.githubSignOut, isTrusted, () => auth.signOut());
  handle(IPC.githubRepos, isTrusted, (page) => repos.list(page));
  handle(IPC.githubMarkRepoUsed, isTrusted, (fullName) => repos.markUsed(fullName));
  handle(IPC.githubPulls, isTrusted, (fullName, page) => pulls.list(fullName, page));
}

/**
 * The installed Claude Code (US-21). The renderer never sends a path: the
 * file dialog runs in main (`choosePath`), so a page cannot make main run a
 * program of its choice.
 */
export function registerClaudeIpc(
  claude: ClaudeCode,
  choosePath: () => Promise<string | undefined>,
  isTrusted: (url: string) => boolean,
): void {
  handle(IPC.claudeStatus, isTrusted, () => claude.status());
  handle(IPC.claudeCheck, isTrusted, () => claude.check());
  handle(IPC.claudeChoose, isTrusted, async () => {
    const path = await choosePath();
    return path ? claude.choose(path) : claude.status();
  });
  handle(IPC.claudeSearch, isTrusted, () => claude.choose(undefined));
}
