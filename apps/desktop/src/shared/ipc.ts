/**
 * The IPC contract between main and the renderer. The preload script exposes
 * `window.reviewBuddy = { review, github }`: the renderer wraps `review` in a
 * `ReviewApi` for the viewer (renderer/src/ipc-review-api.ts) and uses
 * `github` in the settings view. Types only, plus the channel names: both
 * sides import this file, so they cannot drift.
 */
import type { ResolvedReview } from "@review-buddy/core/types";

export const IPC = {
  getReview: "review:get",
  getFileContent: "review:file-content",
  getConfig: "review:config",
  done: "review:done",
  startReview: "review:start",
  stopReview: "review:stop",
  reviewRunStatus: "review:run-status",
  githubStatus: "github:status",
  githubSignInWithToken: "github:sign-in-with-token",
  githubUseGh: "github:use-gh",
  githubSignOut: "github:sign-out",
} as const;

/** The review main loads at startup until the PR screens exist (US-13/14). */
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
 * The agent review of one PR (US-12), as the renderer sees it. One run at a
 * time; the renderer polls it while it runs.
 */
export interface ReviewRunStatus {
  /** Counts runs (0 = none yet), so the renderer can remount the viewer per run. */
  run: number;
  state: "idle" | "running" | "done" | "failed";
  /** `owner/repo#123`. */
  pr?: string;
  /** Set when done: the review to load with getReview. */
  reviewKey?: string;
  /** What the agent did so far, oldest first (the last few). */
  steps: string[];
  /** Resolution notes of the review shown: places its anchors did not match. */
  notes?: string[];
  error?: string;
}

/** What the preload script exposes. Every call names the review it is about. */
export interface ReviewBridge {
  getReview(reviewKey: string): Promise<ResolvedReview>;
  getFileContent(reviewKey: string, path: string, side: FileSide): Promise<IpcFileContent>;
  getConfig(): Promise<{ roundtrip: boolean }>;
  done(reviewKey: string, result: IpcDoneResult): Promise<void>;
  /** Starts the agent on a PR ("owner/repo#123" or its URL). Rejects while one runs. */
  start(pr: string): Promise<ReviewRunStatus>;
  stop(): Promise<ReviewRunStatus>;
  runStatus(): Promise<ReviewRunStatus>;
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

/** Every call answers with the new status; failures set `error`. */
export interface GitHubBridge {
  status(): Promise<GitHubStatus>;
  /** The token goes to main only; nothing ever sends it back. */
  signInWithToken(token: string): Promise<GitHubStatus>;
  useGh(): Promise<GitHubStatus>;
  signOut(): Promise<GitHubStatus>;
}

/** `window.reviewBuddy`. */
export interface DesktopBridge {
  review: ReviewBridge;
  github: GitHubBridge;
}
