/**
 * The IPC contract between main and the renderer. The preload script exposes
 * `window.reviewBuddy = { review, github }`: the renderer wraps `review` in a
 * `ReviewApi` for the viewer (renderer/src/ipc-review-api.ts) and uses
 * `github` in the settings view and the repository and PR lists. Types only,
 * plus the channel names: both sides import this file, so they cannot drift.
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
  /** Main → renderer: the job list changed (an event, not a call). */
  reviewJobsChanged: "review:jobs-changed",
  githubStatus: "github:status",
  githubSignInWithToken: "github:sign-in-with-token",
  githubUseGh: "github:use-gh",
  githubSignOut: "github:sign-out",
  githubRepos: "github:repos",
  githubMarkRepoUsed: "github:mark-repo-used",
  githubPulls: "github:pulls",
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

/** What the preload script exposes. Every call names the review it is about. */
export interface ReviewBridge {
  getReview(reviewKey: string): Promise<ResolvedReview>;
  getFileContent(reviewKey: string, path: string, side: FileSide): Promise<IpcFileContent>;
  getConfig(): Promise<{ roundtrip: boolean }>;
  done(reviewKey: string, result: IpcDoneResult): Promise<void>;
  /**
   * Queues a review of a PR ("owner/repo#123" or its URL); it starts when a
   * slot is free. Rejects a PR that is already queued or running. Also the
   * "Try again" of a failed review.
   */
  start(pr: string): Promise<ReviewJobStatus>;
  /** Stops a running job, or takes a queued one out of the queue. */
  stop(id: number): Promise<ReviewJobStatus[]>;
  /** Queued and running jobs, and the last finished ones, oldest first. */
  jobs(): Promise<ReviewJobStatus[]>;
  /** Calls `listener` with the job list on every change; returns "unsubscribe". */
  onJobs(listener: (jobs: ReviewJobStatus[]) => void): () => void;
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
  review?: { reviewKey: string; headSha: string };
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

/** `window.reviewBuddy`. */
export interface DesktopBridge {
  review: ReviewBridge;
  github: GitHubBridge;
}
