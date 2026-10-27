import { Badge, Button } from "@review-buddy/viewer/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GitHubBridge,
  GitHubListError,
  PullPage,
  PullSummary,
  RepoSummary,
  ReviewJobStatus,
} from "../../shared/ipc.ts";
import { timeAgo } from "./RepoList.tsx";
import { ipcErrorMessage } from "./ReviewRun.tsx";

/** What the app has for one PR: a job in progress, a review, a failure. */
export interface PullRowState {
  /** Queued or running. */
  job?: ReviewJobStatus;
  /** The newest review; `current` if it is for the PR's head now. */
  review?: { reviewKey: string; pr: string; current: boolean };
  /** The newest job failed (not stopped), and none is in progress. */
  failed?: string;
}

/** Joins a PR with the app's jobs (live) and main's newest review (from the list). */
export function pullState(repo: string, pull: PullSummary, jobs: ReviewJobStatus[]): PullRowState {
  const label = `${repo}#${pull.number}`;
  const mine = jobs.filter((j) => j.pr.toLowerCase() === label.toLowerCase());
  const state: PullRowState = {};
  const active = mine.find((j) => j.state === "queued" || j.state === "running");
  if (active) state.job = active;
  // Jobs are oldest first, and a finished job is newer than the list's answer.
  const done = mine.filter((j) => j.state === "done" && j.reviewKey && j.headSha).at(-1);
  const review = done ? { reviewKey: done.reviewKey!, headSha: done.headSha! } : pull.review;
  if (review) {
    state.review = {
      reviewKey: review.reviewKey,
      pr: label,
      current: review.headSha === pull.headSha,
    };
  }
  const last = mine.filter((j) => j.state === "done" || j.state === "failed").at(-1);
  if (!active && last?.state === "failed" && last.error !== "Stopped.") {
    state.failed = last.error ?? "The review failed.";
  }
  return state;
}

/** "+120 −30 · 5 files". */
export function sizeText(size: PullSummary["size"]): string {
  if (!size) return "";
  const files = `${size.changedFiles} file${size.changedFiles === 1 ? "" : "s"}`;
  return `+${size.additions} −${size.deletions} · ${files}`;
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; reason: GitHubListError["reason"]; error: string }
  | {
      kind: "ready";
      pulls: PullSummary[];
      page: number;
      hasMore: boolean;
      more?: "loading" | { error: string };
    };

/**
 * The open PRs of one repository (US-14), most recently updated first: size,
 * draft flag, and what the app has for each (a review, up to date or not; a
 * job in progress; a failure). Reviews start for one PR or for the selected
 * ones; they run one after another.
 */
export function PullList({
  bridge,
  repo,
  jobs,
  onReview,
  onOpenReview,
  onFollow,
  onStop,
  onSignedOut,
  onOpenSettings,
  onBack,
}: {
  bridge: GitHubBridge;
  repo: RepoSummary;
  jobs: ReviewJobStatus[];
  /** Starts reviews of these PRs; resolves with what went wrong, if anything. */
  onReview: (numbers: number[], follow: boolean) => Promise<string | undefined>;
  onOpenReview: (review: { reviewKey: string; pr: string }) => void;
  onFollow: (jobId: number) => void;
  onStop: (jobId: number) => void;
  onSignedOut: () => void;
  onOpenSettings: () => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [startError, setStartError] = useState<string | undefined>();
  const loadId = useRef(0);
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  const fetchPage = useCallback(
    (page: number): Promise<PullPage | GitHubListError> =>
      bridge
        .pulls(repo.fullName, page)
        .catch(
          (e): GitHubListError => ({ ok: false, reason: "failed", error: ipcErrorMessage(e) }),
        ),
    [bridge, repo.fullName],
  );

  const failed = useCallback((result: GitHubListError) => {
    setState({ kind: "error", reason: result.reason, error: result.error });
    if (result.reason !== "failed") signedOut.current();
  }, []);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setState({ kind: "loading" });
    const result = await fetchPage(1);
    if (id !== loadId.current) return;
    if (!result.ok) return failed(result);
    setState({ kind: "ready", pulls: result.pulls, page: 1, hasMore: result.hasMore });
  }, [fetchPage, failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (state.kind !== "ready" || state.more === "loading") return;
    const id = loadId.current;
    setState({ ...state, more: "loading" });
    const result = await fetchPage(state.page + 1);
    if (id !== loadId.current) return;
    if (!result.ok) {
      if (result.reason !== "failed") return failed(result);
      return setState((s) => (s.kind === "ready" ? { ...s, more: { error: result.error } } : s));
    }
    setState((s) => {
      if (s.kind !== "ready") return s;
      const seen = new Set(s.pulls.map((p) => p.number));
      return {
        ...s,
        pulls: [...s.pulls, ...result.pulls.filter((p) => !seen.has(p.number))],
        page: result.page,
        hasMore: result.hasMore,
        more: undefined,
      };
    });
  };

  const review = async (numbers: number[], follow: boolean) => {
    setStartError(await onReview(numbers, follow));
    setSelected(new Set());
  };

  const toggle = (n: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(n)) next.add(n);
      return next;
    });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Button variant="ghost" size="sm" className="-ml-3 mb-2" onClick={onBack}>
        ← Repositories
      </Button>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="min-w-0 truncate text-lg font-semibold">{repo.fullName}</h1>
        <span className="text-sm text-muted-foreground">Open pull requests</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={state.kind === "loading"}
          onClick={() => void load()}
        >
          Refresh
        </Button>
        <Button
          size="sm"
          disabled={selected.size === 0}
          onClick={() => void review([...selected], false)}
        >
          {selected.size > 0 ? `Review selected (${selected.size})` : "Review selected"}
        </Button>
      </div>
      {startError ? (
        <p role="alert" className="mb-3 whitespace-pre-wrap text-sm text-destructive">
          {startError}
        </p>
      ) : null}
      {state.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading the pull requests…</p>
      ) : state.kind === "error" ? (
        <div className="space-y-3 text-sm">
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
            {state.reason !== "failed" ? (
              <Button onClick={onOpenSettings}>Open GitHub settings</Button>
            ) : null}
          </div>
        </div>
      ) : state.pulls.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open pull requests.</p>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y rounded-md border">
            {state.pulls.map((pull) => (
              <PullRow
                key={pull.number}
                pull={pull}
                row={pullState(repo.fullName, pull, jobs)}
                selected={selected.has(pull.number)}
                onToggle={() => toggle(pull.number)}
                onReview={() => void review([pull.number], true)}
                onOpenReview={onOpenReview}
                onFollow={onFollow}
                onStop={onStop}
              />
            ))}
          </ul>
          {state.hasMore ? (
            <div className="flex items-center gap-3 text-sm">
              <Button
                variant="outline"
                disabled={state.more === "loading"}
                onClick={() => void loadMore()}
              >
                {state.more === "loading" ? "Loading…" : "Load more"}
              </Button>
              {typeof state.more === "object" ? (
                <span role="alert" className="text-destructive">
                  {state.more.error}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PullRow({
  pull,
  row,
  selected,
  onToggle,
  onReview,
  onOpenReview,
  onFollow,
  onStop,
}: {
  pull: PullSummary;
  row: PullRowState;
  selected: boolean;
  onToggle: () => void;
  onReview: () => void;
  onOpenReview: (review: { reviewKey: string; pr: string }) => void;
  onFollow: (jobId: number) => void;
  onStop: (jobId: number) => void;
}) {
  const n = pull.number;
  const { job, review, failed } = row;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        aria-label={`Select #${n}`}
        checked={selected && !job}
        disabled={!!job}
        onChange={onToggle}
        className="size-4 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">#{n}</span>
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate font-medium hover:underline"
          >
            {pull.title}
          </a>
          {pull.draft ? <Badge variant="outline">Draft</Badge> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          @{pull.author}
          {pull.updatedAt ? ` · updated ${timeAgo(pull.updatedAt, Date.now())}` : ""}
          {pull.size ? ` · ${sizeText(pull.size)}` : ""}
          {failed ? (
            <span className="text-destructive" title={failed}>
              {" "}
              · Last review failed: {failed}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {job?.state === "running" ? (
          <>
            <Badge>Reviewing…</Badge>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Show the progress of #${n}`}
              onClick={() => onFollow(job.id)}
            >
              Show progress
            </Button>
          </>
        ) : job ? (
          <>
            <Badge variant="secondary">Queued</Badge>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Take #${n} out of the queue`}
              onClick={() => onStop(job.id)}
            >
              Remove
            </Button>
          </>
        ) : (
          <>
            {review ? (
              <>
                {review.current ? (
                  <Badge variant="secondary">Reviewed</Badge>
                ) : (
                  <Badge variant="outline" title="The PR has new commits since this review.">
                    Outdated review
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Open the review of #${n}`}
                  onClick={() => onOpenReview(review)}
                >
                  Open review
                </Button>
              </>
            ) : null}
            {review?.current ? null : (
              <Button size="sm" aria-label={`Review #${n}`} onClick={onReview}>
                {review ? "Review again" : "Review"}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
