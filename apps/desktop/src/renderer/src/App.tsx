import { ReviewViewer } from "@review-buddy/viewer";
import { Button } from "@review-buddy/viewer/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type DesktopBridge,
  FIXTURE_REVIEW_KEY,
  type GitHubStatus,
  type RepoSummary,
  type ReviewJobStatus,
} from "../../shared/ipc.ts";
import { GitHubSettings } from "./GitHubSettings.tsx";
import { ipcReviewApi } from "./ipc-review-api.ts";
import { PullList } from "./PullList.tsx";
import { RepoList } from "./RepoList.tsx";
import { ipcErrorMessage, PrForm, RunPanel } from "./ReviewRun.tsx";

const POLL_MS = 700;

type Screen = "repos" | "pulls" | "review" | "settings";

/** What the review tab shows. */
type View =
  | { kind: "sample" }
  /** A job: its progress, its failure, or its review once done. */
  | { kind: "job"; id: number }
  /** A review opened from the PR list. */
  | { kind: "review"; reviewKey: string; pr: string };

const isActive = (job: ReviewJobStatus) => job.state === "queued" || job.state === "running";

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
  const [jobs, setJobs] = useState<ReviewJobStatus[]>([]);
  const [view, setView] = useState<View>({ kind: "sample" });
  const [startError, setStartError] = useState<string | undefined>();

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

  const busy = jobs.some(isActive);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      bridge.review.jobs().then(setJobs, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bridge, busy]);

  const job = view.kind === "job" ? jobs.find((j) => j.id === view.id) : undefined;
  const reviewKey =
    view.kind === "review"
      ? view.reviewKey
      : job?.state === "done"
        ? job.reviewKey!
        : FIXTURE_REVIEW_KEY;
  const api = useMemo(() => ipcReviewApi(bridge.review, reviewKey), [bridge, reviewKey]);
  const reviewTab = view.kind === "review" ? view.pr : (job?.pr ?? "Sample review");

  /** Queues reviews; `follow` shows the first one. Resolves with the errors, if any. */
  const startReviews = async (prs: string[], follow: boolean) => {
    const errors: string[] = [];
    let first: ReviewJobStatus | undefined;
    for (const pr of prs) {
      try {
        const started = await bridge.review.start(pr);
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
      variant={screen === to ? "secondary" : "ghost"}
      size="sm"
      aria-current={screen === to ? "page" : undefined}
      className="max-w-56 min-w-0 truncate"
      onClick={() => setScreen(to)}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b px-4">
        <span className="shrink-0 text-sm font-semibold">Review Buddy</span>
        <nav className="flex min-w-0 items-center gap-1">
          {tab("repos", "Repositories")}
          {repo ? tab("pulls", repo.fullName) : null}
          {tab("review", reviewTab)}
        </nav>
        <PrForm onStart={startFromBar} />
        {startError ? (
          <span role="alert" className="min-w-0 truncate text-xs text-destructive">
            {startError}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => (screen === "settings" ? setScreen(back) : openSettings())}
        >
          {github === null
            ? "GitHub…"
            : github.signedIn
              ? `GitHub: @${github.login}`
              : "Connect GitHub"}
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <div hidden={screen !== "repos"}>
          <RepoList
            bridge={bridge.github}
            github={github}
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
              key={repo.fullName}
              bridge={bridge.github}
              repo={repo}
              jobs={jobs}
              onReview={(numbers, follow) =>
                startReviews(
                  numbers.map((n) => `${repo.fullName}#${n}`),
                  follow,
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
          />
        ) : screen !== "review" ? null : job && job.state !== "done" ? (
          <RunPanel
            status={job}
            ahead={jobs.filter((j) => isActive(j) && j.id < job.id).length}
            onStop={() => stopJob(job.id)}
            onDismiss={() => setView({ kind: "sample" })}
          />
        ) : (
          // A new job remounts the viewer, even for the same PR head.
          <ReviewViewer key={`${reviewKey}:${view.kind === "job" ? view.id : 0}`} api={api} />
        )}
      </main>
    </div>
  );
}
