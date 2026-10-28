# Review Buddy

AI-assisted **narrative code review** for Claude Code — and, via standalone MCP mode, for Cursor, VS Code Copilot, and Codex.

Most PRs are reviewed as an undifferentiated wall of diffs. Review Buddy reframes a PR as a guided reading: an AI agent reads the changes, writes a high-level **Prologue** (why / what / key changes / where to focus), and segments the work into risk-rated thematic **Chapters** you walk through in a browser.

## How it works

1. You run a `/review` command in Claude Code.
2. The agent analyses the diff and calls a custom `submit_review` tool with a structured review.
3. A `PreToolUse` hook intercepts the call, captures the real `git diff` + PR metadata, resolves the agent's chapter *anchors* onto the authoritative hunks, starts a loopback-only local server, and opens the browser.
4. A prebuilt React app renders the Prologue and Chapters, with a rich unified/split diff viewer.

The agent provides **judgment and structure**; the actual diff bytes come from git. This **reference-not-reproduce** rule is load-bearing — the agent never echoes diff content, so it can't fabricate changes. See `CLAUDE.md` for the full architecture.

**Not on Claude Code?** The same MCP server runs standalone in Cursor, VS Code Copilot (agent mode), and Codex — `submit_review` itself captures the diff and opens the viewer instead of relying on the `PreToolUse` hook. Setup per harness: [`docs/HARNESSES.md`](docs/HARNESSES.md), ready-to-copy configs + prompts: [`integrations/`](integrations).

## Status

**v1.0.0** — the Claude Code plugin and the Electron desktop app, both installed with zero build steps (the viewer ships prebuilt). What's in:

- **Backend** — `submit_review` MCP tool, `/review` skill, and a blocking `PreToolUse` hook that captures the diff, resolves chapters (unclaimed changes bucketed into "Unsorted changes", generated artifacts into "Generated & noise files"), recomputes stats, and serves a hardened local app (loopback-only bind, Host-header validation, per-server token, path-traversal allowlist, symlink-safe file reads, payload caps, self-only CSP). Where the narrative doesn't map cleanly onto the real diff, the resolution notes travel **back to the agent** — via the hook's `additionalContext` on Claude Code, in the tool result standalone — so it can correct its anchors.
- **Viewer** — Vite + React 19 + Tailwind v4 on [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs): Prologue/Description overview with per-chapter review progress, risk-rated chapter cards, split-pane chapter review, unified/split diffs with line/word/char highlighting granularity + off-thread syntax highlighting (worker pool), per-file controls (marking a file viewed collapses it), collapse state that persists across chapters, cookie-persisted display prefs. A **Theme & font** popover picks any of the 69 syntax themes `@pierre/diffs` ships (a light and a dark pick; Auto follows the OS) and one of 8 free (OFL) self-hosted code fonts — JetBrains Mono (default), Fira Code, Cascadia Code, Geist Mono, Monaspace Neon, IBM Plex Mono, Source Code Pro, Victor Mono — or the system monospace, with size and ligature controls. **Keyboard-driven** throughout (`?` for the cheatsheet), and `c` copies the review — or the current chapter — as Markdown for pasting into a PR comment. Once you have viewed files, **Begin review** becomes **Continue with chapter N** (the first chapter not complete); file headers stay at the top while a long file scrolls. The review-focus file on the overview opens its chapter at that file. The chapter's file list shows each file's folder, has **Collapse all** and **Hide viewed files**, and **Done** asks first while files are not marked viewed. **Line comments:** the **+** in a diff line's gutter opens a comment on that line (drag it for several lines; or select lines by their numbers, shift-click for a range); comments are Markdown, show under their lines, can be edited and deleted, are listed in the chapter's sidebar (a click jumps to one) and counted on the overview, and are part of the copied Markdown. They are kept in the browser per review. **Round-trip** (the plugin): **Request changes** sends your note and your line comments back to the agent — the hook denies `submit_review` with them, so Claude fixes the code and submits a new review — and **Done** approves, passing any comments along for Claude to answer. It is on by default; set `REVIEW_BUDDY_ROUNDTRIP=0` for the one-way viewer, where Done offers to copy your comments first. In the plugin the chapter is in the URL (`#/chapter/3`), so reload, Back and Forward work, the tab title names the review and chapter (`Ch 3/7 · …`), and closing the tab before **Done** asks first (the agent waits for Done). Agent prose and the PR description render as **markdown** (`react-markdown` + GFM, no raw HTML).
- **Desktop app** — an Electron app that runs the whole review itself, no Claude Code session needed: it opens on your GitHub repositories, lists a repo's open PRs with their review state, and reviews one or several of them (or any `owner/repo#123` / PR URL you paste). Reviews run two at a time against the GitHub API with your own Claude login, with live phase progress, stop, and retry, and a system notification when one ends while the app is in the background; a PR too large for the API's diff is fetched from git into a small local clone. Finished reviews are saved per PR head and reopen without a re-run, keeping your viewed files and **Done** — and from Done you can post your verdict and summary to the PR as a real GitHub review, after a confirm step that shows the exact text. Your GitHub token lives in the OS keychain and never reaches the renderer. Installers are unsigned and use the `claude` you already have installed. See [`apps/desktop/README.md`](apps/desktop/README.md).

**Deferred:** the viewed-state round-trip (viewed marks are lost when Claude submits a new review), posting line comments to GitHub from the desktop app; Activity and Chat, a conversational assistant, and shadow-DOM theming in the viewer are still open.

## Installation

Review Buddy is a **Claude Code plugin**. It registers an MCP server (`review-buddy`, exposing the `submit_review` tool) and a `PreToolUse` hook that renders the review in your browser.

### Prerequisites

- [Claude Code](https://docs.claude.com/en/docs/claude-code)
- [Bun](https://bun.sh) ≥ 1.3 — the MCP server and hook run on it (`curl -fsSL https://bun.sh/install | bash`)
- `git` — reviews are built from your working-tree diff
- *(optional)* [GitHub CLI](https://cli.github.com) (`gh`), authenticated — only needed to review a GitHub **PR** instead of the local diff

### Install

The viewer and the plugin's MCP server + hook ship **prebuilt** in the repo (`apps/plugin/ui/dist/`, `apps/plugin/dist/`), so there's no build or install step on either path.

#### Quick install (from GitHub)

Claude Code can add the marketplace directly from GitHub — it clones the repo into its local plugin cache for you. No manual `git clone` and no install step needed.

```text
/plugin marketplace add ziedhajsalah/review-buddy
/plugin install review-buddy@review-buddy
```

[Bun](https://bun.sh) is still required — the plugin's MCP server and hook run on it. They are self-contained bundles with every dependency inlined, so nothing is downloaded on first launch.

Restart Claude Code (or reload plugins) if prompted, so the MCP server and hook load.

#### Install from a local clone

For development, or if you'll also use the standalone harnesses (Cursor / Copilot / Codex — see below), clone the repo yourself. No install step is needed to run the plugin (for development, see [Development](#development)):

```bash
# 1. Clone
git clone https://github.com/ziedhajsalah/review-buddy
cd review-buddy
```

```text
# 2. In Claude Code, register and install the plugin (use the absolute path from step 1)
/plugin marketplace add /absolute/path/to/review-buddy
/plugin install review-buddy@review-buddy
```

Restart Claude Code (or reload plugins) if prompted, so the MCP server and hook load.

### Use it

From any repo, in Claude Code:

```text
/review              # review the current working-tree diff (uncommitted changes)
/review 42           # review GitHub PR #42 — via `gh pr diff`, no checkout needed
```

The agent tells the hook what it reviewed (working tree vs PR) so the hook captures the *same* diff — you don't have to check the PR branch out. The agent then reads the diff, writes the Prologue + Chapters, and a browser tab opens with the review; Claude Code blocks until you click **Done** in the tab.

> For a PR whose branch isn't checked out, the diff renders fully, but "expand full file" may be empty (those bytes aren't on disk).

### Other harnesses (Cursor / VS Code Copilot / Codex)

There's no plugin or hook outside Claude Code — instead you register the same MCP server with the `--standalone` flag, and `submit_review` itself captures the diff and opens the viewer. The **Install from a local clone** path above is the one you need. Copy the MCP config and review prompt for your harness from [`apps/plugin/integrations/`](apps/plugin/integrations) and follow the per-harness steps in [`docs/HARNESSES.md`](docs/HARNESSES.md).

### Update / uninstall

```text
/plugin marketplace update review-buddy    # viewer is prebuilt — no rebuild
/plugin uninstall review-buddy@review-buddy
```

GitHub-sourced installs refresh from GitHub directly. Path-sourced installs (local clone): `git pull` first.

> **Path change after 0.4.0:** the plugin now lives in `apps/plugin/` (the marketplace points there, so marketplace installs pick it up on update). If you load the plugin with `--plugin-dir`, point it at `apps/plugin`. Cursor / Copilot / Codex configs must use `apps/plugin/dist/server.js` instead of `dist/server.js` or `src/mcp/server.ts`.

### Troubleshooting

Hitting an install or runtime snag (e.g. a Windows `EPERM` on install, `bun: command not found`, the browser not opening)? See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Layout

```
.claude-plugin/marketplace.json  # marketplace; the plugin "source" is ./apps/plugin
apps/plugin/         # the Claude Code plugin + standalone MCP server (self-contained)
  .claude-plugin/    # plugin.json
  hooks/ skills/     # PreToolUse wiring, the /review skill
  src/mcp/server.ts  # MCP server exposing submit_review
  src/cli/index.ts   # PreToolUse hook entry (open-review)
  src/server/        # session lifecycle, local HTTP server, browser open
  ui/                # Vite entry: mounts the viewer with the HTTP ReviewApi; committed build in ui/dist
  dist/              # committed bundles: server.js, hook.js
  integrations/      # Cursor / VS Code Copilot / Codex configs + review prompts
  examples/hooks.json # example Claude Code plugin hook config
apps/desktop/        # Electron desktop app: the same viewer over IPC, reviews run in-app — see apps/desktop/README.md
packages/core/       # @review-buddy/core: contracts, diff parser, chapter resolution, validation, git capture (src/node)
  schemas/           # review.schema.json = submit_review input schema
packages/viewer/     # @review-buddy/viewer: <ReviewViewer api /> — React 19 + Tailwind v4 + @pierre/diffs, data via a ReviewApi
docs/                # PRD, ARCHITECTURE, review-contract, build-plan, HARNESSES
```

## Development

The repo is a [pnpm](https://pnpm.io) workspace: the plugin (`apps/plugin`: MCP server + hook, and `apps/plugin/ui`, the Vite entry that builds its viewer), the review UI (`packages/viewer`), and the shared review logic (`packages/core`). pnpm installs everything; [Bun](https://bun.sh) still runs the backend, the scripts, and the tests. Versions: pnpm from `package.json` `packageManager`, Bun from `.bun-version`.

`pnpm verify` is the fast local loop (tests + typechecks); `pnpm verify:ci` is the exact gate CI runs on every pull request and on pushes to `main`/`develop` (it adds the UI and plugin builds, the committed-artifact freshness checks, and the plugin smoke test). Run `pnpm verify:ci` before opening a PR.

```bash
pnpm install           # all workspace deps (backend + viewer), from pnpm-lock.yaml
pnpm verify            # fast local loop: core + backend tests, all typechecks, viewer + UI tests
pnpm verify:ci         # full gate CI runs: verify + builds + freshness + plugin smoke test
pnpm test:core         # core tests
pnpm typecheck:core    # core tsc (rejects Bun/Node/DOM APIs)
pnpm test              # plugin backend tests
pnpm typecheck         # plugin backend tsc
pnpm test:viewer       # viewer tests (components, with a fake in-memory ReviewApi)
pnpm test:ui           # plugin viewer entry tests (the HTTP ReviewApi)

pnpm --filter review-buddy-ui dev     # viewer dev server (proxies /api → 127.0.0.1:5199)
pnpm build:ui                         # typecheck + production build (writes the committed apps/plugin/ui/dist)
pnpm build:plugin                     # bundle the MCP server + hook (writes the committed apps/plugin/dist)
pnpm smoke:plugin                     # run apps/plugin alone, like an installed plugin: no node_modules, no auto-install

pnpm dev:desktop                      # Electron desktop app in dev mode (see apps/desktop/README.md)
pnpm test:desktop                     # desktop unit tests
pnpm smoke:desktop                    # build + drive the real Electron app (needs a display, or xvfb-run)
```

Component stories live in `packages/viewer` and use a fake in-memory `ReviewApi`. Run `pnpm --filter @review-buddy/viewer storybook` for the dev catalog on port 6006, or `pnpm --filter @review-buddy/viewer build-storybook` for a static build.

> **Contributors:** `apps/plugin/ui/dist` (viewer) and `apps/plugin/dist` (plugin bundles) are **committed** prebuilt artifacts (so installs need no build). If you change viewer source (`packages/viewer` or `apps/plugin/ui`), rebuild (`pnpm build:ui`); if you change plugin or `packages/core` source, rebuild (`pnpm build:plugin`); commit the updated artifacts in the same PR — CI fails otherwise. `pnpm smoke:plugin` runs the bundles from a `node_modules`-free copy with Bun auto-install disabled. The build is deterministic and grammar chunks are content-hashed, so a typical UI change only rewrites the small core chunk. Reviewers verify the CI freshness check rather than reviewing the artifact bytes.

See `docs/build-plan.md` for the phased task breakdown and `docs/review-contract.md` for the agent vs UI/server contracts.

## Inspiration

Built on patterns from [Plannotator](https://github.com/backnotprop/plannotator).
