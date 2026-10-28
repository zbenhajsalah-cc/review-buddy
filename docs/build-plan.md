# Build Plan

Phase 1 is shipped. This file is the shipped/deferred ledger: the stack
that was chosen, what Phase 1 delivered, and what's deferred to Phases 2–4. For
orientation read `CLAUDE.md` and `docs/ARCHITECTURE.md`; for install/dev see
`README.md`.

## Stack (chosen and shipped)

- **Runtime:** Bun — the MCP server and the `PreToolUse` hook both run on it.
- **MCP server:** `@modelcontextprotocol/sdk` (TypeScript) exposing one tool,
  `submit_review`, whose `inputSchema` is `schemas/review.schema.json`.
- **UI:** React 19 + Vite + Tailwind v4; diffs via `@pierre/diffs` with syntax
  highlighting by Shiki (`shiki-js`). The build is **committed** to the repo
  (`src/ui/dist/`) so install needs no build step — see
  `docs/DESIGN-prebuilt-distribution.md`.
- **Diff parsing:** we parse `git diff` ourselves (`src/server/`); word-level
  intra-line highlighting is done client-side by `@pierre/diffs`.
- **HTTP server:** `Bun.serve` for `/api/*` — loopback-only bind with a
  per-server token.

## Phase 1 — One-way narrative viewer ✅ shipped

Goal (met): agent → `submit_review` → hook → browser renders Prologue +
Chapters + diffs. No round-trip.

1. ✅ **MCP server + tool.** The `review-buddy` MCP server exposes
   `submit_review` (schema-validated); registered as a Claude Code plugin server.
2. ✅ **`/review` skill.** `skills/review/SKILL.md` is the structuring prompt
   (`disable-model-invocation: true`; runs on request). It instructs the agent
   to analyze the diff and call `submit_review` — including the load-bearing
   `source` field so the hook re-captures the same diff.
3. ✅ **Hook command (`open-review`, `src/cli/index.ts`).** On the `PreToolUse`
   interception: read the agent JSON from stdin; in `cwd` capture `git diff`
   (source B) + PR metadata (`gh` when available); parse the diff into files →
   hunks and **resolve** chapters by matching agent anchors, bucketing unclaimed
   hunks into "Unsorted changes"; recompute stats; start the local server, open
   the browser, and **block** until `POST /api/done`.
4. ✅ **Server endpoints.** `GET /api/review`, `GET /api/file-content`,
   `POST /api/done`.
5. ✅ **React app.** Prologue/Description overview (AI badge + `meta`, risk-rated
   chapter cards); split-pane chapter review (context panel + filterable
   chapter-scoped file tree + diff pane); diff viewer with unified/split, display
   settings (theme, indicator, granularity incl. word-level, wrap, line numbers,
   backgrounds, minimize), "N unmodified lines" collapse, and per-file controls
   (collapse, copy filename, mark viewed locally); display prefs + viewed flags
   persisted client-side.
6. ✅ **End-to-end** against real diffs — resolved hunks match `git diff`
   exactly (the point of reference-not-reproduce).

"Expand full file" (Phase 1) shipped in plan 015 — the viewer fetches
`/api/file-content` and renders the whole file via `@pierre/diffs`' full-file
path (`parseDiffFromFile` → `<FileDiff expandUnchanged>`); see
`docs/DESIGN-expand-full-file.md`. Still open: "N unmodified lines" expanders
*between* hunks, and rename base-side expansion (needs an endpoint allowlist change).

**Multi-harness support ✅ shipped** (post-Phase 1): standalone MCP mode
(`--standalone[=blocking]` server flag) where `submit_review` itself validates +
captures + serves — detached (returns the viewer URL immediately; viewer lives
in the MCP process) or blocking (Codex + `tool_timeout_sec`). Session lifecycle extracted
to `src/server/session.ts` (shared with the hook); agent schema gained optional
`cwd`; per-harness configs + ported prompts in `integrations/` (Cursor, VS Code
Copilot, Codex); setup guide in `docs/HARNESSES.md`.

**Viewer & feedback polish ✅ shipped** (post-Phase 1, v0.4.0): noise/generated files
resolved into their own "Generated & noise files" chapter (`src/server/noise.ts`) instead
of diluting the narrative; per-chapter review progress on the overview; a keyboard layer
(`src/ui/src/lib/shortcuts.ts` — catalog + one document listener, `?` cheatsheet dialog);
copy-as-Markdown for the whole review or one chapter (`src/ui/src/lib/reviewMarkdown.ts`,
narrative + inventory only, never hunk bytes); and the **agent feedback loop** —
`resolutionNotesMessage` in `src/server/session.ts` hands the resolver's warnings back
through the hook's `hookSpecificOutput.additionalContext` (Claude Code) or the tool-result
text (standalone), capped so it can't flood the agent's context.

**Theme & font picker ✅ shipped** (post-Phase 1): the toolbar's Theme toggle became a
"Theme & font" popover — color mode, a light and a dark syntax theme (all 69 themes
`@pierre/diffs` can render; catalog in `packages/viewer/src/appearance.ts`), and the code
font (JetBrains Mono by default, 7 more free OFL fonts self-hosted in
`packages/viewer/src/fonts/`, or the system monospace) with size + ligature controls and a
live preview; GitHub themes and JetBrains Mono stay the defaults. Keyboard shortcuts now
skip keys a dialog/popover already handled (`preventDefault`), so Esc closes the overlay
without also leaving the chapter.

## Phase 2 — Progress & round-trip

- Persist viewed state (files/chapters) → `POST /api/file-viewed`; reflect in
  the chapter list.
- Verdict submission: `POST /api/feedback`; hook returns
  `permissionDecision: "deny"` with annotations as `permissionDecisionReason`
  so the agent acts on feedback. "Collapse all files" control.

## Phase 3 — Collaboration & integration

- GitHub: open PR, copy branch, author/open-time/base/head/CI via `gh`. Activity
  view, Chat, add reviewers, draft/status indicator.

## Phase 4 — Conversational assistant

- In-context AI agent (`/api/ai/*`) for questions within the PR context.

## Open questions (still open)

- **Runtime grammar serving (future optimization):** the committed artifact
  carries ~9.9 MB of Shiki grammar chunks. If repo size ever hurts, externalize
  them and serve from the installed `shiki` package at runtime (users run
  `bun install` anyway), committing only the ~870 KB core. Deferred as fragile
  build-surgery not worth the cost today — see `docs/DESIGN-prebuilt-distribution.md`.

Settled since planning: stack = Bun + `@pierre/diffs`/Shiki; distribution =
Claude Code plugin marketplace with a **committed prebuilt viewer** (plan 016 —
multi-file `src/ui/dist/`, chosen over `vite-plugin-singlefile` because the
grammar payload made a single file ~9.9 MB and our own server already serves the
`assets/*` chunks); diff base = worktree/pr/branch `source` routing;
viewed-state key = per `(chapter, file)`.

## Reference files in Plannotator (`~/code/plannotator`)

- `apps/hook/hooks/hooks.json` — hook wiring.
- `packages/server/review.ts` — `/api/diff`, `/api/file-content`, `/api/feedback`.
- `apps/review/vite.config.ts` — single-file bundling.
- `packages/review-editor/` — diff viewer, file tree, split-pane.
