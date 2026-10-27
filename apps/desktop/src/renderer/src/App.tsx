import { ReviewViewer } from "@review-buddy/viewer";
import { Button } from "@review-buddy/viewer/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DesktopBridge,
  FIXTURE_REVIEW_KEY,
  type GitHubStatus,
  type RepoSummary,
  type ReviewRunStatus,
} from "../../shared/ipc.ts";
import { GitHubSettings } from "./GitHubSettings.tsx";
import { ipcReviewApi } from "./ipc-review-api.ts";
import { RepoList } from "./RepoList.tsx";
import { ipcErrorMessage, PrForm, RunPanel } from "./ReviewRun.tsx";

const POLL_MS = 700;

type Screen = "repos" | "review" | "settings";

/**
 * The app shell: a thin bar above the current screen. The app opens on the
 * repository list (US-13); "review" shows the current run or review, or the
 * sample review when none has run. The viewer is unmounted on the other
 * screens, so its keyboard shortcuts never see typing in their forms. The
 * repository list stays mounted (hidden), so it keeps its loaded pages.
 *
 * Until the PR list exists (US-14), picking a repository fills the bar's PR
 * box with `owner/repo#`.
 */
export function App({ bridge }: { bridge: DesktopBridge }) {
  const [screen, setScreen] = useState<Screen>("repos");
  // Where the settings' "Back" goes.
  const [back, setBack] = useState<Exclude<Screen, "settings">>("repos");
  const [github, setGitHub] = useState<GitHubStatus | null>(null);
  const [run, setRun] = useState<ReviewRunStatus | null>(null);
  const [startError, setStartError] = useState<string | undefined>();
  const [pr, setPr] = useState("");
  const prInput = useRef<HTMLInputElement>(null);
  // The run whose result (or failure) was set aside for the sample review.
  const [dismissed, setDismissed] = useState(0);

  const refreshGitHub = useCallback(() => {
    bridge.github.status().then(setGitHub, () => {});
  }, [bridge]);

  useEffect(() => {
    refreshGitHub();
    bridge.review.runStatus().then(setRun, () => {});
  }, [bridge, refreshGitHub]);

  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      bridge.review.runStatus().then(setRun, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bridge, running]);

  const current = run && run.run > dismissed && run.state !== "idle" ? run : null;
  const reviewKey = current?.state === "done" ? current.reviewKey! : FIXTURE_REVIEW_KEY;
  const api = useMemo(() => ipcReviewApi(bridge.review, reviewKey), [bridge, reviewKey]);

  const start = async (value: string) => {
    setStartError(undefined);
    try {
      setRun(await bridge.review.start(value));
      setScreen("review");
    } catch (e) {
      setStartError(ipcErrorMessage(e));
    }
  };

  const chooseRepo = (repo: RepoSummary) => {
    const value = `${repo.fullName}#`;
    setPr(value);
    setStartError(undefined);
    requestAnimationFrame(() => {
      prInput.current?.focus();
      prInput.current?.setSelectionRange(value.length, value.length);
    });
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
      onClick={() => setScreen(to)}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b px-4">
        <span className="text-sm font-semibold">Review Buddy</span>
        <nav className="flex items-center gap-1">
          {tab("repos", "Repositories")}
          {tab("review", current?.pr ?? "Sample review")}
        </nav>
        <PrForm value={pr} onValue={setPr} inputRef={prInput} running={running} onStart={start} />
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
            onChoose={chooseRepo}
            onSignedOut={refreshGitHub}
            onOpenSettings={openSettings}
            onSample={() => setScreen("review")}
          />
        </div>
        {screen === "settings" ? (
          <GitHubSettings
            bridge={bridge.github}
            status={github}
            onStatus={setGitHub}
            onClose={() => setScreen(back)}
          />
        ) : screen !== "review" ? null : current && current.state !== "done" ? (
          <RunPanel
            status={current}
            onStop={() => bridge.review.stop().then(setRun, () => {})}
            onDismiss={() => setDismissed(current.run)}
          />
        ) : (
          // A new run remounts the viewer, even for the same PR head.
          <ReviewViewer key={`${reviewKey}:${current?.run ?? 0}`} api={api} />
        )}
      </main>
    </div>
  );
}
