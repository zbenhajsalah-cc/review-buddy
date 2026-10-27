import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@review-buddy/viewer/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GitHubBridge,
  GitHubListError,
  GitHubStatus,
  RepoPage,
  RepoSummary,
} from "../../shared/ipc.ts";
import { ipcErrorMessage } from "./ReviewRun.tsx";

/** Every word of the query is in the full name or the description. */
export function matchesQuery(repo: RepoSummary, query: string): boolean {
  const text = `${repo.fullName} ${repo.description ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/** The recently used repos first, then the rest (without them), both filtered. */
export function arrangeRepos(
  repos: RepoSummary[],
  recent: RepoSummary[],
  query: string,
): { recent: RepoSummary[]; others: RepoSummary[] } {
  const q = query.trim();
  const keep = (r: RepoSummary) => q === "" || matchesQuery(r, q);
  const recentNames = new Set(recent.map((r) => r.fullName.toLowerCase()));
  return {
    recent: recent.filter(keep),
    others: repos.filter((r) => !recentNames.has(r.fullName.toLowerCase()) && keep(r)),
  };
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 days ago", "yesterday", "just now". */
export function timeAgo(iso: string, now: number): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  if (!Number.isFinite(seconds)) return "";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; reason: GitHubListError["reason"]; error: string }
  | {
      kind: "ready";
      repos: RepoSummary[];
      recent: RepoSummary[];
      page: number;
      hasMore: boolean;
      /** Loading the next page, or why it failed. */
      more?: "loading" | { error: string };
    };

/**
 * The repositories of the GitHub login (US-13): recently used first, then
 * the rest by last push, with "Load more" and a search box over the loaded
 * ones. Picking one hands it to `onChoose`.
 */
export function RepoList({
  bridge,
  github,
  lastUsed,
  lastUsedJob,
  onChoose,
  onSignedOut,
  onOpenSettings,
  onSample,
}: {
  bridge: GitHubBridge;
  github: GitHubStatus | null;
  /** `owner/repo` a review opened last (also from the top bar), and that job's id. */
  lastUsed?: string;
  lastUsedJob?: number;
  onChoose: (repo: RepoSummary) => void;
  /** GitHub said the login is gone (token expired): refresh the status. */
  onSignedOut: () => void;
  onOpenSettings: () => void;
  onSample: () => void;
}) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  // Answers to older loads are dropped (a refresh, or another login).
  const loadId = useRef(0);

  const fetchPage = useCallback(
    (page: number): Promise<RepoPage | GitHubListError> =>
      bridge
        .repos(page)
        .catch(
          (e): GitHubListError => ({ ok: false, reason: "failed", error: ipcErrorMessage(e) }),
        ),
    [bridge],
  );

  // A ref, so a new callback from the parent does not reload the list.
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;
  const failed = useCallback((result: GitHubListError) => {
    setState({ kind: "error", reason: result.reason, error: result.error });
    if (result.reason !== "failed") signedOut.current();
  }, []);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setState({ kind: "loading" });
    const result = await fetchPage(1);
    if (id !== loadId.current) return;
    if (!result.ok) return failed(result);
    setState({
      kind: "ready",
      repos: result.repos,
      recent: result.recent ?? [],
      page: 1,
      hasMore: result.hasMore,
    });
  }, [fetchPage, failed]);

  const loadMore = async () => {
    if (state.kind !== "ready" || state.more === "loading") return;
    const id = loadId.current;
    setState({ ...state, more: "loading" });
    const result = await fetchPage(state.page + 1);
    if (id !== loadId.current) return;
    if (!result.ok) {
      if (result.reason !== "failed") return failed(result);
      return setState((s) => (s.kind === "ready" ? { ...s, more: { error: result.error } } : s));
    }
    setState((s) => {
      if (s.kind !== "ready") return s;
      // A push between two pages can move a repo onto the next page: no doubles.
      const seen = new Set(s.repos.map((r) => r.fullName));
      return {
        ...s,
        repos: [...s.repos, ...result.repos.filter((r) => !seen.has(r.fullName))],
        page: result.page,
        hasMore: result.hasMore,
        more: undefined,
      };
    });
  };

  const signedIn = github?.signedIn === true;
  const login = github?.login;
  // biome-ignore lint/correctness/useExhaustiveDependencies: another login reloads the list
  useEffect(() => {
    if (signedIn) void load();
    else loadId.current++; // drop answers for a login that is gone
  }, [signedIn, login, load]);

  // A review opened a repository that is not first in the recent list: read
  // that list again. The loaded pages stay.
  const current = useRef(state);
  current.current = state;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each job counts (a repository used again after another)
  useEffect(() => {
    const s = current.current;
    if (!signedIn || !lastUsed || s.kind !== "ready") return;
    if (s.recent[0]?.fullName.toLowerCase() === lastUsed.toLowerCase()) return;
    const id = loadId.current;
    void fetchPage(1).then((result) => {
      if (id !== loadId.current || !result.ok) return;
      setState((r) => (r.kind === "ready" ? { ...r, recent: result.recent ?? r.recent } : r));
    });
  }, [lastUsed, lastUsedJob, signedIn, fetchPage]);

  const choose = (repo: RepoSummary) => {
    void bridge.markRepoUsed(repo.fullName).catch(() => {});
    setState((s) =>
      s.kind === "ready"
        ? { ...s, recent: [repo, ...s.recent.filter((r) => r.fullName !== repo.fullName)] }
        : s,
    );
    onChoose(repo);
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Repositories</h1>
        {signedIn ? <span className="text-sm text-muted-foreground">@{login}</span> : null}
        {signedIn ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={state.kind === "loading"}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        ) : null}
      </div>
      {github === null ? (
        <p className="text-sm text-muted-foreground">Checking GitHub…</p>
      ) : !signedIn ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect GitHub to see your repositories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {state.kind === "error" && state.reason === "token-rejected" ? (
              <p role="alert" className="text-destructive">
                {state.error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={onOpenSettings}>Connect GitHub</Button>
              <Button variant="outline" onClick={onSample}>
                See the sample review
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : state.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading your repositories…</p>
      ) : state.kind === "error" ? (
        <Card>
          <CardContent className="space-y-4 text-sm">
            <p role="alert" className="text-destructive">
              {state.error}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void load()}>
                Try again
              </Button>
              {state.reason !== "failed" ? (
                <Button onClick={onOpenSettings}>Open GitHub settings</Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Repos state={state} query={query} onQuery={setQuery} onChoose={choose} onMore={loadMore} />
      )}
    </div>
  );
}

function Repos({
  state,
  query,
  onQuery,
  onChoose,
  onMore,
}: {
  state: Extract<ListState, { kind: "ready" }>;
  query: string;
  onQuery: (query: string) => void;
  onChoose: (repo: RepoSummary) => void;
  onMore: () => void;
}) {
  const { recent, others } = arrangeRepos(state.repos, state.recent, query);
  const now = Date.now();
  const searching = query.trim() !== "";
  const nothing = state.repos.length === 0 && state.recent.length === 0;
  return (
    <div className="space-y-4">
      <input
        type="search"
        aria-label="Search repositories"
        spellCheck={false}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search by name or description"
        className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {nothing ? (
        <p className="text-sm text-muted-foreground">
          No repositories. A fine-grained token sees only the repositories it was given access to.
        </p>
      ) : recent.length === 0 && others.length === 0 ? (
        <p className="text-sm text-muted-foreground">No loaded repository matches “{query}”.</p>
      ) : null}
      {recent.length > 0 ? (
        <RepoSection title="Recently used" repos={recent} now={now} onChoose={onChoose} />
      ) : null}
      {others.length > 0 ? (
        <RepoSection
          title={recent.length > 0 ? "All repositories" : undefined}
          repos={others}
          now={now}
          onChoose={onChoose}
        />
      ) : null}
      {state.hasMore ? (
        <div className="flex items-center gap-3 text-sm">
          <Button variant="outline" disabled={state.more === "loading"} onClick={onMore}>
            {state.more === "loading" ? "Loading…" : "Load more"}
          </Button>
          {searching ? (
            <span className="text-muted-foreground">
              The search covers the {state.repos.length} repositories loaded so far.
            </span>
          ) : null}
          {typeof state.more === "object" ? (
            <span role="alert" className="text-destructive">
              {state.more.error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RepoSection({
  title,
  repos,
  now,
  onChoose,
}: {
  title?: string;
  repos: RepoSummary[];
  now: number;
  onChoose: (repo: RepoSummary) => void;
}) {
  const list = (
    <ul className="divide-y rounded-md border">
      {repos.map((repo) => (
        <li key={repo.fullName}>
          <button
            type="button"
            onClick={() => onChoose(repo)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                <span className="text-muted-foreground">{repo.owner}/</span>
                <span className="font-medium">{repo.name}</span>
              </span>
              {repo.description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {repo.description}
                </span>
              ) : null}
            </span>
            {repo.private ? <Badge variant="outline">Private</Badge> : null}
            {repo.fork ? <Badge variant="outline">Fork</Badge> : null}
            {repo.archived ? <Badge variant="secondary">Archived</Badge> : null}
            <span className="w-32 shrink-0 text-right text-xs text-muted-foreground">
              {repo.pushedAt ? `pushed ${timeAgo(repo.pushedAt, now)}` : "no pushes"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
  if (!title) return list;
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {list}
    </section>
  );
}
