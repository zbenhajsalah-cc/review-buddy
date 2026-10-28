import { Button, Card, CardContent, CardHeader, CardTitle } from "@review-buddy/viewer/ui";
import { type FormEvent, useEffect, useState } from "react";
import type { ReviewErrorKind, ReviewJobStatus, ReviewPhase } from "../../shared/ipc.ts";

/** The message of a rejected IPC call, without Electron's wrapper text. */
export function ipcErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/**
 * The top bar's "review this PR" box: any PR, by reference or URL. `blocked`
 * says why no review can run (no usable Claude Code, US-21).
 */
export function PrForm({
  onStart,
  blocked,
}: {
  onStart: (pr: string) => Promise<boolean>;
  blocked?: string;
}) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onStart(value.trim()).then((started) => {
      if (started) setValue("");
    });
  };
  return (
    <form className="flex min-w-0 items-center gap-2" onSubmit={submit}>
      <input
        aria-label="Pull request"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="owner/repo#123 or PR URL"
        className="h-8 w-72 min-w-0 rounded-md border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <Button type="submit" size="sm" disabled={value.trim() === "" || !!blocked} title={blocked}>
        Review
      </Button>
    </form>
  );
}

/** The phases of a review, in order, as the progress view lists them. */
export const PHASES: { phase: ReviewPhase; label: string; short: string }[] = [
  { phase: "github", label: "Load the PR from GitHub", short: "loading" },
  { phase: "reading", label: "Claude reads the diff and the files", short: "reading" },
  { phase: "writing", label: "Claude writes the chapters", short: "writing" },
  { phase: "checking", label: "Check the chapters against the diff", short: "checking" },
];

/** "0:07", "12:45", "1:02:03". */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The title of a failed review, by what failed. */
export function failureTitle(kind: ReviewErrorKind | undefined, pr: string): string {
  switch (kind) {
    case "github":
      return `Could not read ${pr} from GitHub`;
    case "too-large":
      return `${pr} is too large for the GitHub API, and the local copy failed`;
    case "claude":
      return `Claude could not review ${pr}`;
    case "stopped":
      return `The review of ${pr} was stopped`;
    default:
      return `Claude did not finish the review of ${pr}`;
  }
}

/** What to do about it, when there is more to say than the error. */
export function failureHint(kind: ReviewErrorKind | undefined): string | undefined {
  switch (kind) {
    case "github":
      return "Check the GitHub login in Settings, and that it can read this repository.";
    case "too-large":
      return "The app reads PRs this large with git, from a local copy of the repository. Fix what the error says (git installed, the network, access to the repository), then try again.";
    case "agent":
      return "Trying again often works. The steps show how far it got.";
    default:
      return undefined;
  }
}

/** The time now, updated every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** One review job that is not done: waiting, running, or why it failed. */
export function RunPanel({
  status,
  ahead,
  onStop,
  onRetry,
  onDismiss,
  retryBlocked,
}: {
  status: ReviewJobStatus;
  /** Jobs that start before this queued one. */
  ahead: number;
  onStop: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  /** Why Try again cannot run (no usable Claude Code, US-21). */
  retryBlocked?: string;
}) {
  const { state } = status;
  const now = useNow(state === "running");
  const time =
    status.startedAt !== undefined ? elapsed((status.endedAt ?? now) - status.startedAt) : "";
  const hint = failureHint(status.errorKind);
  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 break-words">
              {state === "running"
                ? `Reviewing ${status.pr}…`
                : state === "queued"
                  ? `${status.pr} is waiting`
                  : failureTitle(status.errorKind, status.pr)}
            </span>
            {time ? (
              <span className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground">
                {time}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {state === "running" ? (
            <Phases status={status} />
          ) : state === "queued" ? (
            <p className="text-muted-foreground">
              A few reviews run at a time.{" "}
              {ahead === 1 ? "1 review waits" : `${ahead} reviews wait`} before this one.
            </p>
          ) : (
            <>
              <p role="alert" className="whitespace-pre-wrap break-words text-destructive">
                {status.error}
              </p>
              {hint ? <p className="text-muted-foreground">{hint}</p> : null}
            </>
          )}
          {status.steps.length > 0 ? (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer select-none">
                All steps ({status.steps.length})
              </summary>
              <ol className="mt-2 space-y-0.5 pl-4">
                {status.steps.map((step, i) => (
                  // Steps only grow, so the index is stable.
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </details>
          ) : null}
          <div className="flex gap-2">
            {state === "running" ? (
              <Button variant="outline" onClick={onStop}>
                Stop
              </Button>
            ) : state === "queued" ? (
              <Button variant="outline" onClick={onStop}>
                Remove from the queue
              </Button>
            ) : (
              <>
                <Button onClick={onRetry} disabled={!!retryBlocked} title={retryBlocked}>
                  Try again
                </Button>
                <Button variant="outline" onClick={onDismiss}>
                  Show the sample review
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** The four phases: done, current (with its latest step), still to come. */
function Phases({ status }: { status: ReviewJobStatus }) {
  const current = PHASES.findIndex((p) => p.phase === (status.phase ?? "github"));
  const last = status.steps.at(-1);
  return (
    <ol aria-label="Progress" className="space-y-2">
      {PHASES.map(({ phase, label }, i) => (
        <li
          key={phase}
          aria-current={i === current ? "step" : undefined}
          className={
            i < current
              ? "text-muted-foreground"
              : i === current
                ? "font-medium"
                : "text-muted-foreground/60"
          }
        >
          <span aria-hidden className="inline-block w-5">
            {i < current ? "✓" : i === current ? "●" : "○"}
          </span>
          {label}
          {i === current && last ? (
            <div className="pl-5 text-xs font-normal text-muted-foreground">{last}…</div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
