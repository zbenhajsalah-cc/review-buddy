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
- `src/ui/bun.lock` is removed; `pnpm-lock.yaml` is committed, imported from
  the Bun lockfiles so every package keeps its exact version.
- The root `bun.lock` **stays**: local-clone installs (plugin from a path,
  Cursor / Copilot / Codex) run plain `bun install`, which reads `bun.lock` but
  not `pnpm-lock.yaml` (verified: without it, they get the newest versions).
  `verify:bun-lock` fails CI when it no longer matches `package.json`. US-04
  removes it. Note: GitHub installs use Bun auto-install, which ignores
  `bun.lock` and always takes the newest versions in range; that is today's
  behavior too, and US-04 fixes it.
- Root scripts run with `pnpm` (`pnpm verify`, `pnpm verify:ci`). Bun stays
  the runtime and the test runner (`bun test`). Bun's version moves from
  `packageManager` to `.bun-version`.
- CI installs pnpm (version from `packageManager`), runs `setup-bun` with
  `.bun-version`, and `pnpm install --frozen-lockfile`.
- The committed viewer `dist/` is byte-identical after the switch
  (`verify:dist-fresh` passes).
- README "Development" section uses pnpm. The plugin user instructions are
  unchanged (`bun install` in a local clone and Bun auto-install still work).

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
  The core typecheck enforces this: its source tsconfig has no runtime types
  at all (no Bun, no Node, no DOM); tests use a separate tsconfig.
- The plugin imports `@review-buddy/core/*` through `paths` in the root
  tsconfig (Bun honors them at runtime), **not** a `workspace:*` dependency:
  GitHub installs (Bun auto-install, no `node_modules`) and local clones
  (plain `bun install`) cannot resolve `workspace:*`. The viewer uses
  `workspace:*` (only pnpm installs it).
- Behavior is unchanged; all existing tests pass. Checked by running the
  plugin from a copy with no `node_modules` and an empty Bun cache (Bun 1.3.5
  and 1.4.4) and from a local clone after `bun install`.

### US-03: `ReviewDataSource` + git capture in core

**As a** maintainer, **I want** one interface for "where the diff, PR metadata
and file bytes come from", **so that** the desktop app can plug in GitHub REST
while the plugin keeps using local git.

Acceptance criteria:
- `ReviewDataSource` (`diff()`, `pr()`, `fileContent(path, side)`) is defined
  in core.
- `git.ts` moves to core as a Node-only subpath export
  (`@review-buddy/core/node/git`) with its tests and guards (`assertSafeRef`,
  `assertPrRef`, symlink check). `src/node/` has its own typecheck with Node
  types and no Bun types; pure core code that imports it fails the pure
  typecheck.
- `LocalGitSource` implements the interface for the worktree / branch / PR
  modes. `openReviewSession` and the `/api/file-content` route use it.
- No behavior change for the plugin.

### US-04: Bundled plugin entry points

**As a** plugin user, **I want** the plugin to start without downloading
packages, **so that** it keeps working after the monorepo move, runs the exact
dependency versions we tested (today GitHub installs auto-install the newest
versions in range), and the first launch needs no network.

Acceptance criteria:
- A build step (`bun build --target=bun`) creates `dist/server.js` (MCP server)
  and `dist/hook.js` (hook + `dev` CLI) with core, `zod`, the MCP SDK, and the
  JSON schema inlined.
- `plugin.json`, `hooks.json` and `bin/review-buddy.js` point at the bundles.
- The root package keeps the tsconfig `paths` from US-02 instead of a
  `workspace:*` dependency, so older Cursor / Copilot / Codex configs that
  run `src/mcp/server.ts` from a `bun install`ed clone keep working.
- `src/mcp/server.ts` imports the standalone handler statically: with a
  dynamic `import()`, Bun's bundler put zod behind lazy initializers and the
  bundled server crashed at startup (found by the smoke test).
- The plugin root is found by walking up to `.claude-plugin/plugin.json`
  (`src/plugin-root.ts`), so the viewer folder and the version are found
  from both source and bundle.
- The runtime dependencies (`@modelcontextprotocol/sdk`, `zod`) become
  `devDependencies` of the root package: they are build inputs now.
- The bundles are committed, marked `linguist-generated` in `.gitattributes`,
  and covered by `verify:dist-fresh` (the build is deterministic).
- The root `bun.lock` and the `verify:bun-lock` script are removed (nothing
  auto-installs any more).
- A CI smoke test (`pnpm smoke:plugin`, last step of `verify:ci`) copies the
  plugin files into an empty folder with **no `node_modules`** and runs the
  bundles with Bun auto-install **disabled** (`--no-install`), then:
  - pipes a bad hook event into `hook.js` and gets a valid PreToolUse answer;
  - runs a full hook review: viewer page, `/api/review`, `/api/file-content`,
    Done → "allow";
  - starts `server.js`, checks the version, and lists the `submit_review`
    tool;
  - starts `server.js --standalone` and calls `submit_review`, which returns
    a working viewer URL.
- Integration configs and `docs/HARNESSES.md` point at `dist/server.js`; the
  README install steps drop `bun install`.

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
- `apps/plugin` is a workspace package (`review-buddy`, with the `bin`). It
  imports `@review-buddy/core` through a `workspace:*` dev dependency. The
  tsconfig `paths` from US-02 are removed: the old `src/mcp/server.ts` path
  is gone after the move anyway, so nothing runs the source from a plain
  `bun install`ed clone any more. The root package is
  `review-buddy-monorepo` and only holds shared scripts and Biome.
- The viewer moves as is to `apps/plugin/ui` (the split into
  `packages/viewer` is US-06). `build-plugin.ts` and `smoke-plugin.ts` move to
  `apps/plugin/scripts/`; `gen-prompts.ts` stays at the root (US-07 adds a
  desktop variant).
- The smoke test copies `apps/plugin` **alone** (what Claude Code copies into
  its plugin cache), so any path that reaches outside it fails.
- Manual check: `/plugin marketplace add` from a local path + `/plugin install`
  works, and `/review` opens the viewer. (Checked with the `claude plugin` CLI:
  only `apps/plugin` lands in the cache, and the smoke checks pass on that
  copy with its `node_modules` removed. The live `/review` run in a Claude
  Code session is still to do by hand.)
- The release notes say that local-clone installs and Cursor / Copilot / Codex
  configs need the new path. (Note added to README "Update / uninstall" and
  `docs/HARNESSES.md`; GitHub Release notes are auto-generated, so add it
  there by hand at release time.)

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
- Decisions made while building it:
  - `<ReviewViewer api />` also owns the error boundary and the diff worker
    pool, and validates `getReview()` with the zod schema (the data crosses a
    process boundary in both apps).
  - The viewer's CSS is `@review-buddy/viewer/theme.css` (tokens + base
    styles, no `@import "tailwindcss"`), so each app has one Tailwind import
    and scans its own shell plus the viewer.
  - Viewer source uses relative imports instead of the `@/` alias: each app
    builds it with its own Vite config. `components.json` and the viewer's
    tsconfig keep `@/` only for the shadcn CLI.
  - The plugin's `reviewKey` is the URL token, so the localStorage keys
    (`rb.viewed.<token>`) are the same as before.
  - Result: the viewer CSS is byte-identical, and screenshots of the old and
    new build (overview, chapter, expanded file) are byte-identical.

### US-07: Shared prompt template with a desktop variant

**As a** maintainer, **I want** one prompt source for every harness, including
the desktop agent, **so that** review quality stays the same everywhere.

Acceptance criteria:
- The prompt template moves to `packages/core/prompts/`.
- `gen-prompts.ts` also writes a desktop variant: Step 0 says "call
  `get_pr_diff`"; there is no `source` or `cwd`.
- `skills/review/SKILL.md` and the integration prompts are unchanged in
  content. `verify:prompts-fresh` covers the new variant.
- Decisions made while building it:
  - The template is `packages/core/prompts/review-template.md`. Text for one
    kind of harness sits in `{{#standalone}}…{{/standalone}}` or
    `{{#desktop}}…{{/desktop}}` blocks, so Steps 1–3 and the Critical rules
    exist once.
  - The desktop variant is `packages/core/prompts/review-desktop.md`
    (generated, exported as `@review-buddy/core/prompts/review-desktop.md`).
    Its Step 4 tells the agent to fix anchors from the resolution notes and
    resubmit at most 2 times; US-12's `submit_review` handler must return
    those notes.
  - A plugin test checks that the skill and every generated prompt have the
    same Steps 1–3 and Critical rules, so a change to the hand-written skill
    that is not ported to the template fails CI.

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
- Decisions made while building it:
  - The tools are an in-process MCP server (`createSdkMcpServer`). The SDK's
    `tool()` takes zod, not JSON Schema, so `submit_review` uses the shared
    schema converted with `z.fromJSONSchema`, without `cwd` and `source` (the
    app knows the PR). A test lists the tools over MCP and checks the schema
    the agent sees equals the shared one.
  - The agent gets `tools: []` (no built-in tools at all), `permissionMode:
    "dontAsk"` with only the three tools allowed, no settings files and no
    other MCP servers.
  - The runner reads the PR (metadata + diff) before Claude starts, so a PR
    too large for the API fails without spending tokens. That one diff
    string goes to `get_pr_diff` and to `resolveReview`.
  - `get_pr_diff` sends a large diff in parts of at most 40k characters
    (Claude Code cuts MCP output at about 25k tokens), split at files, then
    hunks. The parts join back to the exact diff. `read_file` reads only the
    PR's files, with line numbers, in windows.
  - `submit_review` accepts at most 3 resolved submissions (the first plus
    the 2 fixes the prompt allows). The app shows the last one, even if the
    run ends badly afterwards (for example out of turns).
  - "Hard-coded PR": the top bar takes `owner/repo#123` or a PR URL (and
    `--review-pr=…` starts one at launch), so you can try your own PRs until
    the PR screens exist. One run at a time; it can be stopped.
  - Checked end to end with the real agent (`scripts/review-e2e.ts`, faked
    GitHub with the recorded PR #28): Prologue and all chapters show, and
    "expand full file" works, in dev and in a packaged build. About 15–25 s
    and a few cents for this small PR.

## Epic C: Desktop app

### US-13: Repo list screen

**As a** desktop user, **I want** to see the repos I have access to, **so
that** I can choose one.

Acceptance criteria:
- Lists repos from `GET /user/repos` (owner, name, private flag, last push),
  with paging and a search box.
- Recently used repos are shown first.
- Loading, empty, and error states (including "token expired") are handled.
- Decisions made while building it:
  - The repo list is the start screen. The top bar has two tabs,
    "Repositories" and the review ("Sample review" until a review runs, then
    the PR). The list stays mounted while hidden, so it keeps its pages.
  - Paging: 100 per page, newest push first (`sort=pushed`), with a **Load
    more** button driven by GitHub's `Link` header. The search filters the
    loaded pages only and says so while more pages exist (no search API: it
    cannot cover "every repo this login can see" the same way).
  - "Recently used" = picked in the list, or a review of one of its PRs
    started (at most 8, in `settings.json`). Page 1 brings them, read again
    with the current login (`GET /repos/{o}/{r}` for those not on page 1).
  - Until US-14, picking a repo filled the top bar with `owner/repo#`.
  - "Token expired": a 401 on a later call signs the app out
    (`GitHubAuth.tokenRejected`, only if the login did not change meanwhile),
    and the list says why. List failures are answers, not IPC errors.
  - `/user/repos` could not be recorded from the build container (its API is
    limited to one repo), so the tests use a recorded `GET /repos/{o}/{r}`,
    which has the same item shape.

### US-14: PR list screen

**As a** desktop user, **I want** to see the open PRs of a repo, **so that**
I can choose which ones to review.

Acceptance criteria:
- Lists open PRs (number, title, author, updated, draft flag, size).
- Shows if a cached review exists and if it is still up to date with the
  head SHA.
- The user can start a review for one or more PRs.
- Decisions made while building it:
  - REST, not GraphQL: the list endpoint (`pulls?state=open&sort=updated`,
    30 per page) has no sizes, so main reads each PR's size (8 at a time,
    10 s each at most, kept per PR head). GraphQL would do it in one call,
    but the rest of the app is REST, and the build container cannot reach
    GraphQL to check it.
  - "Cached review" means the reviews main holds in memory for now
    (`ReviewStore.newestFor`): **Reviewed** when it is for the PR's current
    head, **Outdated review** when the PR has moved. US-16 makes them survive
    a restart.
  - "One or more PRs": the single review job (US-12) became a queue of jobs
    (`ReviewJobs`) that run one after another; the renderer polls `jobs()`.
    **Review** on a row follows that job; **Review selected** queues several
    and stays on the list. US-15 adds the concurrency limit, the retry
    button and the rest of the progress design.
  - The review tab follows one job or an opened review, so a review that
    finishes in the background never replaces the one you are reading.
  - Picking a repo opens its PR list (replacing US-13's "fill the PR box").

### US-15: Review jobs with progress and cancel

**As a** desktop user, **I want** to see review progress and stop a run,
**so that** I am not stuck on a frozen screen for minutes.

Acceptance criteria:
- Each review runs as a job in main. The renderer gets progress events (for
  example: reading diff, writing chapters, resolving).
- The user can cancel a job; the agent run stops.
- Errors (GitHub, agent, too-large PR) are shown clearly with a retry button.
- Several jobs can run at once, with a small limit.
- Decisions made while building it:
  - Jobs, cancel and the queue came with US-14; this story adds the rest.
  - Progress events: main sends the whole job list on every change
    (`review:jobs-changed`, at most every 100 ms; the preload exposes
    `onJobs`, which hands the page the list only). The renderer no longer
    polls.
  - Each step has a phase: `github`, `reading`, `writing`, `checking`.
    "Writing" is real: the run streams Claude's output
    (`includePartialMessages`) and reads the chapter titles from the
    `submit_review` input as it is written ("Writing chapter 2: …").
    Checked with the real agent.
  - Errors have a kind: `github`, `too-large`, `claude` (Claude Code cannot
    start, or an SDK error code such as `authentication_failed` or
    `rate_limit`, said in words), `agent` (no review came out), `stopped`.
    **Try again** queues the same PR again and follows it; not for
    "too large".
  - At most 2 reviews run at once (`MAX_RUNNING`): each is a Claude Code
    process, and two cover "review the selected PRs" without hitting rate
    limits. Not a setting yet.

### US-16: Review cache

**As a** desktop user, **I want** finished reviews saved, **so that**
reopening a PR is instant and does not cost another agent run.

Acceptance criteria:
- Reviews are saved per `owner/repo#number@headSha` in the app data folder.
- Opening a PR with a cached review for the current head SHA shows it at once.
- When the head SHA changed, the app says the review is out of date and offers
  to re-run.
- The user can delete cached reviews.
- Decisions made while building it:
  - One JSON file per PR head in `<userData>/reviews/<owner>/<repo>/`, plus
    an `index.json` for lists and lookups. The key stays
    `owner/repo#n@<first 12 of the head SHA>` (the viewer's local state is
    keyed by it); the file name has the full SHA.
  - A saved review keeps the resolved review, the head and merge-base SHAs,
    and the diff's file list. After a restart, "expand full file" reads the
    files from GitHub at those SHAs (`prFileReader`, shared with the open
    PR), so the review's file reads stay what they were.
  - Starting a review of a PR head that has a saved review opens it without
    Claude; **Run again** asks for a fresh run (`start(pr, { fresh: true })`).
  - Out of date: the PR list compares the newest saved review's head with
    the PR's head; the review view shows a bar with **Review again**.
  - Deleting is in Settings (each, or all after a second click). A deleted
    review also leaves the jobs list, and the PR list reloads.
  - The smoke test writes its saved reviews itself, in the file format, so a
    change to the format that would lose saved reviews fails it.

### US-17: "Done" and viewed state in desktop

**As a** desktop user, **I want** my viewed files and "done" state kept,
**so that** I can stop and continue a review later.

Acceptance criteria:
- Viewed / collapsed state survives an app restart (keyed by `reviewKey`).
- "Done" marks the review as finished; the PR list shows it.
- Decisions made while building it:
  - Viewed / collapsed state stays where the viewer keeps it: the page's
    `localStorage`, keyed by `reviewKey`. The app's `app://renderer` origin
    stores it in the profile, so it survives a restart (checked by
    `review-e2e` after a real restart). No new IPC for it.
  - The viewer cleared that state on Done and said "Review submitted — you
    can close this tab", which is right for the plugin only. A new optional
    `ReviewApi.afterDone` ("close" by default, so the plugin is unchanged;
    "keep" in the app) keeps the state and the open review, with a
    **Done ✓** button. The plugin's UI bundle was rebuilt for it; its
    behavior is the same.
  - Done is saved with the review (`doneAt` in the saved-review index) and
    shown in the PR list (**Done ✓**), on the review ("You marked this review
    done …") and in Settings. A new review of the same commit is not done.
  - Deleting a saved review also removes its viewed / collapsed state.

### US-18: Packaged app

**As a** desktop user, **I want** an installable app, **so that** I can use
it without running dev commands.

Acceptance criteria:
- A packaged build for my OS installs and runs (code signing is optional for
  personal use).
- The Agent SDK and GitHub flows work in the packaged build (not only in dev).
- Build steps are in the README.
- Decisions made while building it:
  - `pnpm --filter desktop dist` (root: `pnpm dist:desktop`) builds the
    installer for the OS it runs on: a `.dmg` + `.zip` on macOS, an NSIS
    per-user installer on Windows, an AppImage on Linux (a `.deb` would need
    a maintainer e-mail address). `package` still makes the unpacked app.
  - No code signing: macOS builds are signed ad hoc (Apple Silicon needs a
    signature to run) without the hardened runtime, and the Claude Code
    binary keeps Anthropic's signature. The README says how to open an
    unsigned app on each OS.
  - The Claude Code binary stays bundled (the app runs the version it was
    tested with), so the AppImage is about 240 MB.
  - An app icon (`build/icon.svg` → `icon.png`): risk-rated chapters.
  - Checked on Linux with the AppImage itself: the smoke test, `--agent-check`
    and the real-agent review (with a restart). macOS and Windows installers
    must be built on those systems and were not built here. electron-builder
    starts AppImages with `--no-sandbox`; the README explains it and how to
    keep the OS sandbox with the unpacked app.

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
