import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from "@review-buddy/viewer/ui";
import { type FormEvent, type ReactNode, useState } from "react";
import type { GitHubBridge, GitHubStatus } from "../../shared/ipc.ts";

const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

/**
 * Settings: the GitHub login in use, sign out, or sign in (GitHub CLI, or a
 * pasted token). The token goes to main and is never sent back.
 */
export function GitHubSettings({
  bridge,
  status,
  onStatus,
  onClose,
  children,
}: {
  bridge: GitHubBridge;
  status: GitHubStatus | null;
  onStatus: (status: GitHubStatus) => void;
  onClose: () => void;
  /** More settings, below the GitHub card. */
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(status?.error);
  const [token, setToken] = useState("");

  const run = async (step: () => Promise<GitHubStatus>) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await step();
      onStatus(next);
      setError(next.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = token;
    setToken(""); // do not keep the token in the page
    void run(() => bridge.signInWithToken(value));
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>GitHub</CardTitle>
          <CardDescription>Used to list your repositories and pull requests.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {status === null ? (
            <p className="text-muted-foreground">Checking GitHub…</p>
          ) : status.signedIn ? (
            <>
              <p>
                Signed in as <span className="font-semibold">@{status.login}</span>
                {status.name ? (
                  <span className="text-muted-foreground"> ({status.name})</span>
                ) : null}
              </p>
              <p className="text-muted-foreground">{sourceText(status)}</p>
              <Button variant="outline" disabled={busy} onClick={() => run(bridge.signOut)}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">Not connected.</p>
              {status.ghInstalled ? (
                <div className="space-y-2">
                  <Button variant="outline" disabled={busy} onClick={() => run(bridge.useGh)}>
                    Use the GitHub CLI login
                  </Button>
                  <p className="text-muted-foreground">
                    Uses the account of <code className="font-mono text-xs">gh auth login</code>.
                  </p>
                </div>
              ) : null}
              <form className="space-y-2" onSubmit={submit}>
                <Label htmlFor="github-token">Personal access token</Label>
                <div className="flex gap-2">
                  <input
                    id="github-token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="github_pat_…"
                    className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                  <Button type="submit" disabled={busy || token.trim() === ""}>
                    Sign in
                  </Button>
                </div>
                <p className="text-muted-foreground">
                  <a
                    href={NEW_TOKEN_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    Create a fine-grained token
                  </a>{" "}
                  with read access to Contents, Pull requests and Metadata (Pull requests: read and
                  write, to post your reviews).{" "}
                  {status.tokenStorage === "encrypted"
                    ? "It is saved encrypted by your OS keychain."
                    : "No OS keychain is available, so it is kept for this run only."}
                </p>
              </form>
            </>
          )}
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {children}
    </div>
  );
}

function sourceText(status: GitHubStatus): string {
  if (status.source === "gh") {
    return "From the GitHub CLI (gh). The app asks gh for the token at start and keeps it in memory only. Signing out here does not log out gh.";
  }
  return status.tokenStorage === "encrypted"
    ? "With the token you pasted, saved encrypted by your OS keychain."
    : "With the token you pasted, kept for this run only (no OS keychain is available).";
}
