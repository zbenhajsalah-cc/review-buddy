/**
 * The IPC contract between main and the renderer. The preload script exposes
 * `window.reviewBuddy = { review, github, claude }`: the renderer wraps
 * `review` in a `ReviewApi` for the viewer (renderer/src/ipc-review-api.ts),
 * uses `github` in the settings view and the repository and PR lists, and
 * `claude` for the installed Claude Code (US-21). Types only, plus the
 * channel names: both sides import this file, so they cannot drift.
 */
import type { ResolvedReview } from "@review-buddy/core/types";

export const IPC = {
  getReview: "review:get",
  getFileContent: "review:file-content",
  getConfig: "review:config",
  done: "review:done",
  startReview: "review:start",
  stopReview: "review:stop",
  reviewJobs: "review:jobs",
  savedReviews: "review:saved",
  deleteSavedReview: "review:delete-saved",
  deleteAllSavedReviews: "review:delete-all-saved",
  clones: "review:clones",
  deleteClone: "review:delete-clone",
  deleteAllClones: "review:delete-all-clones",
  postReview: "review:post",
  postedReview: "review:posted",
  /** Main → renderer: the job list changed (an event, not a call). */
  reviewJobsChanged: "review:jobs-changed",
  /** Main → renderer: show this job (its notification was clicked). */
  openReviewJob: "review:open-job",
  githubStatus: "github:status",
  githubSignInWithToken: "github:sign-in-with-token",
  githubUseGh: "github:use-gh",
  githubSignOut: "github:sign-out",
  githubRepos: "github:repos",
  githubMarkRepoUsed: "github:mark-repo-used",
  githubPulls: "github:pulls",
  claudeStatus: "claude:status",
  claudeCheck: "claude:check",
  claudeChoose: "claude:choose",
  claudeSearch: "claude:search",
} as const;

/** The sample review main loads at startup (the "Sample review" tab). */
export const FIXTURE_REVIEW_KEY = "fixture";

export type FileSide = "base" | "head";

export interface IpcFileContent {
  path: string;
  side: FileSide;
  language: string;
  /** "" means unavailable. */
  content: string;
}

export interface IpcDoneResult {
  verdict?: "approve" | "request_changes";
  summary?: string;
}

/**
 * A review posted to GitHub (US-20): "approve" and "request_changes" are a
 * verdict, "comment" only adds the text. GitHub does not let a PR's author
 * approve it or request changes on it.
 */
export type PostVerdict = "approve" | "request_changes" | "comment";

/** What the reviewer posts: exactly this text, with this verdict. */
export interface PostReviewRequest {
  verdict: PostVerdict;
  /** Markdown; may be empty only to approve. */
  body: string;
}

/** A review the app posted to GitHub (the last one, kept with the saved review). */
export interface PostedReview {
  verdict: PostVerdict;
  /** ISO time. */
  postedAt: string;
  /** The review on GitHub. */
  url: string;
  /** The GitHub login that posted it. */
  login: string;
}

/**
 * The answer to a post. Failures are answers, not rejections: "outdated" (the
 * PR has new commits since the review), "signed-out", "token-rejected"
 * (main has signed out), "failed" (anything else; `error` says what).
 */
export type PostReviewResult =
  | { ok: true; posted: PostedReview }
  | { ok: false; reason: "outdated" | "signed-out" | "token-rejected" | "failed"; error: string };

/**
 * Where a review is (US-15), in order: reading the PR from GitHub, Claude
 * starting and reading the diff and files, Claude writing the chapters, and
 * the app checking the chapters' anchors against the diff.
 */
export type ReviewPhase = "github" | "reading" | "writing" | "checking";

/**
 * Why a review failed (US-15): "github" (GitHub could not give the PR),
 * "too-large" (GitHub sends no diff for a PR this large), "claude" (Claude
 * could not run: login, account, rate limit, service), "agent" (Claude ran
 * but submitted no review), "stopped" (the user stopped it).
 */
export type ReviewErrorKind = "github" | "too-large" | "claude" | "agent" | "stopped";

/**
 * One agent review of a PR (US-12, US-14, US-15), as the renderer sees it.
 * Main runs a few at a time, in the order they were started, and sends the
 * whole list on every change (`onJobs`).
 */
export interface ReviewJobStatus {
  /** 1, 2, … in start order; also remounts the viewer per job. */
  id: number;
  /** `owner/repo#123`. */
  pr: string;
  state: "queued" | "running" | "done" | "failed";
  /** The PR head the review is for, once the PR is open. */
  headSha?: string;
  /** Set when done: the review to load with getReview. */
  reviewKey?: string;
  /** Set while running: where it is. */
  phase?: ReviewPhase;
  /** What the agent did so far, oldest first (the last few). */
  steps: string[];
  /** When it started running, and when it ended (ms since the epoch). */
  startedAt?: number;
  endedAt?: number;
  /** Resolution notes of the review shown: places its anchors did not match. */
  notes?: string[];
  error?: string;
  errorKind?: ReviewErrorKind;
}

/** A review saved on disk (US-16), as the settings list it. */
export interface SavedReviewInfo {
  reviewKey: string;
  /** `owner/repo#123`. */
  pr: string;
  title: string;
  /** The PR head the review is for. */
  headSha: string;
  /** ISO time. */
  savedAt: string;
  /** Size of the saved file. */
  bytes: number;
  /** When the reviewer pressed Done (US-17). */
  doneAt?: string;
  /** The last review posted to GitHub for this commit (US-20). */
  posted?: PostedReview;
}

/**
 * A local copy of a repository (US-19), made to review a PR too large for
 * GitHub's diff API, as the settings list it.
 */
export interface CloneInfo {
  /** `owner/repo`, lower case. */
  repo: string;
  /** Disk use. */
  bytes: number;
  /** ISO time it was last used. */
  usedAt: string;
  /** A review is reading it now: it cannot be deleted. */
  inUse: boolean;
}

/** What the preload script exposes. Every call names the review it is about. */
export interface ReviewBridge {
  getReview(reviewKey: string): Promise<ResolvedReview>;
  getFileContent(reviewKey: string, path: string, side: FileSide): Promise<IpcFileContent>;
  getConfig(): Promise<{ roundtrip: boolean }>;
  done(reviewKey: string, result: IpcDoneResult): Promise<void>;
  /**
   * Queues a review of a PR ("owner/repo#123" or its URL); it starts when a
   * slot is free. Rejects a PR that is already queued or running. Also the
   * "Try again" of a failed review. A saved review of the PR's current head
   * is used at once, without Claude, unless `fresh` (US-16).
   */
  start(pr: string, options?: { fresh?: boolean }): Promise<ReviewJobStatus>;
  /** Stops a running job, or takes a queued one out of the queue. */
  stop(id: number): Promise<ReviewJobStatus[]>;
  /** Queued and running jobs, and the last finished ones, oldest first. */
  jobs(): Promise<ReviewJobStatus[]>;
  /** Calls `listener` with the job list on every change; returns "unsubscribe". */
  onJobs(listener: (jobs: ReviewJobStatus[]) => void): () => void;
  /**
   * Calls `listener` with a job's id when the user clicks the notification
   * that it ended; returns "unsubscribe".
   */
  onOpenJob(listener: (id: number) => void): () => void;
  /** The saved reviews, newest first. */
  saved(): Promise<SavedReviewInfo[]>;
  /** Deletes one saved review (and forgets it); answers with the ones left. */
  deleteSaved(reviewKey: string): Promise<SavedReviewInfo[]>;
  deleteAllSaved(): Promise<SavedReviewInfo[]>;
  /** The local copies of repositories (US-19), most recently used first. */
  clones(): Promise<CloneInfo[]>;
  /** Deletes one copy (`owner/repo`); refused while a review uses it. Answers with the ones left. */
  deleteClone(repo: string): Promise<CloneInfo[]>;
  /** Deletes every copy no review is using. */
  deleteAllClones(): Promise<CloneInfo[]>;
  /**
   * Posts a review of this PR head to GitHub (US-20), as the app's GitHub
   * login, after the user confirmed it. Main refuses it if the PR has new
   * commits since: the review is about the commit it was made for.
   */
  post(reviewKey: string, request: PostReviewRequest): Promise<PostReviewResult>;
  /** The last review posted for this one, if any. */
  posted(reviewKey: string): Promise<PostedReview | null>;
}

/**
 * The GitHub login as the renderer sees it. Never the token: it stays in main.
 */
export interface GitHubStatus {
  signedIn: boolean;
  login?: string;
  name?: string | null;
  /** "gh": the GitHub CLI's login; "token": a token the user pasted. */
  source?: "gh" | "token";
  /** Where a pasted token is kept: encrypted on disk, or only for this run. */
  tokenStorage: "encrypted" | "memory";
  /** A `gh` binary was found (it may still be logged out). */
  ghInstalled: boolean;
  /** Why the last step failed, in words for the user. */
  error?: string;
}

/** A repository the GitHub login can see (US-13). */
export interface RepoSummary {
  /** `owner/name`, as GitHub spells it. */
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  description: string | null;
  /** Last push (ISO time); null for an empty repository. */
  pushedAt: string | null;
}

/** One page of the repositories, most recently pushed first. */
export interface RepoPage {
  ok: true;
  page: number;
  repos: RepoSummary[];
  hasMore: boolean;
  /** Page 1 only: the repositories used last in the app, most recent first. */
  recent?: RepoSummary[];
}

/** An open pull request in the PR list (US-14). */
export interface PullSummary {
  number: number;
  title: string;
  author: string;
  /** ISO time of the last update. */
  updatedAt: string;
  draft: boolean;
  url: string;
  headSha: string;
  /** From the PR itself (the list has no sizes); missing if that read failed. */
  size?: { additions: number; deletions: number; changedFiles: number };
  /** The newest review made in the app for this PR, at whatever head it had. */
  review?: { reviewKey: string; headSha: string; doneAt?: string; posted?: PostVerdict };
}

/** One page of a repository's open PRs, most recently updated first. */
export interface PullPage {
  ok: true;
  /** `owner/name`. */
  repo: string;
  page: number;
  pulls: PullSummary[];
  hasMore: boolean;
}

/** A GitHub list (repositories, PRs) that could not be read. */
export interface GitHubListError {
  ok: false;
  /**
   * "signed-out": no GitHub login. "token-rejected": GitHub refused the token
   * (expired or revoked); main has signed out. "failed": anything else.
   */
  reason: "signed-out" | "token-rejected" | "failed";
  error: string;
}

/** Every call answers with the new status; failures set `error`. */
export interface GitHubBridge {
  status(): Promise<GitHubStatus>;
  /** The token goes to main only; nothing ever sends it back. */
  signInWithToken(token: string): Promise<GitHubStatus>;
  useGh(): Promise<GitHubStatus>;
  signOut(): Promise<GitHubStatus>;
  /** Page 1, 2, … of the repositories (100 per page). Failures are answers, not rejections. */
  repos(page: number): Promise<RepoPage | GitHubListError>;
  /** Marks a repository as just used, so it is listed first next time. */
  markRepoUsed(fullName: string): Promise<void>;
  /** Page 1, 2, … of a repository's open PRs (30 per page), with sizes. */
  pulls(fullName: string, page: number): Promise<PullPage | GitHubListError>;
}

/**
 * The installed Claude Code the reviews run (US-21). "missing": not found
 * (or the chosen one is gone); "too-old": older than the Agent SDK's Claude
 * Code version; "broken": it did not answer `--version` like Claude Code.
 */
export interface ClaudeCodeStatus {
  state: "ok" | "missing" | "too-old" | "broken";
  /** The binary checked (not for "missing"). */
  path?: string;
  /** "2.1.311" (for "ok" and "too-old"). */
  version?: string;
  /** The oldest version that works: the app's Agent SDK's Claude Code version. */
  minVersion: string;
  /** The user chose the binary (else the app searched for it). */
  chosen: boolean;
  /** "missing": where the app looked. */
  searched?: string[];
  /** What is wrong and what to do (not for "ok"). */
  message?: string;
  /** ISO time. */
  checkedAt: string;
}

/** Claude Code's install page (Settings links to it when none is found). */
export const CLAUDE_CODE_INSTALL_URL = "https://code.claude.com/docs/en/setup";

/** Every call answers with the new status. */
export interface ClaudeBridge {
  /** The last check (main checks at start and before each review). */
  status(): Promise<ClaudeCodeStatus>;
  /** Checks again. */
  check(): Promise<ClaudeCodeStatus>;
  /** Main opens a file dialog; the chosen binary is used from now on. */
  choose(): Promise<ClaudeCodeStatus>;
  /** Forgets the chosen binary and searches again. */
  search(): Promise<ClaudeCodeStatus>;
}

/** `window.reviewBuddy`. */
export interface DesktopBridge {
  review: ReviewBridge;
  github: GitHubBridge;
  claude: ClaudeBridge;
}
