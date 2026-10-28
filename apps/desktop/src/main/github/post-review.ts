/**
 * Posts a review to GitHub (US-20): the reviewer's verdict and text, as a PR
 * review of the commit the app reviewed.
 *
 *   GET  /repos/{o}/{r}/pulls/{n}           the PR's head must still be that commit
 *   POST /repos/{o}/{r}/pulls/{n}/reviews   { commit_id, event, body }
 *
 * The renderer sends the text it showed in its confirm step; main posts
 * exactly that, and only for a review it has (named by its key). Failures
 * are answers in words, never a half-done post: the one case where GitHub may
 * have the review but the app cannot know (the connection broke during the
 * POST) says so.
 *
 * No Electron imports: tested with bun and a fake fetch.
 */
import type {
  PostedReview,
  PostReviewRequest,
  PostReviewResult,
  PostVerdict,
} from "../../shared/ipc.ts";
import { parseLabel } from "../review-cache.ts";
import { type PrRef, parsePrRef } from "./api-source.ts";
import { type FetchFn, GITHUB_API, githubHeaders } from "./auth.ts";
import { failure, messageOf } from "./list-call.ts";

/** GitHub's limit for a review body. */
export const MAX_REVIEW_BODY = 65_536;

const EVENTS: Record<PostVerdict, string> = {
  approve: "APPROVE",
  request_changes: "REQUEST_CHANGES",
  comment: "COMMENT",
};

/** Checks a post request from the renderer; throws for anything malformed. */
export function parsePostRequest(value: unknown): PostReviewRequest {
  const { verdict, body } = (value ?? {}) as Record<string, unknown>;
  if (verdict !== "approve" && verdict !== "request_changes" && verdict !== "comment") {
    throw new Error("invalid verdict");
  }
  if (typeof body !== "string" || body.length > MAX_REVIEW_BODY) throw new Error("invalid body");
  // GitHub requires a text for these two.
  if (verdict !== "approve" && body.trim() === "") throw new Error("This review needs a text.");
  return { verdict, body };
}

export interface PostDeps {
  fetch: FetchFn;
  auth: {
    token(): Promise<string>;
    /** A call got 401: main signs out. */
    tokenRejected(token: string): Promise<void>;
  };
  now?: () => Date;
}

/** The `message` and `errors` of a GitHub error answer, in one line. */
export function githubError(body: string): string {
  try {
    const json = JSON.parse(body) as { message?: unknown; errors?: unknown };
    const parts: string[] = [];
    if (typeof json.message === "string") parts.push(json.message);
    if (Array.isArray(json.errors)) {
      for (const e of json.errors) {
        const text =
          typeof e === "string" ? e : typeof e?.message === "string" ? e.message : undefined;
        if (text) parts.push(text);
      }
    }
    return parts.join(": ");
  } catch {
    return "";
  }
}

/**
 * Posts `request` as a review of `ref` at `headSha`, as the app's GitHub login.
 * Refused ("outdated") when the PR's head is no longer `headSha`.
 */
export async function postPrReview(
  deps: PostDeps,
  prRef: PrRef,
  headSha: string,
  request: PostReviewRequest,
): Promise<PostReviewResult> {
  const ref = parsePrRef(prRef);
  const label = `${ref.owner}/${ref.repo}#${ref.number}`;
  const pullUrl = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  let token: string;
  try {
    token = await deps.auth.token();
  } catch (e) {
    return { ok: false, reason: "signed-out", error: messageOf(e) };
  }
  const rejected = async (): Promise<PostReviewResult> => {
    await deps.auth.tokenRejected(token);
    return {
      ok: false,
      reason: "token-rejected",
      error:
        "GitHub rejected the token: it expired or was revoked. Sign in again in the GitHub settings. Nothing was posted.",
    };
  };

  // 1. The PR must still be at the reviewed commit.
  let res: Response;
  try {
    res = await deps.fetch(pullUrl, { headers: githubHeaders(token) });
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      error: `Could not reach GitHub (${messageOf(e)}). Nothing was posted.`,
    };
  }
  if (res.status === 401) return rejected();
  if (!res.ok) {
    return {
      ok: false,
      reason: "failed",
      error: `${await failure(res, `PR ${label}`, () => (deps.now?.() ?? new Date()).getTime())} Nothing was posted.`,
    };
  }
  const pull = (await res.json().catch(() => null)) as { head?: { sha?: unknown } } | null;
  const nowHead = pull?.head?.sha;
  if (nowHead !== headSha) {
    return {
      ok: false,
      reason: "outdated",
      error:
        typeof nowHead === "string"
          ? `${label} has new commits since this review (${headSha.slice(0, 7)} → ${nowHead.slice(0, 7)}). Review it again before you post. Nothing was posted.`
          : `GitHub sent no head commit for ${label}. Nothing was posted.`,
    };
  }

  // 2. The review, on exactly that commit.
  const payload: Record<string, string> = { commit_id: headSha, event: EVENTS[request.verdict] };
  if (request.body.trim() !== "") payload.body = request.body;
  try {
    res = await deps.fetch(`${pullUrl}/reviews`, {
      method: "POST",
      headers: { ...githubHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      error: `The connection to GitHub broke while posting (${messageOf(e)}). The review may have been posted: look at ${label} on GitHub before you post again.`,
    };
  }
  if (res.status === 401) return rejected();
  if (!res.ok) {
    return { ok: false, reason: "failed", error: await postFailure(res, label, deps) };
  }
  const json = (await res.json().catch(() => null)) as {
    html_url?: unknown;
    user?: { login?: unknown } | null;
  } | null;
  const posted: PostedReview = {
    verdict: request.verdict,
    postedAt: (deps.now?.() ?? new Date()).toISOString(),
    url:
      typeof json?.html_url === "string" && json.html_url.startsWith("https://github.com/")
        ? json.html_url
        : `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
    login: typeof json?.user?.login === "string" ? json.user.login : "",
  };
  return { ok: true, posted };
}

/** Why GitHub refused the review, and what to do about it. */
async function postFailure(res: Response, label: string, deps: PostDeps): Promise<string> {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && remaining === "0") {
    return `${await failure(res, label, () => (deps.now?.() ?? new Date()).getTime())} Nothing was posted.`;
  }
  const said = githubError(await res.text().catch(() => ""));
  const answer = `GitHub answered ${res.status}${said ? ` (${said})` : ""}`;
  if (res.status === 403 || res.status === 404) {
    return (
      `${answer}: the GitHub login cannot post reviews on ${label}. ` +
      'A fine-grained token needs "Pull requests: Read and write" for this repository; a classic token needs the repo scope (public_repo for a public repository). Nothing was posted.'
    );
  }
  return `${answer}. Nothing was posted.`;
}

export interface ReviewPostingDeps extends PostDeps {
  store: {
    /** The PR and head of a PR review the app has (not the sample). */
    prOf(reviewKey: unknown): { label: string; headSha: string } | undefined;
    markPosted(reviewKey: string, posted: PostedReview): Promise<void>;
  };
}

/** Posts the app's reviews (the IPC handler), one post per review at a time. */
export class ReviewPosting {
  #busy = new Set<string>();

  constructor(private readonly deps: ReviewPostingDeps) {}

  async post(reviewKey: unknown, value: unknown): Promise<PostReviewResult> {
    const request = parsePostRequest(value);
    const pr = this.deps.store.prOf(reviewKey);
    const ref = pr && parseLabel(pr.label);
    if (!pr || !ref) throw new Error("unknown review");
    const key = reviewKey as string;
    // A second click while the first post runs would post twice.
    if (this.#busy.has(key)) throw new Error("This review is being posted already.");
    this.#busy.add(key);
    try {
      const result = await postPrReview(this.deps, ref, pr.headSha, request);
      if (result.ok) await this.deps.store.markPosted(key, result.posted);
      return result;
    } finally {
      this.#busy.delete(key);
    }
  }
}
