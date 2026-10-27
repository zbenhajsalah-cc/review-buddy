import { Button, Card, CardContent, CardHeader, CardTitle } from "@review-buddy/viewer/ui";
import type { FormEvent, Ref } from "react";
import type { ReviewRunStatus } from "../../shared/ipc.ts";

/** The message of a rejected IPC call, without Electron's wrapper text. */
export function ipcErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/**
 * The top bar's "review this PR" box (until the PR list screen, US-14).
 * Picking a repository fills in `owner/repo#`.
 */
export function PrForm({
  value,
  onValue,
  inputRef,
  running,
  onStart,
}: {
  value: string;
  onValue: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  running: boolean;
  onStart: (pr: string) => Promise<void>;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onStart(value.trim());
  };
  return (
    <form className="flex min-w-0 items-center gap-2" onSubmit={submit}>
      <input
        ref={inputRef}
        aria-label="Pull request"
        spellCheck={false}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder="owner/repo#123 or PR URL"
        className="h-8 w-72 min-w-0 rounded-md border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <Button type="submit" size="sm" disabled={running || value.trim() === ""}>
        Review
      </Button>
    </form>
  );
}

/** A running review's progress, or why it failed. */
export function RunPanel({
  status,
  onStop,
  onDismiss,
}: {
  status: ReviewRunStatus;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const running = status.state === "running";
  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            {running ? `Reviewing ${status.pr}…` : `The review of ${status.pr} failed`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {running ? (
            <ol aria-label="Progress" className="space-y-1">
              {(status.steps.length ? status.steps : ["Opening the PR"]).map((step, i, all) => (
                <li
                  // Steps only grow, so the index is stable.
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
                  key={i}
                  className={i === all.length - 1 ? "font-medium" : "text-muted-foreground"}
                >
                  {step}
                  {i === all.length - 1 ? "…" : ""}
                </li>
              ))}
            </ol>
          ) : (
            <p role="alert" className="whitespace-pre-wrap break-words text-destructive">
              {status.error}
            </p>
          )}
          {running ? (
            <Button variant="outline" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button variant="outline" onClick={onDismiss}>
              Show the sample review
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
