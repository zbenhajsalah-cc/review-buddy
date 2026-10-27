/**
 * One page of a GitHub list (repositories, pull requests) with the app's
 * token. Failures are answers (`GitHubListError`), so the renderer can tell
 * "token expired" from the rest: a 401 means the token expired or was
 * revoked, and signs the app out of GitHub.
 *
 * No Electron imports: tested with bun (through repos.test.ts and pulls.test.ts).
 */
import type { GitHubListError } from "../../shared/ipc.ts";
import { errorMessage } from "./api-source.ts";
import { type FetchFn, githubHeaders } from "./auth.ts";

export interface ListCallDeps {
  fetch: FetchFn;
  auth: {
    token(): Promise<string>;
    tokenRejected(token: string): Promise<void>;
  };
  now?: () => number;
}

/** GitHub's paging works this far; it guards page numbers from IPC. */
const MAX_PAGE = 1000;

export function checkPage(page: unknown): number {
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new Error(`Not a page number: ${String(page)}`);
  }
  return page;
}

/** GitHub's `Link` header names a next page. */
export function hasNextPage(link: string | null): boolean {
  return link !== null && /<[^>]*>;\s*rel="next"/.test(link);
}

export interface ListPage {
  ok: true;
  /** The token the page was read with (for follow-up reads). */
  token: string;
  items: unknown[];
  hasMore: boolean;
}

/**
 * GETs `url` and expects a JSON array. `what` names the list in messages
 * ("your repositories"); `notFound` is the message for a 404.
 */
export async function getListPage(
  deps: ListCallDeps,
  url: string,
  what: string,
  notFound?: string,
): Promise<ListPage | GitHubListError> {
  let token: string;
  try {
    token = await deps.auth.token();
  } catch (e) {
    return { ok: false, reason: "signed-out", error: messageOf(e) };
  }
  let res: Response;
  try {
    res = await deps.fetch(url, { headers: githubHeaders(token) });
  } catch (e) {
    return { ok: false, reason: "failed", error: `Could not reach GitHub (${messageOf(e)}).` };
  }
  if (res.status === 401) {
    await deps.auth.tokenRejected(token);
    return {
      ok: false,
      reason: "token-rejected",
      error:
        "GitHub rejected the token: it expired or was revoked. Sign in again in the GitHub settings.",
    };
  }
  if (res.status === 404 && notFound) return { ok: false, reason: "failed", error: notFound };
  if (!res.ok) return { ok: false, reason: "failed", error: await failure(res, what, deps.now) };
  const body: unknown = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    return { ok: false, reason: "failed", error: `GitHub sent no list of ${what}.` };
  }
  return { ok: true, token, items: body, hasMore: hasNextPage(res.headers.get("link")) };
}

/** Why a GitHub answer failed, in words for the user (rate limit first). */
export async function failure(
  res: Response,
  what: string,
  now: () => number = Date.now,
): Promise<string> {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && remaining === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const minutes = Number.isFinite(reset) ? Math.max(1, Math.ceil((reset - now()) / 60_000)) : 0;
    return `GitHub's API rate limit is used up.${minutes ? ` Try again in ${minutes} minute(s).` : ""}`;
  }
  const message = await errorMessage(res);
  return `GitHub answered ${res.status} for ${what}${message ? ` (${message})` : ""}.`;
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
