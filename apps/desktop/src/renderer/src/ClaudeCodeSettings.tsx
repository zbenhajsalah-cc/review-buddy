import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@review-buddy/viewer/ui";
import { useState } from "react";
import {
  CLAUDE_CODE_INSTALL_URL,
  type ClaudeBridge,
  type ClaudeCodeStatus,
} from "../../shared/ipc.ts";
import { ipcErrorMessage } from "./ReviewRun.tsx";

/**
 * Why reviews cannot run Claude Code, or undefined if they can (or the first
 * check is not back yet: main checks again before each review anyway).
 */
export function claudeBlocked(status: ClaudeCodeStatus | null): string | undefined {
  if (!status || status.state === "ok") return undefined;
  return status.message ?? "Claude Code cannot run. See Settings.";
}

/** The card's title for a status. */
export function claudeTitle(status: ClaudeCodeStatus): string {
  switch (status.state) {
    case "ok":
      return `Claude Code ${status.version}`;
    case "missing":
      return status.chosen ? "The chosen Claude Code is gone" : "Claude Code not found";
    case "too-old":
      return `Claude Code ${status.version} is too old`;
    case "broken":
      return "Claude Code does not answer";
  }
}

/**
 * Settings: the installed Claude Code the reviews run (US-21): where it is,
 * its version, Check again, and Choose… for one the app does not find.
 */
export function ClaudeCodeSettings({
  bridge,
  status,
  onStatus,
}: {
  bridge: ClaudeBridge;
  status: ClaudeCodeStatus | null;
  onStatus: (status: ClaudeCodeStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = async (step: () => Promise<ClaudeCodeStatus>) => {
    setBusy(true);
    setError(undefined);
    try {
      onStatus(await step());
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Claude Code</CardTitle>
        <CardDescription>
          Reviews run your own Claude Code, with your Claude login.
          {status ? ` It needs version ${status.minVersion} or newer.` : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {status === null ? (
          <p className="text-muted-foreground">Looking for Claude Code…</p>
        ) : (
          <div role="status" aria-label="Claude Code status" className="space-y-1">
            <p className={status.state === "ok" ? "font-medium" : "font-medium text-destructive"}>
              {status.state === "ok" ? "✓ " : null}
              {claudeTitle(status)}
            </p>
            {status.path ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {status.path}
                {status.chosen ? " (chosen)" : ""}
              </p>
            ) : null}
            {status.message ? <p className="break-words">{status.message}</p> : null}
            {status.state === "missing" && !status.chosen ? (
              <p>
                <a
                  href={CLAUDE_CODE_INSTALL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  How to install Claude Code
                </a>
              </p>
            ) : null}
            {status.searched?.length ? (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer select-none">Where the app looked</summary>
                <ul className="mt-1 space-y-0.5 break-all font-mono text-xs">
                  {status.searched.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => run(bridge.check)}>
            Check again
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run(bridge.choose)}>
            Choose…
          </Button>
          {status?.chosen ? (
            <Button variant="ghost" disabled={busy} onClick={() => run(bridge.search)}>
              Search for it instead
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
