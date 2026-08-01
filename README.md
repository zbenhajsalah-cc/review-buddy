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

**v0.4.0 — Phase 1 complete** (one-way viewer), installed with zero build steps (the viewer ships prebuilt). What's in:

- **Backend** — `submit_review` MCP tool, `/review` skill, and a blocking `PreToolUse` hook that captures the diff, resolves chapters (unclaimed changes bucketed into "Unsorted changes", generated artifacts into "Generated & noise files"), recomputes stats, and serves a hardened local app (loopback-only bind, Host-header validation, per-server token, path-traversal allowlist, symlink-safe file reads, payload caps, self-only CSP). Where the narrative doesn't map cleanly onto the real diff, the resolution notes travel **back to the agent** — via the hook's `additionalContext` on Claude Code, in the tool result standalone — so it can correct its anchors.
- **Viewer** — Vite + React 19 + Tailwind v4 on [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs): Prologue/Description overview with per-chapter review progress, risk-rated chapter cards, split-pane chapter review, unified/split diffs with line/word/char highlighting granularity + off-thread syntax highlighting (worker pool), per-file controls (marking a file viewed collapses it), collapse state that persists across chapters, cookie-persisted display prefs. **Keyboard-driven** throughout (`?` for the cheatsheet), and `c` copies the review — or the current chapter — as Markdown for pasting into a PR comment. Agent prose and the PR description render as **markdown** (`react-markdown` + GFM, no raw HTML).

**Deferred to later phases:** viewed-state round-trip + verdict submission (Phase 2), GitHub collaboration / Activity / Chat (Phase 3), conversational assistant (Phase 4). In the viewer: shadow-DOM theming.

## Installation

Review Buddy is a **Claude Code plugin**. It registers an MCP server (`review-buddy`, exposing the `submit_review` tool) and a `PreToolUse` hook that renders the review in your browser.

### Prerequisites

- [Claude Code](https://docs.claude.com/en/docs/claude-code)
- [Node.js](https://nodejs.org) ≥ 20.11 — the MCP server and hook run on it
- `git` — reviews are built from your working-tree diff
- *(optional)* [GitHub CLI](https://cli.github.com) (`gh`), authenticated — only needed to review a GitHub **PR** instead of the local diff

### Install (Claude Code)

```text
/plugin marketplace add ziedhajsalah/review-buddy
/plugin install review-buddy@review-buddy
```

Claude Code clones the repo into its plugin cache for you. Both the viewer and the backend ship **prebuilt** (`src/ui/dist/` and `dist/cli.mjs`, the latter an esbuild bundle carrying its own dependencies), so there is no build step, no `node_modules`, and nothing fetched on first launch.

Restart Claude Code (or reload plugins) if prompted, so the MCP server and hook load.

Developing on Review Buddy itself? Point the marketplace at a clone instead:

```text
/plugin marketplace add /absolute/path/to/review-buddy
/plugin install review-buddy@review-buddy
```

### Use it

From any repo, in Claude Code:

```text
/review              # review the current working-tree diff (uncommitted changes)
/review 42           # review GitHub PR #42 — via `gh pr diff`, no checkout needed
```

The agent tells the hook what it reviewed (working tree vs PR) so the hook captures the *same* diff — you don't have to check the PR branch out. The agent then reads the diff, writes the Prologue + Chapters, and a browser tab opens with the review; Claude Code blocks until you click **Done** in the tab.

> For a PR whose branch isn't checked out, the diff renders fully, but "expand full file" may be empty (those bytes aren't on disk).

### Other harnesses (Cursor / VS Code Copilot / Codex)

There's no plugin or hook outside Claude Code — instead you register the same MCP server with the `--standalone` flag, and `submit_review` itself captures the diff and opens the viewer. It's published to npm, so there is nothing to clone:

```json
{
  "mcpServers": {
    "review-buddy": {
      "command": "npx",
      "args": ["-y", "review-buddy@latest", "mcp", "--standalone"]
    }
  }
}
```

That's the Cursor shape; Copilot and Codex want the same command in their own format. Copy the ready-made config **and** the review prompt for your harness from [`integrations/`](integrations), then follow the per-harness steps in [`docs/HARNESSES.md`](docs/HARNESSES.md).

Prefer a global install? `npm install -g review-buddy`, then use `"command": "review-buddy"` with `"args": ["mcp", "--standalone"]`.

### Update / uninstall

```text
/plugin marketplace update review-buddy    # everything is prebuilt — no rebuild
/plugin uninstall review-buddy@review-buddy
```

GitHub-sourced installs refresh from GitHub directly. Path-sourced installs (local clone): `git pull` first. On the npm path, `@latest` picks up new versions on the next `npx` cache miss; a global install updates with `npm update -g review-buddy`.

### Troubleshooting

Hitting an install or runtime snag (e.g. a Windows `EPERM` on install, `node: command not found`, the browser not opening)? See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Layout

```
src/
  mcp/server.ts      # MCP server exposing submit_review
  cli/index.ts       # PreToolUse hook entry (open-review)
  server/            # diff capture, chapter resolution, local HTTP server, browser open
  ui/                # Vite + React 19 + Tailwind v4 viewer (@pierre/diffs)
  types/review.ts    # shared agent + UI/server contracts
docs/                # PRD, ARCHITECTURE, review-contract, build-plan, HARNESSES
schemas/             # review.schema.json = submit_review input schema
examples/hooks.json  # example Claude Code plugin hook config
integrations/        # Cursor / VS Code Copilot / Codex configs + review prompts
```

## Development

Backend **ships** as a Node bundle (`dist/cli.mjs`, Node ≥ 20.11) but is **developed** on [Bun](https://bun.sh) — test runner, typecheck driver, and the esbuild build. Contributors need Bun; users don't. The viewer is a separate Vite package.

`bun run verify` is the fast local loop (tests + both typechecks); `bun run verify:ci` is the exact gate CI runs on every pull request and on pushes to `main`/`develop` (it adds the UI production build). Run `bun run verify:ci` before opening a PR. Note that `verify` assumes deps are already installed in both packages (run the `bun install` steps first).

```bash
bun run verify         # fast local loop: backend tests + backend & UI typechecks
bun run verify:ci      # full gate CI runs: verify + UI production build
bun install            # backend deps
bun test               # backend tests
bun run typecheck      # backend tsc

cd src/ui
bun install
bun run dev            # viewer dev server (proxies /api → 127.0.0.1:5199)
bun run build          # typecheck + production build (writes the committed src/ui/dist)
```

Component stories live in `src/ui`. Run `cd src/ui && bun run storybook` for the dev catalog on port 6006, or `bun run build-storybook` for a static build.

> **Contributors:** `src/ui/dist` **and** `dist/cli.mjs` are **committed** prebuilt artifacts (so installs need no build). If you change backend source, rebuild (`bun run build:dist`) and commit `dist/` in the same PR; if you change viewer source, rebuild (`cd src/ui && bun run build`) and commit the updated `src/ui/dist` in the same PR — CI fails otherwise. The build is deterministic and grammar chunks are content-hashed, so a typical UI change only rewrites the small core chunk. Reviewers verify the CI freshness check rather than reviewing the artifact bytes.

See `docs/build-plan.md` for the phased task breakdown and `docs/review-contract.md` for the agent vs UI/server contracts.

## Inspiration

Built on patterns from [Plannotator](https://github.com/backnotprop/plannotator).
