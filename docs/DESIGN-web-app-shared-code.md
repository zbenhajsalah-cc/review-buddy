# Design: shared code for a Review Buddy web app

**Status:** analysis only, no code moved yet.

## Goal

Build a hosted **web app** that makes the same narrative review (Prologue +
risk-rated Chapters) without Claude Code:

1. The user signs in and connects GitHub (access token).
2. The app lists the user's repos, then the open PRs of a repo.
3. The user picks a PR. A Claude Agent SDK run reads the PR and produces the
   review (same agent contract as `submit_review`).
4. The same React viewer shows the result.

The Claude Code plugin and the standalone MCP mode must keep working exactly as
today. This document lists which code both products can share, which code must
be split first, and which code belongs to only one of them.

## Summary

| Bucket | Modules | Action |
|---|---|---|
| **Shared as-is** (pure, no I/O) | `types/review.ts`, `schemas/review.schema.json`, `server/diff.ts`, `server/resolve.ts`, `server/noise.ts`, `server/validate.ts`, most of `ui/src/**` | Move to a `core` package, keep tests with them |
| **Shared after a split** | `server/session.ts`, `server/git.ts`, `server/http.ts`, `ui/src/api.ts` + `session.ts`, `skills/review/SKILL.md` | Extract the pure part or put an interface in front of the I/O |
| **Plugin only** | `mcp/*`, `cli/index.ts`, `server/browser.ts`, `hooks/`, `bin/`, `.claude-plugin/`, `integrations/` | Leave alone |
| **Web only (new)** | auth, GitHub API client, repo/PR pages, agent runner, review storage, job progress | Build new |

The heart of the product, **`parseDiff` + `resolveReview`**, is already pure: it
takes a diff string, the agent JSON, PR metadata and meta, and returns a
`ResolvedReview`. It does not care where the diff came from. That is the main
reason this split is cheap.

## 1. Shared as-is

These modules have no file system, no `git`/`gh` process, no Bun-only API, and
no HTTP. They run the same in Bun, Node, or a worker.

| File | What it gives both apps |
|---|---|
| `src/types/review.ts` | Agent contract (`AgentReview`, `HunkAnchor`, …) and UI/server contract (`ResolvedReview`, …) |
| `schemas/review.schema.json` | Input schema of `submit_review`. The web agent's tool uses the same schema, so the model sees the same contract. |
| `src/server/diff.ts` | `parseDiff` (unified diff → files → hunks) and `languageOf` |
| `src/server/resolve.ts` | `resolveReview`: maps chapters + anchors onto real hunks, buckets unsorted and noise files, recomputes stats, returns warnings |
| `src/server/noise.ts` | `isNoiseFile` (lockfiles, images, …) |
| `src/server/validate.ts` | `validateAgentReview` (zod backstop) |
| Tests: `diff.test.ts`, `resolve.test.ts`, `noise.test.ts`, `validate.test.ts` | Move with their modules |

Small notes:

- `AgentReview.source` (`worktree` / `pr` / `branch` + `ref`) and `AgentReview.cwd`
  only matter for local capture. The web app knows the PR before the agent runs,
  so it ignores both. No contract change is needed.
- `PrMetadata.url` and `ciStatus` are already in the type ("phase 2"). The web
  app can fill them from the GitHub API on day one.

## 2. Shared after a split

### 2.1 `src/server/session.ts`: separate pure helpers from local orchestration

Today one file mixes four jobs: capture (git/gh), resolve, serve (`Bun.serve`),
and open the browser. Split it:

- **Pure, move to core:** `requestChangesMessage`, `resolutionNotesMessage`, and
  a `buildMeta({ generatedBy })` that takes the model name as an argument instead
  of reading `REVIEW_BUDDY_MODEL` from env.
- **Local only, stays:** `captureForSource`, `openReviewSession`, `uiDir`.

### 2.2 `src/server/git.ts`: put an interface in front of "where the bytes come from"

`git.ts` runs `git` and `gh` in the local repo. The web app has no local repo; it
has a GitHub token. Both need the same three things:

| Need | Local today (`git.ts`) | Web (GitHub REST) |
|---|---|---|
| Raw diff (source B) | `captureDiff` / `capturePrDiff` (`gh pr diff`) | `GET /repos/{o}/{r}/pulls/{n}` with `Accept: application/vnd.github.diff` |
| PR metadata (source B) | `capturePr` (`gh pr view --json …`) | `GET /repos/{o}/{r}/pulls/{n}` (JSON) |
| Merge base | `prBaseRef` (`git merge-base`) | `GET /repos/{o}/{r}/compare/{base}...{head}` → `merge_base_commit.sha` |
| Full file (source C) | `fileContent` (`git show` / worktree read) | `GET /repos/{o}/{r}/contents/{path}?ref={sha}` (raw media type) |

Proposed interface (core, types only):

```ts
interface ReviewDataSource {
  diff(): Promise<string>;
  pr(): Promise<PrMetadata>;
  /** "" = unavailable (same rule as fileContent today). */
  fileContent(path: string, side: "base" | "head"): Promise<string>;
}
```

- `LocalGitSource` wraps today's `git.ts` (worktree / branch / PR modes). No
  behavior change for the plugin.
- `GitHubApiSource` (web only) wraps REST calls with the user's token.

The security guards in `git.ts` (`assertSafeRef`, `assertPrRef`, symlink check)
protect local `git`/`gh` argv and the local disk. They stay with
`LocalGitSource`. The web source needs its own guards: URL-encode path segments,
and only allow paths that are in the review (same allowlist idea as `http.ts`).

Note: GitHub refuses the `.diff` media type for very large PRs. The web source
needs a fallback (for example the "list PR files" endpoint, whose per-file
`patch` can be joined back into a unified diff, but which is also truncated for
huge files). Large PRs must fail clearly, never render a partial diff as if it
were complete ("never fabricate changes").

### 2.3 `src/server/http.ts`: share the route logic, not the server

`http.ts` is built for **one review, one user, on loopback**: random port,
`Host` must be `127.0.0.1`/`localhost`, a per-server token in the URL, and a
`done` promise that unblocks the hook. None of that fits a hosted multi-user app.

What can be shared:

- The file-content **allowlist rule** ("only paths in this review's chapters").
  Extract `allowedPaths(review)` into core.
- The viewer **CSP** and safe JSON response headers. The viewer is fully
  self-contained, so the same CSP works on the web (add the app's own origin
  needs, nothing remote).

What stays local: `Bun.serve`, Host check, token check, `/api/done`
promise, placeholder HTML.

### 2.4 UI (`src/ui`): inject the data layer

About 90% of the UI is reusable: `Overview`, `ChapterReview`, `FileDiffCard`,
`DisplaySettingsBar`, `RiskBadge`, `Markdown` (its "no images" rule matters even
more on the web), `ShortcutsDialog`, `CopyMarkdownButton`, all of `lib/`
(`patch`, `expand`, `reviewMarkdown`, `reviewSchema`, `shortcuts`, …),
`settings.ts`, `workerPool.tsx`.

The coupling is in a few places only:

| Place | Coupling | Change |
|---|---|---|
| `api.ts` | Fixed paths `/api/review`, `/api/file-content`, `/api/config`, `/api/done`; token header | Define a `ReviewApi` interface; current code becomes `loopbackApi` |
| `session.ts` | Reads the token from `?token=` | Only used by `loopbackApi` |
| `lib/chapterFileSet.ts` | localStorage key = `rb.viewed.<token>` | Key by a `reviewKey` from context (token locally, review id on the web) |
| `FileDiffCard.tsx` | Imports `fetchFileContent` directly | Read it from context |
| `ChapterReview.tsx` | Imports `fetchConfig` / `postDone` directly | Read them from context. On the web, "Done" marks the review finished (later: post a GitHub review) instead of unblocking an agent |
| `App.tsx` | Loads one review on mount; two views | Becomes `<ReviewViewer api reviewKey />`; the web app wraps it with repo/PR pages and a router |

```ts
interface ReviewApi {
  reviewKey: string;
  getReview(): Promise<ResolvedReview>;
  getFileContent(path: string, side: "base" | "head"): Promise<FileContent>;
  getConfig(): Promise<{ roundtrip: boolean }>;
  done(result: DoneResult): Promise<void>;
}
```

The plugin then mounts `<ReviewViewer api={loopbackApi} />` and nothing changes
for the user. The plugin build stays a prebuilt `dist/` served by `http.ts`.

### 2.5 The prompt: `skills/review/SKILL.md`

The prompt has two parts:

- **Step 0 "Gather the diff"**: run `git diff` / `gh pr diff`, pick `source`,
  pass `cwd`. This is harness-specific.
- **Steps 1–3 + Critical rules**: how to analyze, write the Prologue, group
  Chapters by theme, use anchors, never reproduce lines. This is the product.

`scripts/gen-prompts.ts` already builds per-harness variants from
`integrations/prompt-template.md`. Add one more variant for the web agent, where
Step 0 becomes "the PR diff is below / call `get_pr_diff`" and there is no
`source` or `cwd`. CI's `verify:prompts-fresh` keeps all variants in sync.

## 3. Plugin only (do not touch)

`src/mcp/server.ts`, `src/mcp/standalone.ts`, `src/mcp/mode.ts`,
`src/cli/index.ts` (hook + `dev`), `src/server/browser.ts`, `hooks/hooks.json`,
`bin/review-buddy.js`, `.claude-plugin/`, `integrations/`, `examples/`.

## 4. Web only (new code)

- **Auth.** GitHub OAuth (or a GitHub App) for repo access. Store the token
  server-side only, never in the browser.
- **Repo and PR pages.** `GET /user/repos`, `GET /repos/{o}/{r}/pulls`.
- **Agent runner.** Claude Agent SDK `query()` with an **in-process MCP tool**
  `submit_review` that uses the same JSON schema. The tool handler runs
  `validateAgentReview` → `resolveReview`, stores the result, and returns the
  resolution notes to the agent (same as `additionalContext` today, so the agent
  can fix bad anchors in the same run). Give the agent read-only tools backed by
  `GitHubApiSource` (`get_pr_diff`, `read_file`), not a shell. Bonus: the agent
  and `resolveReview` read the **same** diff string, so anchors line up exactly.
- **Jobs and progress.** A review takes minutes. Run it as a background job and
  show progress; do not hold an HTTP request open.
- **Storage.** Persist `ResolvedReview` per (repo, PR, head SHA), so a reload or
  a second reviewer does not re-run the agent. Re-run when the head SHA changes.

### Open question: "sign in with Claude"

Check Anthropic's current terms before building this. The Agent SDK docs say
third-party apps should authenticate with an **API key**, and may not offer
claude.ai login or subscription limits without prior approval. The likely
shape: users sign in with GitHub; Claude calls use an API key (the app's key, or
a key each user/org provides).

## 5. Suggested order

Each step keeps the plugin green (`bun run verify`).

1. **Carve `src/core/`.** Move `types`, `diff`, `resolve`, `noise`, `validate`,
   the pure helpers from `session.ts`, and `allowedPaths` there, with their
   tests. Update imports. No behavior change.
2. **Inject the UI data layer.** Add `ReviewApi` + context, turn `App` into
   `ReviewViewer`, key local flags by `reviewKey`. Rebuild `dist/`. No behavior
   change.
3. **Add `ReviewDataSource`.** Wrap `git.ts` as `LocalGitSource`;
   `openReviewSession` uses it. No behavior change.
4. **Turn the repo into a workspace** (`packages/core`, `packages/viewer`,
   `apps/plugin`, `apps/web`) once a second consumer exists. Plugin paths in
   `plugin.json`, `hooks.json`, and `bin/` must be updated in the same change.
5. **Build `apps/web`:** GitHub auth → repo/PR pages → `GitHubApiSource` →
   agent runner → storage.
