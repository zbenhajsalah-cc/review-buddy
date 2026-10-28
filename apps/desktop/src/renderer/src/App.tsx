import { clearReviewFileState, ReviewViewer } from "@review-buddy/viewer";
import { Button } from "@review-buddy/viewer/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ClaudeCodeStatus,
  type DesktopBridge,
  FIXTURE_REVIEW_KEY,
  type GitHubStatus,
  type RepoSummary,
  type ReviewJobStatus,
} from "../../shared/ipc.ts";
import { ClaudeCodeSettings, claudeBlocked } from "./ClaudeCodeSettings.tsx";
import { GitHubSettings } from "./GitHubSettings.tsx";
import { ipcReviewApi } from "./ipc-review-api.ts";
import { LocalCopies } from "./LocalCopies.tsx";
import { DoneBar } from "./PostReview.tsx";
import { PullList } from "./PullList.tsx";
import { RepoList } from "./RepoList.tsx";
import { ipcErrorMessage, PrForm, RunPanel } from "./ReviewRun.tsx";
import { SavedReviews } from "./SavedReviews.tsx";

type Screen = "repos" | "pulls" | "review" | "settings";

/** What the review tab shows. */
type View =
  | { kind: "sample" }
  /** A job: its progress, its failure, or its review once done. */
  | { kind: "job"; id: number }
  /**
   * A review opened from the PR list; `outdated` if the PR moved on since,
   * `doneAt` if the reviewer pressed Done.
   */
  | { kind: "review"; reviewKey: string; pr: string; outdated?: boolean; doneAt?: string };

/**
 * The app shell: a thin bar with tabs above the current screen. The app
 * opens on the repository list (US-13); picking a repository opens its PR
 * list (US-14), where reviews start. The review tab shows the review or job
 * being followed, or the sample review. The viewer is unmounted on the other
 * screens, so its keyboard shortcuts never see typing in their forms. The
 * repository and PR lists stay mounted (hidden), so they keep their pages.
 */
export function App({ bridge }: { bridge: DesktopBridge }) {
  const [screen, setScreen] = useState<Screen>("repos");
  // Where the settings' "Back" goes.
  const [back, setBack] = useState<Exclude<Screen, "settings">>("repos");
  const [github, setGitHub] = useState<GitHubStatus | null>(null);
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  // Counts changes to saved reviews (Done, delete): the PR list reloads after one.
  const [savedChanges, setSavedChanges] = useState(0);
  // Reviews marked done in this run, by key, with the time.
  const [doneNow, setDoneNow] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<ReviewJobStatus[]>([]);
  const [view, setView] = useState<View>({ kind: "sample" });
  const [startError, setStartError] = useState<string | undefined>();
  // The installed Claude Code (US-21); null until main's first check is back.
  const [claude, setClaude] = useState<ClaudeCodeStatus | null>(null);
  const blocked = claudeBlocked(claude);

  const refreshGitHub = useCallback(() => {
    bridge.github.status().then(setGitHub, () => {});
  }, [bridge]);

  useEffect(() => {
    refreshGitHub();
    // A review started with --review-pr (or before a reload) is followed.
    bridge.review.jobs().then(
      (found) => {
        setJobs(found);
        const last = found.at(-1);
        if (last) {
          setView({ kind: "job", id: last.id });
          setScreen("review");
        }
      },
      () => {},
    );
  }, [bridge, refreshGitHub]);

  // Main sends the job list on every change (US-15): no polling.
  useEffect(() => bridge.review.onJobs(setJobs), [bridge]);

  // A click on the notification that a review ended shows that review.
  useEffect(
    () =>
      bridge.review.onOpenJob((id) => {
        setView({ kind: "job", id });
        setScreen("review");
      }),
    [bridge],
  );

  // Main checks Claude Code at start and before each review: a review that
  // failed for Claude reads the newest check.
  const claudeFailures = jobs.filter((j) => j.errorKind === "claude").length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new "claude" failure reads it again
  useEffect(() => {
    bridge.claude.status().then(setClaude, () => {});
  }, [bridge, claudeFailures]);

  const job = view.kind === "job" ? jobs.find((j) => j.id === view.id) : undefined;
  // The repository a review opened last: main marked it used (US-13).
  const lastOpened = jobs.filter((j) => j.headSha).at(-1);
  const reviewKey =
    view.kind === "review"
      ? view.reviewKey
      : job?.state === "done"
        ? job.reviewKey!
        : FIXTURE_REVIEW_KEY;
  const api = useMemo(() => {
    const base = ipcReviewApi(bridge.review, reviewKey);
    return {
      ...base,
      done: async (result: Parameters<typeof base.done>[0]) => {
        await base.done(result);
        setDoneNow((d) => ({ ...d, [reviewKey]: new Date().toISOString() }));
        setSavedChanges((n) => n + 1);
      },
    };
  }, [bridge, reviewKey]);
  // A job's review may be a saved one that was done before (also before a
  // restart): Done is read from the saved reviews.
  const [savedDone, setSavedDone] = useState<{ reviewKey: string; doneAt?: string }>();
  useEffect(() => {
    if (view.kind !== "job" || reviewKey === FIXTURE_REVIEW_KEY) return;
    bridge.review.saved().then(
      (list) => {
        const found = list.find((i) => i.reviewKey.toLowerCase() === reviewKey.toLowerCase());
        setSavedDone({ reviewKey, doneAt: found?.doneAt });
      },
      () => {},
    );
  }, [bridge, reviewKey, view.kind]);
  const doneAt =
    doneNow[reviewKey] ??
    (view.kind === "review"
      ? view.doneAt
      : savedDone?.reviewKey === reviewKey
        ? savedDone.doneAt
        : undefined);
  const reviewTab = view.kind === "review" ? view.pr : (job?.pr ?? "Sample review");

  /**
   * Queues reviews; `follow` shows the first one; `fresh` runs Claude even if
   * a review of the PR's head is saved. Resolves with the errors, if any.
   */
  const startReviews = async (prs: string[], follow: boolean, fresh = false) => {
    const errors: string[] = [];
    let first: ReviewJobStatus | undefined;
    for (const pr of prs) {
      try {
        const started = await bridge.review.start(pr, fresh ? { fresh } : undefined);
        first ??= started;
      } catch (e) {
        errors.push(ipcErrorMessage(e));
      }
    }
    setJobs(await bridge.review.jobs().catch(() => jobs));
    if (follow && first) {
      setView({ kind: "job", id: first.id });
      setScreen("review");
    }
    return errors.length ? errors.join("\n") : undefined;
  };

  const startFromBar = async (value: string) => {
    const error = await startReviews([value], true);
    setStartError(error);
    return !error;
  };

  const stopJob = (id: number) => {
    bridge.review.stop(id).then(setJobs, () => {});
  };

  /** Saved reviews were deleted: nothing may show them any more. */
  const savedDeleted = (deleted: string[]) => {
    // Their viewed / collapsed state goes too.
    for (const key of deleted) clearReviewFileState(key);
    if (view.kind === "review" && deleted.includes(view.reviewKey)) setView({ kind: "sample" });
    setDoneNow((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !deleted.includes(k))));
    setSavedChanges((n) => n + 1);
  };

  const openRepo = (chosen: RepoSummary) => {
    setRepo(chosen);
    setScreen("pulls");
  };

  const openSettings = () => {
    if (screen !== "settings") setBack(screen);
    setScreen("settings");
  };

  const tab = (to: Exclude<Screen, "settings">, label: string) => (
    <Button
      variant={screen === to ? "default" : "ghost"}
      size="sm"
      aria-current={screen === to ? "page" : undefined}
      className="min-w-0 max-w-64 rounded-md text-xs"
      title={label}
      onClick={() => setScreen(to)}
    >
      <span className="truncate">{label}</span>
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-13 shrink-0 items-center gap-4 border-b bg-card px-5">
        <span className="flex shrink-0 items-center gap-2.5 text-sm font-semibold">
          {/* The mark: three diff rules, the first one in the accent. */}
          <span aria-hidden className="flex flex-col gap-[2px]">
            <span className="block h-[2px] w-3.5 rounded-sm bg-primary" />
            <span className="block h-[2px] w-2.5 rounded-sm bg-muted-foreground" />
            <span className="block h-[2px] w-3.5 rounded-sm bg-muted-foreground" />
          </span>
          Review Buddy
        </span>
        <nav className="flex min-w-0 items-center gap-0.5 rounded-lg border bg-secondary p-[3px]">
          {tab("repos", "Repositories")}
          {repo ? tab("pulls", repo.fullName) : null}
          {tab("review", reviewTab)}
        </nav>
        <PrForm onStart={startFromBar} blocked={blocked} />
        {startError ? (
          <span role="alert" className="min-w-0 truncate text-xs text-destructive">
            {startError}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto rounded-full text-xs font-normal"
          onClick={() => (screen === "settings" ? setScreen(back) : openSettings())}
        >
          {github === null
            ? "GitHub…"
            : github.signedIn
              ? `GitHub: @${github.login}`
              : "Connect GitHub"}
        </Button>
      </header>
      {blocked && screen !== "settings" ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-rb-focus-border bg-rb-focus-bg px-5 py-2.5 text-sm text-rb-focus-fg"
        >
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Reviews cannot run.</span> {blocked}
          </span>
          <Button size="sm" variant="outline" onClick={openSettings}>
            Claude Code settings
          </Button>
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-auto">
        <div hidden={screen !== "repos"}>
          <RepoList
            bridge={bridge.github}
            github={github}
            lastUsed={lastOpened?.pr.split("#")[0]}
            lastUsedJob={lastOpened?.id}
            onChoose={openRepo}
            onSignedOut={refreshGitHub}
            onOpenSettings={openSettings}
            onSample={() => {
              setView({ kind: "sample" });
              setScreen("review");
            }}
          />
        </div>
        <div hidden={screen !== "pulls"}>
          {repo ? (
            <PullList
              key={`${repo.fullName}:${savedChanges}`}
              bridge={bridge.github}
              repo={repo}
              jobs={jobs}
              blocked={blocked}
              onReview={(numbers, follow, fresh) =>
                startReviews(
                  numbers.map((n) => `${repo.fullName}#${n}`),
                  follow,
                  fresh,
                )
              }
              onOpenReview={(review) => {
                setView({ kind: "review", ...review });
                setScreen("review");
              }}
              onFollow={(id) => {
                setView({ kind: "job", id });
                setScreen("review");
              }}
              onStop={stopJob}
              onSignedOut={refreshGitHub}
              onOpenSettings={openSettings}
              onBack={() => setScreen("repos")}
            />
          ) : null}
        </div>
        {screen === "settings" ? (
          <GitHubSettings
            bridge={bridge.github}
            status={github}
            onStatus={setGitHub}
            onClose={() => setScreen(back)}
          >
            <ClaudeCodeSettings bridge={bridge.claude} status={claude} onStatus={setClaude} />
            <SavedReviews bridge={bridge.review} onDeleted={savedDeleted} />
            <LocalCopies bridge={bridge.review} />
          </GitHubSettings>
        ) : screen !== "review" ? null : job && job.state !== "done" ? (
          <RunPanel
            status={job}
            ahead={jobs.filter((j) => j.state === "queued" && j.id < job.id).length}
            onStop={() => stopJob(job.id)}
            onRetry={() => void startReviews([job.pr], true).then(setStartError)}
            retryBlocked={blocked}
            onDismiss={() => setView({ kind: "sample" })}
          />
        ) : (
          <div className="flex h-full flex-col">
            {view.kind === "review" && view.outdated ? (
              <div
                role="status"
                className="flex shrink-0 items-center gap-3 border-b border-rb-focus-border bg-rb-focus-bg px-5 py-2.5 text-sm text-rb-focus-fg"
              >
                <span className="min-w-0 flex-1">
                  This review is for an older commit: {view.pr} has new commits since.
                </span>
                <Button
                  size="sm"
                  disabled={!!blocked}
                  title={blocked}
                  onClick={() => void startReviews([view.pr], true)}
                >
                  Review again
                </Button>
              </div>
            ) : doneAt && reviewKey !== FIXTURE_REVIEW_KEY ? (
              // Done (US-17), and from there posting to GitHub (US-20).
              <DoneBar
                bridge={bridge.review}
                reviewKey={reviewKey}
                pr={reviewTab}
                doneAt={doneAt}
                github={github}
                onPosted={() => setSavedChanges((n) => n + 1)}
                onSignedOut={refreshGitHub}
              />
            ) : null}
            <div className="min-h-0 flex-1">
              {/* A new job remounts the viewer, even for the same PR head. */}
              <ReviewViewer key={`${reviewKey}:${view.kind === "job" ? view.id : 0}`} api={api} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
