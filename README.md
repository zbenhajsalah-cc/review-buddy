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
- [Bun](https://bun.sh) ≥ 1.3 — the MCP server and hook run on it (`curl -fsSL https://bun.sh/install | bash`)
- `git` — reviews are built from your working-tree diff
- *(optional)* [GitHub CLI](https://cli.github.com) (`gh`), authenticated — only needed to review a GitHub **PR** instead of the local diff

### Install

The viewer ships **prebuilt** in the repo, so there's no build step on either path.

#### Quick install (from GitHub)

Claude Code can add the marketplace directly from GitHub — it clones the repo into its local plugin cache for you. No manual `git clone` and no `bun install` needed.

```text
/plugin marketplace add ziedhajsalah/review-buddy
/plugin install review-buddy@review-buddy
```

[Bun](https://bun.sh) is still required — the plugin's MCP server and hook run on it. The cached copy has no `node_modules`; Bun auto-installs the two runtime dependencies (`@modelcontextprotocol/sdk`, `zod`) on first launch, so that first launch needs network access and may take a few extra seconds.

Restart Claude Code (or reload plugins) if prompted, so the MCP server and hook load.

#### Install from a local clone

For development, or if you'll also use the portable Agent Plugin (Cursor / Copilot / Codex — see below), clone the repo and install deps yourself:

```bash
# 1. Clone and install the backend deps (for the MCP server + hook)
git clone https://github.com/ziedhajsalah/review-buddy
cd review-buddy
bun install
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

Outside Claude Code, Review Buddy ships as a portable **Agent Plugin** — one self-contained directory carrying the same MCP server (in `--standalone` mode, where `submit_review` itself captures the diff and opens the viewer), the structuring skill, and the prebuilt viewer. Get the package by cloning and running `bun install && bun run build:plugin` (output: `dist/agent-plugin/review-buddy/`) or by extracting the `review-buddy-*.tar.gz` attached to a GitHub release, then enable it through your client's plugin mechanism. Per-client steps, blocking mode, and migration from the old manual configs: [`docs/HARNESSES.md`](docs/HARNESSES.md).

### Update / uninstall

```text
/plugin marketplace update review-buddy    # viewer is prebuilt — no rebuild
/plugin uninstall review-buddy@review-buddy
```

GitHub-sourced installs refresh from GitHub directly. Path-sourced installs (local clone): `git pull` first.

### Troubleshooting

Hitting an install or runtime snag (e.g. a Windows `EPERM` on install, `bun: command not found`, the browser not opening)? See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

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
integrations/agent-plugin/  # Agent Plugins authoring input → bun run build:plugin
examples/hooks.json  # example Claude Code plugin hook config
```

## Development

Backend runs on [Bun](https://bun.sh); the viewer is a separate Vite package.

`bun run verify` is the fast local loop (tests + both typechecks); `bun run verify:ci` is the exact gate CI runs on every pull request and on pushes to `main`/`develop` (it adds the UI production build, the Agent Plugin package build + smoke test, and the committed-dist freshness check). Run `bun run verify:ci` before opening a PR. Note that `verify` assumes deps are already installed in both packages (run the `bun install` steps first).

```bash
bun run verify         # fast local loop: backend tests + backend & UI typechecks
bun run verify:ci      # full gate CI runs: verify + UI build + plugin package checks
bun run build:plugin   # assemble the Agent Plugin into dist/agent-plugin/review-buddy/
bun run verify:plugin  # build:plugin + packaging/stdio smoke tests (scripts/)
bun install            # backend deps
bun test               # backend tests
bun run typecheck      # backend tsc

cd src/ui
bun install
bun run dev            # viewer dev server (proxies /api → 127.0.0.1:5199)
bun run build          # typecheck + production build (writes the committed src/ui/dist)
```

Component stories live in `src/ui`. Run `cd src/ui && bun run storybook` for the dev catalog on port 6006, or `bun run build-storybook` for a static build.

> **Contributors:** `src/ui/dist` is a **committed** prebuilt artifact (so installs need no build). If you change viewer source, rebuild (`cd src/ui && bun run build`) and commit the updated `src/ui/dist` in the same PR — CI fails otherwise. The build is deterministic and grammar chunks are content-hashed, so a typical UI change only rewrites the small core chunk. Reviewers verify the CI freshness check rather than reviewing the artifact bytes.

See `docs/build-plan.md` for the phased task breakdown and `docs/review-contract.md` for the agent vs UI/server contracts.

## Inspiration

Built on patterns from [Plannotator](https://github.com/backnotprop/plannotator).
