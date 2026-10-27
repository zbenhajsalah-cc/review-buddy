# Review Buddy

An AI-assisted **narrative code review** tool for Claude Code. Instead of showing a pull request as one flat diff, an agent reads the changes, writes a high-level **Prologue**, and segments the work into risk-rated thematic **Chapters** that a reviewer walks through sequentially in a browser UI.

> **Status:** Phase 1 shipped (one-way viewer): the `submit_review` MCP tool, the `PreToolUse` hook, a hardened loopback-only HTTP server, and the React viewer are all live with tests green. See `README.md` for install/dev and `docs/build-plan.md` for what's deferred to Phases 2–4.

## What it does (target flow)

```
User runs /review (skill with the structuring prompt)
        ↓
Agent reviews the diff/PR, then calls the custom tool  submit_review(<review JSON>)
        ↓
Claude Code PreToolUse hook matches  mcp__plugin_review-buddy_review-buddy__submit_review
        ↓
Hook command: capture git diff + PR metadata, start a local server, open the browser
        ↓
Prebuilt React app loads → GET /api/review → renders Prologue + Chapters + diffs
```

**Standalone (Cursor / VS Code Copilot / Codex):** same flow, but there is no `PreToolUse` — the MCP server runs with the `--standalone` flag and `submit_review` itself does the capture + serve, returning the viewer URL immediately (the viewer lives inside the long-lived MCP process). See `docs/HARNESSES.md`.

This mirrors how Plannotator (`~/code/plannotator`, the inspiration) intercepts `ExitPlanMode` — except here we intercept **our own** MCP tool, because there is no built-in "review" tool.

## The decisions that shape everything (already made — do not re-litigate)

1. **Claude Code first; other harnesses via standalone MCP mode.** Claude Code gets the richest flow (hook blocks the turn). Cursor / VS Code Copilot / Codex reuse the SAME MCP server launched with the `--standalone` flag (a flag, not an env var — ambient env would leak into the Claude Code plugin's server and double-open reviews): `submit_review` itself captures + serves and returns the viewer URL immediately — their MCP tool-call timeouts (Cursor ~5 min hard, Copilot unconfigurable) can't hold a human review; Codex can opt into `--standalone=blocking` paired with `tool_timeout_sec`. See `docs/HARNESSES.md` + `integrations/`.
2. **Transport = custom MCP tool + `PreToolUse` hook** (Claude Code). The agent calls `submit_review(...)`; a `PreToolUse` hook intercepts it (chosen over `PermissionRequest` because `PreToolUse` always fires, even in auto-accept modes). The hook **blocks** the turn (long timeout) while the human reviews.
3. **One-way viewer first**, round-trip to the agent later. Build/test rendering first; keep the blocking hook so round-trip is a drop-in later (swap the "Done" response for "approve / request-changes + annotations").
4. **JSON = runtime state, served over REST.** One prebuilt React app fetches the review from a local server (`GET /api/review`). No per-review codegen/compile. (Plannotator's model.)
5. **The agent REFERENCES the diff; it does NOT reproduce it.** This is load-bearing — see below.

## The three data sources (critical mental model)

The agent's JSON is only the **narrative layer**. The UI needs three sources:

| Source | Provides | Origin |
|---|---|---|
| **A. Agent review JSON** | prologue, chapters, risk, descriptions, chapter→file grouping, hunk **anchors** | the `submit_review` tool call |
| **B. Real diff + PR metadata** | authoritative hunk content + line numbers, original PR description, author, base/head, CI | `git diff` / `gh`, run by the hook (cwd is local) |
| **C. Full file contents** | bytes *around* the diff, for expansion + word-level highlighting | `git show` / working tree, fetched on demand |

**Reference-not-reproduce rule:** the agent must NOT echo diff line content into JSON (LLMs corrupt whitespace, drop lines, miscount line numbers, and it doubles token cost — and it fights the PRD's own #1 risk: "never fabricate changes"). Instead the agent emits, per chapter, the file paths + hunk **anchors** (`old_start` / `new_start`). The tool parses the authoritative `git diff` (source B) and maps each real hunk onto a chapter by path+anchor. Hunk-level anchors also let one file span multiple chapters. The tool recomputes all stats (additions/deletions/file counts) from the real diff — treat agent-provided stats as advisory only.

See `docs/review-contract.md` for the exact **agent contract** vs **UI/server contract**, `packages/core/schemas/review.schema.json` for the `submit_review` input schema, and `packages/core/src/types.ts` for the TypeScript types.

## Repo map

```
review-buddy/
├── CLAUDE.md                  # you are here — orientation + decisions
├── README.md                  # human overview: install, dev, status
├── .claude-plugin/marketplace.json # marketplace; plugin "source": "./apps/plugin"
├── apps/plugin/               # the Claude Code plugin + standalone MCP server — SELF-CONTAINED (installs copy only this folder)
│   ├── .claude-plugin/plugin.json # plugin manifest
│   ├── bin/review-buddy.js    # plugin entry shim → dist/hook.js
│   ├── dist/                  # COMMITTED plugin bundles: server.js (MCP) + hook.js (hook/CLI); `pnpm build:plugin`
│   ├── hooks/hooks.json       # the real PreToolUse hook wiring
│   ├── skills/review/SKILL.md # the /review skill — the structuring prompt (source of truth)
│   ├── src/mcp/server.ts      # MCP server exposing submit_review (+ standalone dispatch)
│   ├── src/mcp/standalone.ts  # non-Claude harnesses: submit_review does capture+serve itself
│   ├── src/cli/index.ts       # PreToolUse hook entry (open-review)
│   ├── src/server/            # session lifecycle, local HTTP server, browser open
│   ├── ui/                    # Vite entry: <ReviewViewer api={httpReviewApi} /> (token auth); COMMITTED build in ui/dist
│   ├── integrations/          # Cursor / VS Code Copilot / Codex MCP configs + GENERATED review prompts
│   ├── examples/hooks.json    # example plugin hook config (installed-binary form)
│   └── scripts/               # build-plugin.ts (bundles → dist/), smoke-plugin.ts (runs apps/plugin alone)
├── apps/desktop/              # Electron desktop app (in progress, see apps/desktop/README.md): main (window, app:// + CSP, IPC), preload (window.reviewBuddy), renderer (<ReviewViewer api={ipcReviewApi} />)
├── packages/core/             # @review-buddy/core — runtime-neutral (no Bun/Node/DOM APIs; its typecheck enforces it)
│   ├── src/types.ts           # shared agent + UI/server contracts
│   ├── src/diff.ts            # git diff parser
│   ├── src/resolve.ts         # chapter resolution (anchors → real hunks) + file allowlist
│   ├── src/noise.ts           # generated/noise file heuristic
│   ├── src/validate.ts        # zod backstop for the agent payload
│   ├── src/messages.ts        # agent-facing feedback text (resolution notes, request-changes)
│   ├── src/meta.ts            # review meta
│   ├── src/source.ts          # ReviewDataSource: where the diff, PR metadata, and file bytes come from
│   ├── src/viewer-csp.ts      # VIEWER_CSP: the one CSP for every app that shows the viewer (plugin server, desktop renderer)
│   ├── src/node/              # Node-only (no Bun APIs): git/gh capture + LocalGitSource; own tsconfig.node.json
│   ├── schemas/review.schema.json # JSON Schema = submit_review inputSchema
│   └── prompts/               # review-template.md (ONE template, {{#standalone}}/{{#desktop}} blocks) → `pnpm gen:prompts` → integration prompts + review-desktop.md
├── packages/viewer/           # @review-buddy/viewer — the review UI (React 19 + Tailwind v4 + @pierre/diffs), no app shell
│   ├── src/ReviewViewer.tsx   # <ReviewViewer api /> — validates the review, overview ↔ chapters
│   ├── src/review-api.tsx     # ReviewApi (reviewKey, getReview, getFileContent, getConfig, done) + context; HTTP in the plugin, IPC in desktop
│   ├── src/theme.css          # tokens + base styles; each app's CSS imports it AND adds `@source` for packages/viewer/src
│   └── src/stories/fixtures.ts # fixtures + fakeReviewApi() for stories and tests
├── docs/
│   ├── PRD.md                 # product requirements (source of truth for UX)
│   ├── ARCHITECTURE.md        # data sources, flow, hook+server, endpoints, phasing
│   ├── HARNESSES.md           # running Review Buddy in Cursor / Copilot / Codex
│   ├── review-contract.md     # agent contract vs UI/server contract + examples
│   └── build-plan.md          # shipped/deferred ledger + phased breakdown
└── scripts/                   # release.sh (version bump across files + release), gen-prompts.ts
```

**Workspace:** pnpm installs (`pnpm-workspace.yaml`: `packages/*`, `apps/*`, `apps/plugin/ui`); Bun runs the plugin and the tests. **Installed plugins run the committed bundles in `apps/plugin/dist/`** (`server.js`, `hook.js`; core, zod and the MCP SDK inlined) — no `node_modules`, no auto-install, and nothing outside `apps/plugin` (Claude Code copies only the marketplace `source` folder). After changing plugin or core source, run `pnpm build:plugin` and commit `apps/plugin/dist/` (CI's `verify:dist-fresh` fails otherwise; `pnpm smoke:plugin` copies `apps/plugin` alone and runs the bundles with auto-install disabled). The plugin source imports `@review-buddy/core` through a `workspace:*` dev dependency; it is only needed to build and test. The viewer uses **relative imports** (not `@/`), because each app builds its source with the app's own Vite config; it never fetches by itself — data comes from the `ReviewApi` the app passes in. See `docs/DESIGN-desktop-app-shared-code.md` and `docs/backlog-desktop-app.md`.

## Phase 1 (shipped)

Prologue + Description overview, chapter list, chapter review split-pane, and the diff viewer (unified/split, display settings, collapse "N unmodified lines", word-level granularity), with per-file controls (collapse / copy name / **expand full file** / mark viewed locally). "Expand full file" wires `/api/file-content` into the viewer via `@pierre/diffs`' full-file render path (`parseDiffFromFile` → `<FileDiff expandUnchanged>`); see `docs/DESIGN-expand-full-file.md`. Still open: "N unmodified lines" expanders *between* hunks, and rename base-side expansion (needs an endpoint allowlist change).

Since then (still Phase 1): generated/noise files are set aside in their own chapter
rather than diluting the narrative; the overview shows per-chapter review progress; the
viewer is keyboard-driven (`?` opens the cheatsheet) and `c` copies the review or the
current chapter as Markdown (narrative + file inventory only — the reference-not-reproduce
rule applies to the clipboard too); and **resolution notes now travel back to the agent**
(hook `additionalContext` on Claude Code, tool-result text standalone) so a review whose
anchors missed can be corrected next time.

**Deferred to later phases** (per PRD): viewed-state persistence round-trip, verdict submission, GitHub collaboration (open PR, copy branch, reviewers, CI), Activity view, Chat, conversational AI assistant.

## Reference implementation

Plannotator at `~/code/plannotator` solves nearly the same problems. Useful files to mine:
- `apps/hook/hooks/hooks.json` — hook wiring pattern.
- `packages/server/review.ts` — review server + endpoints (`/api/diff`, `/api/file-content`, `/api/feedback`).
- `apps/review/vite.config.ts` — single-file HTML bundling (`vite-plugin-singlefile`).
- `packages/review-editor/` — diff viewer, file tree, split-pane UI.
