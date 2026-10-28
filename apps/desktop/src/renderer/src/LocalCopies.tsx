import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@review-buddy/viewer/ui";
import { useEffect, useState } from "react";
import type { CloneInfo, ReviewBridge } from "../../shared/ipc.ts";
import { timeAgo } from "./RepoList.tsx";
import { ipcErrorMessage } from "./ReviewRun.tsx";
import { formatBytes } from "./SavedReviews.tsx";

/**
 * Settings: the local copies of repositories (US-19), made with git for PRs
 * too large for GitHub's diff API. Each with its disk use, Delete, and Delete
 * all. A copy a review is reading cannot be deleted.
 */
export function LocalCopies({ bridge }: { bridge: ReviewBridge }) {
  const [list, setList] = useState<CloneInfo[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bridge.clones().then(setList, (e) => setError(ipcErrorMessage(e)));
  }, [bridge]);

  const run = async (step: () => Promise<CloneInfo[]>) => {
    setBusy(true);
    setError(undefined);
    try {
      setList(await step());
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const total = (list ?? []).reduce((n, c) => n + c.bytes, 0);
  const now = Date.now();
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Local copies of repositories</CardTitle>
        <CardDescription>
          GitHub does not send the diff of a very large PR (over 300 files or 20,000 lines). The app
          then gets it with git, from a small copy of the repository kept here: only the commits it
          reviewed, with file contents fetched as needed. Deleting a copy is safe; the next large
          review fetches again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {list === null ? (
          error ? null : (
            <p className="text-muted-foreground">Loading…</p>
          )
        ) : list.length === 0 ? (
          <p className="text-muted-foreground">No local copies.</p>
        ) : (
          <>
            <ul aria-label="Local copies" className="divide-y rounded-md border">
              {list.map((c) => (
                <li key={c.repo} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.repo}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(c.bytes)} · used {timeAgo(c.usedAt, now)}
                      {c.inUse ? " · in use by a review" : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || c.inUse}
                    aria-label={`Delete the local copy of ${c.repo}`}
                    onClick={() => void run(() => bridge.deleteClone(c.repo))}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label="Delete all local copies"
                onClick={() => void run(() => bridge.deleteAllClones())}
              >
                Delete all
              </Button>
              <span className="text-muted-foreground">{formatBytes(total)} in all</span>
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
