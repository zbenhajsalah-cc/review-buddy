import { Button, Card, CardContent, CardHeader, CardTitle } from "@review-buddy/viewer/ui";
import { type FormEvent, useState } from "react";
import type { ReviewJobStatus } from "../../shared/ipc.ts";

/** The message of a rejected IPC call, without Electron's wrapper text. */
export function ipcErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** The top bar's "review this PR" box: any PR, by reference or URL. */
export function PrForm({ onStart }: { onStart: (pr: string) => Promise<boolean> }) {
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
      <Button type="submit" size="sm" disabled={value.trim() === ""}>
        Review
      </Button>
    </form>
  );
}

/** One review job that is not done: waiting, running, or why it failed. */
export function RunPanel({
  status,
  ahead,
  onStop,
  onDismiss,
}: {
  status: ReviewJobStatus;
  /** Jobs that run before this queued one. */
  ahead: number;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const { state } = status;
  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            {state === "running"
              ? `Reviewing ${status.pr}…`
              : state === "queued"
                ? `${status.pr} is waiting`
                : `The review of ${status.pr} failed`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {state === "running" ? (
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
          ) : state === "queued" ? (
            <p className="text-muted-foreground">
              Reviews run one at a time. {ahead === 1 ? "1 review runs" : `${ahead} reviews run`}{" "}
              before this one.
            </p>
          ) : (
            <p role="alert" className="whitespace-pre-wrap break-words text-destructive">
              {status.error}
            </p>
          )}
          {state === "running" ? (
            <Button variant="outline" onClick={onStop}>
              Stop
            </Button>
          ) : state === "queued" ? (
            <Button variant="outline" onClick={onStop}>
              Remove from the queue
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
