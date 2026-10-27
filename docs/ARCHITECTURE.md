# Architecture

How the PRD's product requirements map onto a concrete, buildable system. Read `CLAUDE.md` first for the high-level decisions; this doc is the engineering detail. For a visual walkthrough of the same system, open [`architecture.html`](./architecture.html) in a browser (hand-maintained — keep it in sync with this doc).

> This doc describes the Claude Code flow (hook-driven, blocking). In other harnesses (Cursor / VS Code Copilot / Codex) the same MCP server runs in **standalone mode**: no hook — `submit_review` itself does the capture → merge → serve steps below and returns the viewer URL immediately. See [`HARNESSES.md`](./HARNESSES.md).

## Data flow

```
┌─────────────┐   /review (skill + structuring prompt)
│ Claude Code │ ───────────────────────────────────────────┐
│   agent     │                                             │
└─────────────┘   agent calls submit_review(<review JSON>)  │
        │                                                   ▼
        │                                   ┌──────────────────────────────┐
        │   PreToolUse hook matches         │ MCP server (review-buddy)     │
        └─► mcp__plugin_…__submit_review     │ exposes submit_review tool     │
                                            └──────────────────────────────┘
                                                          │
                                  hook command (blocks the turn, long timeout)
                                                          │
                  ┌───────────────────────────────────────┼───────────────────────────────────────┐
                  ▼                                         ▼                                         ▼
        A. agent review JSON                  B. git diff + gh metadata                  C. full files (git show)
        (prologue + chapters + anchors)       (authoritative hunks, PR desc, author)     (on demand, for expansion)
                  └───────────────────────────────────────┴───────────────────────────────────────┘
                                                          │
                                          merge → start local HTTP server
                                                          │
                                                  open browser
                                                          │
                                        ┌─────────────────────────────┐
                                        │ Prebuilt React app           │
                                        │ GET /api/review → render     │
                                        │ GET /api/file-content → expand│
                                        └─────────────────────────────┘
```

## Why reference-not-reproduce (the load-bearing rule)

The structuring prompt's original output format had the agent transcribe diff line content into JSON (`hunks[].lines: ["+...", "-..."]`). We rejected this:

- **Correctness:** LLMs alter whitespace, drop lines, and miscount `old_start`/`new_start`. The rendered diff would silently diverge from the real code — directly violating the PRD's #1 risk ("traceable to actual diff hunks, never fabricate changes").
- **Cost/latency:** echoing every diff line roughly doubles output tokens for zero added judgment.
- **Capability:** "expand full file" and word-level intra-line highlighting are *impossible* from hunks alone — they need full file contents (C) and the authoritative diff (B).

**Therefore:** the agent emits narrative + grouping + hunk **anchors** only. The tool parses the real `git diff` and maps hunks onto chapters by `path` + anchor. The tool computes all stats. The agent does what it is good at (judgment); git provides the bytes.

## Server endpoints

### Phase 1
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/review` | GET | The merged review: `{ meta, pr, prologue, chapters, stats }` (A + B + computed). Chapters' hunks are **resolved** here (real content from B). |
| `/api/file-content` | GET | Full file for expansion / word-level context (`?path=&side=base\|head`). Source C. |
| `/api/done` | POST | Reviewer closes the viewer; unblocks the hook (one-way: returns `allow`). |

### Later phases
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/file-viewed` | POST | Persist per-file/chapter viewed state (round-trip). |
| `/api/feedback` | POST | Submit verdict + annotations; hook returns `deny` + feedback to agent. |
| `/api/github/*` | — | Open PR, copy branch, CI status, reviewers (via `gh`). |
| `/api/ai/*` | — | In-context conversational assistant. |

**Round-trip design + spike:** see [`DESIGN-roundtrip.md`](./DESIGN-roundtrip.md). The Phase 2 verdict path is spiked (behind `REVIEW_BUDDY_ROUNDTRIP=1`) by carrying `{ verdict, summary }` on the existing **`POST /api/done`** — the hook returns `deny` + the summary as `permissionDecisionReason` — with **`GET /api/config`** exposing the flag to the client. The richer `/api/feedback` (per-line annotations) and `/api/file-viewed` remain the real Phase 2 build; the design doc is their brief.

## Hook design

- Plugin `hooks.json` registers a **`PreToolUse`** hook. A plugin-bundled MCP server names its tools `mcp__plugin_<plugin>_<server>__<tool>`, so the real tool name is `mcp__plugin_review-buddy_review-buddy__submit_review` (a user-configured `.mcp.json` server would instead use `mcp__review-buddy__submit_review`). The matcher is an alternation covering both forms. See `examples/hooks.json` and [the MCP docs](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers).
- The hook command receives the tool call on stdin: `{ tool_name, tool_input: <review JSON>, cwd, session_id, transcript_path, permission_mode }`.
- **The hook re-captures the diff (source B) — and must capture the SAME one the agent reviewed.** It never sees `/review`'s arguments, so the agent's payload carries a `source`: `worktree` (default → `git diff HEAD`), `pr` → `gh pr diff <ref>`, or `branch` → `git diff <ref>`. Without this a PR review would re-run the local `git diff HEAD` (usually empty, since the PR branch isn't checked out) and the viewer would render zero hunks. See `localGitSource` in `packages/core/src/node/local-source.ts` (an implementation of the `ReviewDataSource` interface, `packages/core/src/source.ts`).
- It reads files on demand (C), starts the server, opens the browser, and **blocks** until `/api/done` (long timeout, e.g. `345600`).
- **Phase 1 return:** `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }` (the review was informational; let the agent proceed).
- **Later (round-trip):** return `permissionDecision: "deny"` with the human's annotations as `permissionDecisionReason`, so the agent acts on the feedback.

Why `PreToolUse` over `PermissionRequest`: `PreToolUse` always fires; `PermissionRequest` is skipped when the tool is auto-allowed by a permission rule. Both can block and modify input, but for a guaranteed gate `PreToolUse` is safer.

## Validation strategy

Define the `submit_review` MCP tool's `inputSchema` = `packages/core/schemas/review.schema.json`. Claude Code validates the tool call against it and makes the model retry on mismatch — so malformed/truncated review JSON is caught before the hook ever runs. This is a concrete advantage of the tool-call transport over file/stdout.

## Diff & rendering notes

- **Parsing:** parse the unified diff from `git diff` into files → hunks (with exact `@@` headers and line numbers). Assign each hunk to a chapter by matching `path` + the agent's anchor. A hunk with no chapter match → bucket into a synthetic "Unsorted" chapter (and log it) rather than dropping it.
- **Word-level:** intra-line highlights are computed client-side by `@pierre/diffs`. Never expect this from the agent.
- **Collapse / expand:** the diff view shows changed hunks + a few context lines by default; "N unmodified lines" expanders and "expand full file" call `/api/file-content`.
- **Syntax highlighting:** derive language from the file extension (`path`); highlight client-side with Shiki (`shiki-js`, via `@pierre/diffs`).
- **Distribution:** the viewer is **prebuilt and committed** to `src/ui/dist/` (served by the hook's `uiDir()`), so `/plugin install` needs no build step. Shipped as the multi-file build (not single-file) because Shiki's grammars are ~9.9 MB of lazy chunks and the server already serves `assets/*`; kept reproducible + fresh by `verify:dist-fresh`. See [`DESIGN-prebuilt-distribution.md`](./DESIGN-prebuilt-distribution.md).
- **Multi-chapter files:** viewed-state is keyed by `(chapterIndex, path)`, so the same file can appear in multiple chapters with independent viewed flags (shipped in the viewer's client-side state).

## Client-side state (source D)

Display settings (theme, layout, granularity, wrap, line numbers, backgrounds, minimize) and — in the persistence phase — viewed flags live in the browser (cookies/localStorage), because the server runs on an ephemeral port per review (Plannotator pattern).

## Performance (large PRs)

- Resolve hunks lazily or paginate chapters if a PR is huge.
- `/api/file-content` is on-demand; never inline full files into `/api/review`.
- Consider a max-diff guard with graceful messaging.
