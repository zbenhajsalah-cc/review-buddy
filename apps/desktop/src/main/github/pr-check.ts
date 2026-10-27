/**
 * `--pr-check=<owner/repo#123 | PR URL>`: open a real PR with GitHubApiSource
 * (US-11) using the app's GitHub login, read its diff and one file on both
 * sides, and print a summary. For trying the source on your own PRs before the
 * PR screens exist.
 */
import { parseDiff } from "@review-buddy/core/diff";
import {
  type GitHubApiSource,
  IncompleteDiffError,
  type PrRef,
  PrTooLargeError,
  parsePrRef,
} from "./api-source.ts";

/** "owner/repo#123" or "https://github.com/owner/repo/pull/123". */
export function parsePrArg(value: string): PrRef {
  const m =
    /^([^/#\s]+)\/([^/#\s]+)#(\d+)$/.exec(value.trim()) ??
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/.exec(value.trim());
  if (!m) throw new Error(`Expected owner/repo#123 or a github.com PR URL, got "${value}"`);
  return parsePrRef({ owner: m[1]!, repo: m[2]!, number: Number(m[3]) });
}

export interface PrCheckResult {
  ok: boolean;
  pr?: { title: string; author: string; base: string; head: string; url?: string };
  headSha?: string;
  baseSha?: string;
  diff?: { files: number; additions: number; deletions: number; bytes: number };
  /** One modified text file, read on both sides (lengths only). */
  fileRead?: { path: string; headChars: number; baseChars: number };
  error?: string;
  errorKind?: "too_large" | "incomplete" | "other";
  durationMs: number;
}

export async function runPrCheck(open: () => Promise<GitHubApiSource>): Promise<PrCheckResult> {
  const started = Date.now();
  const result: PrCheckResult = { ok: false, durationMs: 0 };
  try {
    const source = await open();
    const { title, author, base, head, url } = await source.pr();
    Object.assign(result, {
      pr: { title, author, base, head, url },
      headSha: source.headSha,
      baseSha: source.baseSha,
    });
    const raw = await source.diff();
    const files = parseDiff(raw);
    result.diff = {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      bytes: raw.length,
    };
    const sample = files.find((f) => f.changeType === "modified" && !f.binary);
    if (sample) {
      const [head, baseText] = await Promise.all([
        source.fileContent(sample.path, "head"),
        source.fileContent(sample.path, "base"),
      ]);
      result.fileRead = { path: sample.path, headChars: head.length, baseChars: baseText.length };
    }
    result.ok = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.errorKind =
      e instanceof PrTooLargeError
        ? "too_large"
        : e instanceof IncompleteDiffError
          ? "incomplete"
          : "other";
  }
  result.durationMs = Date.now() - started;
  return result;
}
