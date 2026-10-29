import { Badge, Button } from "@review-buddy/viewer/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaudeModelOption,
  GitHubBridge,
  GitHubListError,
  ModelChoice,
  PostVerdict,
  PullLabel,
  PullPage,
  PullSummary,
  RepoSummary,
  ReviewEffort,
  ReviewJobStatus,
} from "../../shared/ipc.ts";
import { choiceLabel } from "../../shared/models.ts";
import { ModelChoiceFields, type useModels } from "./ModelPicker.tsx";
import { postedLabel } from "./PostReview.tsx";
import { timeAgo } from "./RepoList.tsx";
import { elapsed, ipcErrorMessage, PHASES, useNow } from "./ReviewRun.tsx";

/** What the app has for one PR: a job in progress, a review, a failure. */
export interface PullRowState {
  /** Queued or running. */
  job?: ReviewJobStatus;
  /**
   * The newest review; `current` if it is for the PR's head now; `doneAt` if
   * the reviewer pressed Done on it (US-17); `posted` if it went to GitHub.
   */
  review?: {
    reviewKey: string;
    pr: string;
    current: boolean;
    doneAt?: string;
    /** The verdict last posted to GitHub (US-20). */
    posted?: PostVerdict;
    /** What it was made with (US-22): the model, and the effort it ran at. */
    model?: string;
    effort?: ReviewEffort;
  };
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
  // A review this run made knows what it ran on from its own job; the list's
  // answer is about the review main had when the page was read.
  const review = done
    ? { reviewKey: done.reviewKey!, headSha: done.headSha!, model: done.model, effort: done.effort }
    : pull.review;
  if (review) {
    state.review = {
      reviewKey: review.reviewKey,
      pr: label,
      current: review.headSha === pull.headSha,
    };
    if (review.model) state.review.model = review.model;
    if (review.effort) state.review.effort = review.effort;
    // Done and posted are known from the list (main), for that same review.
    if (pull.review?.reviewKey === review.reviewKey) {
      if (pull.review.doneAt) state.review.doneAt = pull.review.doneAt;
      if (pull.review.posted) state.review.posted = pull.review.posted;
    }
  }
  const last = mine.filter((j) => j.state === "done" || j.state === "failed").at(-1);
  if (!active && last?.state === "failed" && last.error !== "Stopped.") {
    state.failed = last.error ?? "The review failed.";
  }
  return state;
}

/** How the PR relates to the signed-in user: theirs, waiting on their review. */
export interface PullOwnership {
  /** The signed-in user opened it. */
  mine: boolean;
  /** GitHub has a pending review request for the signed-in user. */
  reviewRequested: boolean;
}

/**
 * Whether a PR is the signed-in user's own and whether it waits on their
 * review (US-14). Logins are compared case-insensitively, as GitHub does.
 * With no login known (signed out), a PR is neither.
 */
export function pullOwnership(pull: PullSummary, viewer: string | undefined): PullOwnership {
  const me = viewer?.toLowerCase();
  if (!me) return { mine: false, reviewRequested: false };
  return {
    mine: pull.author.toLowerCase() === me,
    reviewRequested: pull.requestedReviewers.some((login) => login.toLowerCase() === me),
  };
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
  viewer,
  models,
  override,
  onOverride,
  onReview,
  onOpenReview,
  onFollow,
  onStop,
  onSignedOut,
  onOpenSettings,
  onBack,
  blocked,
}: {
  bridge: GitHubBridge;
  repo: RepoSummary;
  jobs: ReviewJobStatus[];
  /** The signed-in GitHub login, to color your own handle and show the "Review requested" badge. */
  viewer?: string;
  /** The models reviews can run on, and the default choice (US-22). */
  models: ReturnType<typeof useModels>;
  /**
   * What the reviews started here run on; empty means the app's default. It
   * is the app shell's state, so it survives this list being rebuilt.
   */
  override: ModelChoice;
  onOverride: (choice: ModelChoice) => void;
  /** Why no review can run (no usable Claude Code, US-21): Review buttons are off. */
  blocked?: string;
  /**
   * Starts reviews of these PRs (`fresh`: run Claude even if the head has a
   * saved review; `choice`: the model and effort for them, instead of the
   * default); resolves with what went wrong, if anything.
   */
  onReview: (
    numbers: number[],
    follow: boolean,
    fresh?: boolean,
    choice?: ModelChoice,
  ) => Promise<string | undefined>;
  onOpenReview: (review: {
    reviewKey: string;
    pr: string;
    outdated: boolean;
    doneAt?: string;
  }) => void;
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

  const review = async (numbers: number[], follow: boolean, fresh = false) => {
    setStartError(await onReview(numbers, follow, fresh, override));
    setSelected(new Set());
  };

  const defaultLabel = choiceLabel(models.models, models.choice);
  // The model list is asked for when this list is first shown (US-22).
  const { ensure } = models;
  useEffect(ensure, [ensure]);

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
      <div className="mb-5 flex flex-wrap items-end gap-3">
        {/* One line of inline spans, so the heading's accessible name stays
            exactly "owner/name": block children would have it read as
            "owner/ name", which is not what it was. */}
        <h1 className="min-w-0 truncate font-serif text-[2rem] font-normal leading-none">
          <span className="text-muted-foreground">{repo.fullName.split("/")[0]}/</span>
          {repo.fullName.split("/").slice(1).join("/")}
        </h1>
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
          disabled={selected.size === 0 || !!blocked}
          title={blocked}
          onClick={() => void review([...selected], false)}
        >
          {selected.size > 0 ? `Review selected (${selected.size})` : "Review selected"}
        </Button>
      </div>
      {/* The model and effort the reviews started here run on (US-22). */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-muted-foreground">Review with</span>
        <ModelChoiceFields
          labels={false}
          models={models.models}
          value={override}
          onChange={onOverride}
          disabled={models.loading}
          defaultModel={models.choice.model}
          defaultModelLabel={defaultLabel ? `Default (${defaultLabel})` : "Claude Code's default"}
          defaultEffortLabel={
            models.choice.effort ? `Default (${models.choice.effort})` : "Default"
          }
        />
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
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {state.pulls.map((pull) => (
              <PullRow
                key={pull.number}
                pull={pull}
                row={pullState(repo.fullName, pull, jobs)}
                ownership={pullOwnership(pull, viewer)}
                selected={selected.has(pull.number)}
                onToggle={() => toggle(pull.number)}
                onReview={(fresh) => void review([pull.number], true, fresh)}
                models={models.models}
                blocked={blocked}
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

/** Labels shown on a row before the rest fold into "+N". */
const LABELS_SHOWN = 3;

/** A PR's labels: GitHub's color as a dot, so the text stays readable in both themes. */
function PullLabels({ labels }: { labels: PullLabel[] }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, LABELS_SHOWN);
  const rest = labels.slice(LABELS_SHOWN);
  return (
    <>
      {shown.map((label) => (
        <Badge
          key={label.name}
          variant="outline"
          className="max-w-40 shrink-0 gap-1 font-normal text-muted-foreground"
          title={label.description ?? label.name}
        >
          {label.color ? (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `#${label.color}` }}
            />
          ) : null}
          <span className="truncate">{label.name}</span>
        </Badge>
      ))}
      {rest.length > 0 ? (
        <Badge
          variant="outline"
          className="shrink-0 font-normal text-muted-foreground"
          title={rest.map((label) => label.name).join(", ")}
        >
          +{rest.length}
        </Badge>
      ) : null}
    </>
  );
}

function PullRow({
  pull,
  row,
  ownership,
  selected,
  onToggle,
  onReview,
  onOpenReview,
  onFollow,
  onStop,
  blocked,
  models,
}: {
  pull: PullSummary;
  row: PullRowState;
  ownership: PullOwnership;
  blocked?: string;
  selected: boolean;
  onToggle: () => void;
  onReview: (fresh: boolean) => void;
  /** The model list, to name what the review was made with (US-22). */
  models: ClaudeModelOption[];
  onOpenReview: (review: {
    reviewKey: string;
    pr: string;
    outdated: boolean;
    doneAt?: string;
  }) => void;
  onFollow: (jobId: number) => void;
  onStop: (jobId: number) => void;
}) {
  const n = pull.number;
  const { job, review, failed } = row;
  const { mine, reviewRequested } = ownership;
  // What the review shown here was made with (US-22).
  const madeWith = choiceLabel(models, review);
  const now = useNow(job?.state === "running");
  return (
    <li
      className={`flex flex-wrap items-center gap-3 border-l-2 px-4 py-3 ${
        reviewRequested ? "border-l-primary" : mine ? "border-l-border" : "border-l-transparent"
      }`}
    >
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
          <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">#{n}</span>
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate font-medium hover:text-primary hover:underline"
          >
            {pull.title}
          </a>
          {pull.draft ? (
            <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
              Draft
            </Badge>
          ) : null}
          {reviewRequested ? (
            <Badge
              className="shrink-0 font-normal"
              title="GitHub is waiting for your review of this pull request."
            >
              Review requested
            </Badge>
          ) : null}
          <PullLabels labels={pull.labels} />
        </div>
        <div className="mt-0.5 truncate text-[0.72rem] text-muted-foreground">
          {mine ? (
            <span className="font-medium text-primary" title="You opened this pull request.">
              @{pull.author}
              <span className="sr-only"> (you)</span>
            </span>
          ) : (
            `@${pull.author}`
          )}
          {pull.updatedAt ? ` · updated ${timeAgo(pull.updatedAt, Date.now())}` : ""}
          {pull.size ? ` · ${sizeText(pull.size)}` : ""}
          {failed ? (
            <span className="text-destructive" title={failed}>
              {" "}
              · Last review failed: {failed.split("\n")[0]}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {job?.state === "running" ? (
          <>
            {/* The phase the job is in, as a bar: four phases, so each one
                that lands fills a quarter. No new data, just the phase index. */}
            <span
              aria-hidden
              className="hidden h-1 w-24 overflow-hidden rounded-full bg-secondary sm:block"
            >
              <span
                className="block h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${((PHASES.findIndex((p) => p.phase === job.phase) + 1) / PHASES.length) * 100}%`,
                }}
              />
            </span>
            <Badge className="font-normal">Reviewing…</Badge>
            <span className="font-mono text-[0.7rem] tabular-nums text-muted-foreground">
              {PHASES.find((p) => p.phase === job.phase)?.short ?? "starting"}
              {job.startedAt !== undefined ? ` · ${elapsed(now - job.startedAt)}` : ""}
            </span>
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
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Queued
            </Badge>
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
            {madeWith ? (
              <span
                className="text-[0.7rem] text-muted-foreground"
                title="What this review was made with. Pick another above and run it again."
              >
                {madeWith}
              </span>
            ) : null}
            {review ? (
              <>
                {review.current && review.posted ? (
                  <Badge
                    variant="outline"
                    className="border-risk-low/40 bg-risk-low-bg font-normal text-risk-low"
                    title="You posted your review of this commit to GitHub."
                  >
                    {postedLabel(review.posted)} on GitHub
                  </Badge>
                ) : review.current && review.doneAt ? (
                  <Badge
                    variant="outline"
                    className="border-risk-low/40 bg-risk-low-bg font-normal text-risk-low"
                    title={`You pressed Done ${timeAgo(review.doneAt, Date.now())}.`}
                  >
                    Done ✓
                  </Badge>
                ) : review.current ? (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    Reviewed
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-risk-medium/40 bg-risk-medium-bg font-normal text-risk-medium"
                    title="The PR has new commits since this review."
                  >
                    Outdated review
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Open the review of #${n}`}
                  onClick={() =>
                    onOpenReview({
                      reviewKey: review.reviewKey,
                      pr: review.pr,
                      outdated: !review.current,
                      doneAt: review.doneAt,
                    })
                  }
                >
                  Open review
                </Button>
                {review.current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Run the review of #${n} again`}
                    title={blocked ?? "Run Claude again on this commit"}
                    disabled={!!blocked}
                    onClick={() => onReview(true)}
                  >
                    Run again
                  </Button>
                ) : null}
              </>
            ) : null}
            {review?.current ? null : (
              <Button
                size="sm"
                aria-label={`Review #${n}`}
                disabled={!!blocked}
                title={blocked}
                onClick={() => onReview(false)}
              >
                {failed ? "Try again" : review ? "Review again" : "Review"}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
