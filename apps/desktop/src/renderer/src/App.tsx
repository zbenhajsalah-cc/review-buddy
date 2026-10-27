import { ReviewViewer } from "@review-buddy/viewer";
import { Button } from "@review-buddy/viewer/ui";
import { useEffect, useMemo, useState } from "react";
import {
  type DesktopBridge,
  FIXTURE_REVIEW_KEY,
  type GitHubStatus,
  type ReviewRunStatus,
} from "../../shared/ipc.ts";
import { GitHubSettings } from "./GitHubSettings.tsx";
import { ipcReviewApi } from "./ipc-review-api.ts";
import { ipcErrorMessage, PrForm, RunPanel } from "./ReviewRun.tsx";

const POLL_MS = 700;

/**
 * The app shell: a thin bar above the current screen. The viewer is unmounted
 * while the settings are open, so its keyboard shortcuts never see typing in
 * the settings form.
 *
 * Until the PR screens exist (US-13/14), the bar takes a PR to review; the
 * sample review shows when no review has run.
 */
export function App({ bridge }: { bridge: DesktopBridge }) {
  const [screen, setScreen] = useState<"review" | "settings">("review");
  const [github, setGitHub] = useState<GitHubStatus | null>(null);
  const [run, setRun] = useState<ReviewRunStatus | null>(null);
  const [startError, setStartError] = useState<string | undefined>();
  // The run whose result (or failure) was set aside for the sample review.
  const [dismissed, setDismissed] = useState(0);

  useEffect(() => {
    bridge.github.status().then(setGitHub, () => {});
    bridge.review.runStatus().then(setRun, () => {});
  }, [bridge]);

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

  const start = async (pr: string) => {
    setStartError(undefined);
    try {
      setRun(await bridge.review.start(pr));
      setScreen("review");
    } catch (e) {
      setStartError(ipcErrorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b px-4">
        <span className="text-sm font-semibold">Review Buddy</span>
        <PrForm running={running} onStart={start} />
        {startError ? (
          <span role="alert" className="min-w-0 truncate text-xs text-destructive">
            {startError}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setScreen(screen === "settings" ? "review" : "settings")}
        >
          {github === null
            ? "GitHub…"
            : github.signedIn
              ? `GitHub: @${github.login}`
              : "Connect GitHub"}
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        {screen === "settings" ? (
          <GitHubSettings
            bridge={bridge.github}
            status={github}
            onStatus={setGitHub}
            onClose={() => setScreen("review")}
          />
        ) : current && current.state !== "done" ? (
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
