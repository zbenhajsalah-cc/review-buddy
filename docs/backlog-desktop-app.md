# Backlog: pnpm monorepo + Electron desktop app

User stories for the plan in `DESIGN-desktop-app-shared-code.md`. Do them in
order: each one depends on the stories listed in "Depends on".

**Rules for every story**

- `verify:ci` is green at the end of the story.
- The Claude Code plugin and the standalone MCP mode behave exactly as before,
  unless the story says otherwise.
- One story = one PR (or one commit series) that can be reviewed alone.

**Roles:** *plugin user* = someone using `/review` in Claude Code or the MCP
server in Cursor / Copilot / Codex. *Desktop user* = you, using the Electron
app. *Maintainer* = you, working on the code.

**Sizes:** S = under half a day, M = about a day, L = several days.

## Overview

| # | Story | Epic | Size | Depends on |
|---|---|---|---|---|
| 01 | pnpm workspace | A. Monorepo | S | — |
| 02 | `packages/core` with the pure review logic | A. Monorepo | M | 01 |
| 03 | `ReviewDataSource` + git capture in core | A. Monorepo | M | 02 |
| 04 | Bundled plugin entry points | A. Monorepo | M | 02 |
| 05 | Plugin moves to `apps/plugin` | A. Monorepo | M | 03, 04 |
| 06 | `packages/viewer` with an injectable `ReviewApi` | A. Monorepo | L | 05 |
| 07 | Shared prompt template with a desktop variant | A. Monorepo | S | 05 |
| 08 | Electron skeleton shows a fixture review | B. Desktop spike | M | 06 |
| 09 | Agent SDK runs with my Claude login | B. Desktop spike | S | 08 |
| 10 | GitHub token | B. Desktop spike | S | 08 |
| 11 | `GitHubApiSource` | B. Desktop spike | M | 03, 10 |
| 12 | Agent runner: one PR end to end | B. Desktop spike | L | 07, 09, 11 |
| 13 | Repo list screen | C. Desktop app | M | 12 |
| 14 | PR list screen | C. Desktop app | M | 13 |
| 15 | Review jobs with progress and cancel | C. Desktop app | M | 12 |
| 16 | Review cache | C. Desktop app | M | 15 |
| 17 | "Done" and viewed state in desktop | C. Desktop app | S | 16 |
| 18 | Packaged app | C. Desktop app | M | 12 |
| 19 | Large PRs via a local clone | D. Later | L | 16 |
| 20 | Post the review to GitHub | D. Later | L | 17 |

## Epic A: Monorepo

### US-01: pnpm workspace

**As a** maintainer, **I want** the repo to use pnpm workspaces, **so that**
the plugin and the desktop app can share local packages.

Acceptance criteria:
- `pnpm-workspace.yaml` exists. The root and `src/ui` are workspace packages for
  now. No source file moves.
- `bun.lock` and `src/ui/bun.lock` are removed; `pnpm-lock.yaml` is committed.
- Root scripts run with `pnpm` (`pnpm verify`, `pnpm verify:ci`). Bun stays
  the runtime and the test runner (`bun test`).
- CI uses `pnpm/action-setup` + `oven-sh/setup-bun` and
  `pnpm install --frozen-lockfile`.
- The committed viewer `dist/` is byte-identical after the switch
  (`verify:dist-fresh` passes).
- README "Development" section uses pnpm. The plugin user instructions are
  unchanged (Bun auto-install still works, because the plugin code does not
  change yet).

### US-02: `packages/core` with the pure review logic

**As a** maintainer, **I want** the review logic in one package with no
runtime-specific code, **so that** the Bun plugin and the Node Electron app use
the exact same code.

Acceptance criteria:
- `packages/core` (`@review-buddy/core`) contains `types/review.ts`,
  `schemas/review.schema.json`, `diff.ts`, `resolve.ts`, `noise.ts`,
  `validate.ts`, and their tests.
- It also contains the pure helpers taken out of `session.ts`
  (`requestChangesMessage`, `resolutionNotesMessage`, `buildMeta({ generatedBy })`)
  and `allowedPaths(review)` taken out of `http.ts`.
- Core has no `Bun.*`, no `import.meta.dir`, no `bun-types` in its tsconfig.
  A lint rule or a typecheck enforces this.
- The plugin code imports core via `workspace:*`. Behavior is unchanged; all
  existing tests pass.

### US-03: `ReviewDataSource` + git capture in core

**As a** maintainer, **I want** one interface for "where the diff, PR metadata
and file bytes come from", **so that** the desktop app can plug in GitHub REST
while the plugin keeps using local git.

Acceptance criteria:
- `ReviewDataSource` (`diff()`, `pr()`, `fileContent(path, side)`) is defined
  in core.
- `git.ts` moves to core as a Node-only subpath export
  (`@review-buddy/core/git`) with its tests and guards (`assertSafeRef`,
  `assertPrRef`, symlink check).
- `LocalGitSource` implements the interface for the worktree / branch / PR
  modes. `openReviewSession` and the `/api/file-content` route use it.
- No behavior change for the plugin.

### US-04: Bundled plugin entry points

**As a** plugin user, **I want** the plugin to start without downloading
packages, **so that** it keeps working after the monorepo move (and the first
launch needs no network).

Acceptance criteria:
- A build step (`bun build --target=bun`) creates `dist/server.js` (MCP server)
  and `dist/hook.js` (hook + `dev` CLI) with core, `zod`, the MCP SDK, and the
  JSON schema inlined.
- `plugin.json`, `hooks.json` and `bin/review-buddy.js` point at the bundles.
- The bundles are committed, marked `linguist-generated` in `.gitattributes`,
  and covered by `verify:dist-fresh` (the build is deterministic).
- A CI smoke test copies the plugin files into an empty folder with **no
  `node_modules`**, then:
  - pipes a sample hook event into `hook.js` and gets a valid PreToolUse answer;
  - starts `server.js` and lists the `submit_review` tool.

### US-05: Plugin moves to `apps/plugin`

**As a** maintainer, **I want** the plugin in its own app folder, **so that**
the repo layout matches the plan and the plugin is self-contained.

Acceptance criteria:
- `apps/plugin` holds `.claude-plugin/plugin.json`, `hooks/`, `skills/`,
  `bin/`, `integrations/`, `examples/`, `src/` (mcp, cli, http, browser,
  session), `ui/` (viewer entry + committed `dist/`), and the bundles.
- `.claude-plugin/marketplace.json` at the root has `"source": "./apps/plugin"`.
- All paths are updated: integration configs, `docs/HARNESSES.md`,
  `scripts/release.sh` (`VERSION_FILES`), `scripts/gen-prompts.ts`, CI,
  `.gitignore`, `.gitattributes`, `biome.jsonc`, tsconfigs, `CLAUDE.md`,
  `README.md`.
- Manual check: `/plugin marketplace add` from a local path + `/plugin install`
  works, and `/review` opens the viewer.
- The release notes say that local-clone installs and Cursor / Copilot / Codex
  configs need the new path.

### US-06: `packages/viewer` with an injectable `ReviewApi`

**As a** maintainer, **I want** the viewer to get its data through an
interface, **so that** the plugin can use HTTP and the desktop app can use IPC.

Acceptance criteria:
- `packages/viewer` (`@review-buddy/viewer`) exports `<ReviewViewer api />`
  and the `ReviewApi` type (`reviewKey`, `getReview`, `getFileContent`,
  `getConfig`, `done`).
- No component imports `api.ts` or `session.ts` directly. `FileDiffCard` and
  `ChapterReview` read the API from context.
- Viewed / collapsed state is keyed by `api.reviewKey`, not by the URL token.
- The plugin's `ui/` entry mounts `<ReviewViewer api={httpReviewApi} />`;
  `httpReviewApi` is today's `api.ts` + `session.ts`.
- The UI tests and Storybook move to the viewer package. Stories use a fake
  in-memory `ReviewApi`.
- The plugin's CSS adds `@source` for `packages/viewer/src`; the rebuilt `dist/`
  renders the same (checked in the browser with a real review).

### US-07: Shared prompt template with a desktop variant

**As a** maintainer, **I want** one prompt source for every harness, including
the desktop agent, **so that** review quality stays the same everywhere.

Acceptance criteria:
- The prompt template moves to `packages/core/prompts/`.
- `gen-prompts.ts` also writes a desktop variant: Step 0 says "call
  `get_pr_diff`"; there is no `source` or `cwd`.
- `skills/review/SKILL.md` and the integration prompts are unchanged in
  content. `verify:prompts-fresh` covers the new variant.

## Epic B: Desktop spike

Goal of the spike: prove the risky parts (Electron + pnpm, Agent SDK login,
GitHub API) on one PR before building screens.

### US-08: Electron skeleton shows a fixture review

**As a** desktop user, **I want** to open the app and see a review in the
viewer, **so that** we know the viewer, IPC and security setup work in
Electron.

Acceptance criteria:
- `apps/desktop` has a main process, a preload script and a renderer
  (electron-vite or plain Vite).
- Window settings: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, strict CSP (same rules as the plugin viewer), external links
  open in the system browser.
- The preload exposes a small IPC API; the renderer mounts
  `<ReviewViewer api={ipcReviewApi} />` with a fixture `ResolvedReview` sent
  from main.
- "Expand full file" works with fixture file contents over IPC.
- `pnpm --filter desktop dev` runs it. pnpm linker settings needed by Electron
  are documented.

### US-09: Agent SDK runs with my Claude login

**As a** desktop user, **I want** the app to use the Claude login I already
have, **so that** I do not need a separate API key.

Acceptance criteria:
- From Electron main, a minimal Agent SDK `query()` returns an answer using the
  local Claude login, in `dev` mode and in a packaged build.
- Packaging needs (for example `asarUnpack` for the SDK) are found and
  written down.
- If it does not work, the result and a fallback (API key in `safeStorage`)
  are written down before going on.

### US-10: GitHub token

**As a** desktop user, **I want** the app to get my GitHub access without
extra setup, **so that** I can list my repos and PRs.

Acceptance criteria:
- If `gh` is installed and logged in, the app uses `gh auth token`.
- Otherwise the user can paste a token (later: OAuth device flow).
- The token is stored with Electron `safeStorage`, lives only in main, and
  never reaches the renderer.
- A settings view shows the GitHub login in use and can sign out.

### US-11: `GitHubApiSource`

**As a** desktop user, **I want** the app to read a PR from the GitHub API,
**so that** I can review PRs of repos I have not cloned.

Acceptance criteria:
- Implements `ReviewDataSource` with GitHub REST: PR diff
  (`application/vnd.github.diff`), PR metadata (`PrMetadata` incl. `url`), merge
  base (`compare`), file contents at a SHA.
- `fileContent` only serves paths that are in the review (`allowedPaths`) and
  URL-encodes path segments.
- A PR that is too large for the diff endpoint gives a clear error. A partial
  diff is never shown as complete.
- Unit tests use recorded API responses (no network in CI).

### US-12: Agent runner: one PR end to end

**As a** desktop user, **I want** to pick one PR and get a narrative review,
**so that** the whole chain is proven before building screens.

Acceptance criteria:
- Electron main runs Agent SDK `query()` with:
  - an in-process `submit_review` tool that uses the shared JSON schema;
  - read-only tools `get_pr_diff` and `read_file`, backed by
    `GitHubApiSource`;
  - no shell or file-write tools.
- The `submit_review` handler runs `validateAgentReview` → `resolveReview` and
  returns the resolution notes to the agent, so it can resubmit with fixed
  anchors in the same run.
- The agent and `resolveReview` use the same diff string.
- The desktop prompt variant (US-07) is the system prompt.
- For a hard-coded PR, the viewer shows Prologue + Chapters, and "expand full
  file" works.

## Epic C: Desktop app

### US-13: Repo list screen

**As a** desktop user, **I want** to see the repos I have access to, **so
that** I can choose one.

Acceptance criteria:
- Lists repos from `GET /user/repos` (owner, name, private flag, last push),
  with paging and a search box.
- Recently used repos are shown first.
- Loading, empty, and error states (including "token expired") are handled.

### US-14: PR list screen

**As a** desktop user, **I want** to see the open PRs of a repo, **so that**
I can choose which ones to review.

Acceptance criteria:
- Lists open PRs (number, title, author, updated, draft flag, size).
- Shows if a cached review exists and if it is still up to date with the
  head SHA.
- The user can start a review for one or more PRs.

### US-15: Review jobs with progress and cancel

**As a** desktop user, **I want** to see review progress and stop a run,
**so that** I am not stuck on a frozen screen for minutes.

Acceptance criteria:
- Each review runs as a job in main. The renderer gets progress events (for
  example: reading diff, writing chapters, resolving).
- The user can cancel a job; the agent run stops.
- Errors (GitHub, agent, too-large PR) are shown clearly with a retry button.
- Several jobs can run at once, with a small limit.

### US-16: Review cache

**As a** desktop user, **I want** finished reviews saved, **so that**
reopening a PR is instant and does not cost another agent run.

Acceptance criteria:
- Reviews are saved per `owner/repo#number@headSha` in the app data folder.
- Opening a PR with a cached review for the current head SHA shows it at once.
- When the head SHA changed, the app says the review is out of date and offers
  to re-run.
- The user can delete cached reviews.

### US-17: "Done" and viewed state in desktop

**As a** desktop user, **I want** my viewed files and "done" state kept,
**so that** I can stop and continue a review later.

Acceptance criteria:
- Viewed / collapsed state survives an app restart (keyed by `reviewKey`).
- "Done" marks the review as finished; the PR list shows it.

### US-18: Packaged app

**As a** desktop user, **I want** an installable app, **so that** I can use
it without running dev commands.

Acceptance criteria:
- A packaged build for my OS installs and runs (code signing is optional for
  personal use).
- The Agent SDK and GitHub flows work in the packaged build (not only in dev).
- Build steps are in the README.

## Epic D: Later

### US-19: Large PRs via a local clone

**As a** desktop user, **I want** very large PRs to work, **so that** the
GitHub diff size limit does not block me.

Acceptance criteria:
- When `GitHubApiSource` reports "too large", the app uses a cached partial
  clone in the app data folder and `LocalGitSource`.
- Clone progress is shown; disk use is visible and can be cleared.

### US-20: Post the review to GitHub

**As a** desktop user, **I want** to send my verdict and notes to the PR,
**so that** the review is not only on my machine.

Acceptance criteria:
- From "Done", the user can approve or request changes with a summary, posted
  as a GitHub PR review.
- Nothing is posted without a clear confirmation step.
