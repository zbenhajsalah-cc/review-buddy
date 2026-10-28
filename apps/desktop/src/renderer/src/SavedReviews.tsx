import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@review-buddy/viewer/ui";
import { useEffect, useState } from "react";
import type { ReviewBridge, SavedReviewInfo } from "../../shared/ipc.ts";
import { postedLabel } from "./PostReview.tsx";
import { timeAgo } from "./RepoList.tsx";
import { ipcErrorMessage } from "./ReviewRun.tsx";

/** "820 B", "14 KB", "2.3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Settings: the reviews saved on disk (US-16), newest first, each with
 * Delete, and Delete all (asked twice). `onDeleted` gets the deleted keys.
 */
export function SavedReviews({
  bridge,
  onDeleted,
}: {
  bridge: ReviewBridge;
  onDeleted: (deleted: string[]) => void;
}) {
  const [list, setList] = useState<SavedReviewInfo[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bridge.saved().then(setList, (e) => setError(ipcErrorMessage(e)));
  }, [bridge]);

  const run = async (step: () => Promise<SavedReviewInfo[]>, deleted: string[]) => {
    setBusy(true);
    setError(undefined);
    try {
      setList(await step());
      onDeleted(deleted);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  const total = (list ?? []).reduce((n, r) => n + r.bytes, 0);
  const now = Date.now();
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Saved reviews</CardTitle>
        <CardDescription>
          Finished reviews are kept on this computer, so opening a PR again needs no new run. A
          review is for one commit: after new commits, the PR list offers to review again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {list === null ? (
          error ? null : (
            <p className="text-muted-foreground">Loading…</p>
          )
        ) : list.length === 0 ? (
          <p className="text-muted-foreground">No saved reviews.</p>
        ) : (
          <>
            <ul aria-label="Saved reviews" className="divide-y rounded-md border">
              {list.map((r) => (
                <li key={r.reviewKey} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="font-medium">{r.pr}</span>{" "}
                      <span className="text-muted-foreground">{r.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      commit <code className="font-mono">{r.headSha.slice(0, 7)}</code> · saved{" "}
                      {timeAgo(r.savedAt, now)} · {formatBytes(r.bytes)}
                      {r.doneAt ? ` · done ${timeAgo(r.doneAt, now)}` : ""}
                      {r.posted
                        ? ` · ${postedLabel(r.posted.verdict).toLowerCase()} on GitHub`
                        : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Delete the saved review of ${r.pr} at ${r.headSha.slice(0, 7)}`}
                    onClick={() => void run(() => bridge.deleteSaved(r.reviewKey), [r.reviewKey])}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              {confirmAll ? (
                <>
                  <span>
                    Delete all {list.length} saved review{list.length === 1 ? "" : "s"}?
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => bridge.deleteAllSaved(),
                        list.map((r) => r.reviewKey),
                      )
                    }
                  >
                    Yes, delete all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmAll(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmAll(true)}
                  >
                    Delete all
                  </Button>
                  <span className="text-muted-foreground">{formatBytes(total)} in all</span>
                </>
              )}
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
