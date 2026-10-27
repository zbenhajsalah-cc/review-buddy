import { ReviewViewer } from "@review-buddy/viewer";
import { Button } from "@review-buddy/viewer/ui";
import { useEffect, useMemo, useState } from "react";
import { type DesktopBridge, FIXTURE_REVIEW_KEY, type GitHubStatus } from "../../shared/ipc.ts";
import { GitHubSettings } from "./GitHubSettings.tsx";
import { ipcReviewApi } from "./ipc-review-api.ts";

/**
 * The app shell: a thin bar above the current screen. The viewer is unmounted
 * while the settings are open, so its keyboard shortcuts never see typing in
 * the settings form.
 */
export function App({ bridge }: { bridge: DesktopBridge }) {
  const [screen, setScreen] = useState<"review" | "settings">("review");
  const [github, setGitHub] = useState<GitHubStatus | null>(null);
  const api = useMemo(() => ipcReviewApi(bridge.review, FIXTURE_REVIEW_KEY), [bridge]);

  useEffect(() => {
    bridge.github.status().then(setGitHub, () => {});
  }, [bridge]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-semibold">Review Buddy</span>
        <Button
          variant="ghost"
          size="sm"
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
        ) : (
          <ReviewViewer api={api} />
        )}
      </main>
    </div>
  );
}
