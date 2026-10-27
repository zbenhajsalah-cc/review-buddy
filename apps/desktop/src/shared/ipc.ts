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

/** What the preload script exposes. Every call names the review it is about. */
export interface ReviewBridge {
  getReview(reviewKey: string): Promise<ResolvedReview>;
  getFileContent(reviewKey: string, path: string, side: FileSide): Promise<IpcFileContent>;
  getConfig(): Promise<{ roundtrip: boolean }>;
  done(reviewKey: string, result: IpcDoneResult): Promise<void>;
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
