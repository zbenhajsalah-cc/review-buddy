import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@review-buddy/viewer/ui";
import { useEffect, useState } from "react";
import {
  CLAUDE_CODE_INSTALL_URL,
  type ClaudeBridge,
  type ClaudeCodeStatus,
} from "../../shared/ipc.ts";
import { ModelChoiceFields, type useModels } from "./ModelPicker.tsx";
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
  models,
}: {
  bridge: ClaudeBridge;
  status: ClaudeCodeStatus | null;
  onStatus: (status: ClaudeCodeStatus) => void;
  /** The model list and the default choice (US-22), loaded by the app shell. */
  models: ReturnType<typeof useModels>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // The model list is asked for when this card is first shown (US-22).
  const { ensure } = models;
  useEffect(ensure, [ensure]);

  /**
   * Runs one Claude Code step. `another` says the binary may have changed, so
   * the model list is asked for again: another Claude Code may offer other
   * models, and main has already forgotten its own list.
   */
  const run = async (step: () => Promise<ClaudeCodeStatus>, another = false) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await step();
      onStatus(next);
      // Only when it really is another binary (Choose… may be cancelled).
      if (another && next.path !== status?.path) models.reload();
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
          <Button variant="outline" disabled={busy} onClick={() => run(bridge.choose, true)}>
            Choose…
          </Button>
          {status?.chosen ? (
            <Button variant="ghost" disabled={busy} onClick={() => run(bridge.search, true)}>
              Search for it instead
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <div className="space-y-3 border-t pt-4">
          <div>
            <p className="font-medium">Model and thinking</p>
            <p className="text-muted-foreground">
              What reviews run on, unless a review is started with another choice. "Claude Code's
              default" is Claude Code's own, not what you set in the CLI: reviews read none of your
              settings files.
            </p>
          </div>
          <ModelChoiceFields
            models={models.models}
            value={models.choice}
            onChange={models.setChoice}
            disabled={models.loading}
            defaultModelLabel={
              models.defaultModel
                ? `Claude Code's default (${models.defaultModel.displayName})`
                : "Claude Code's default"
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={models.busy}
              onClick={models.reload}
              title="Ask your Claude Code which models this account can use"
            >
              {models.busy ? "Asking Claude…" : "Refresh models"}
            </Button>
            {models.fallback && !models.busy ? (
              <span className="min-w-0 text-muted-foreground">
                Claude Code could not list the models
                {models.fallbackError ? `: ${models.fallbackError}` : "."} These are the usual
                names; a model this account does not have fails when a review starts.
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
