# Using Review Buddy outside Claude Code

Review Buddy started Claude Code-only because its transport leaned on two
Claude-specific mechanisms: a plugin-bundled MCP tool and a `PreToolUse` hook
that intercepts the tool call, renders the review, and **blocks** the agent's
turn until the human is done. Other harnesses have no `PreToolUse` equivalent —
but they all speak MCP, so the same MCP server now has a **standalone mode**
where `submit_review` itself does what the hook does: validate the payload,
capture the authoritative diff, serve the viewer, and open the browser.

```
Claude Code   : submit_review ──PreToolUse hook──> capture + serve + BLOCK ──> ack
Standalone    : submit_review ───────────────────> capture + serve ──> returns URL
                (viewer keeps running inside the long-lived MCP server process)
```

## Why standalone mode doesn't block (except on Codex)

A human review takes minutes to hours; a tool call gets nowhere near that:

| Harness | MCP tool-call budget |
|---|---|
| Cursor | cancels MCP requests after ~5 minutes (not configurable) |
| VS Code Copilot | not configurable; cancellations reported around 60 s |
| Codex | `tool_timeout_sec` per server (default 60 s, raise as needed) |

So standalone mode defaults to **detached**: `submit_review` returns the viewer
URL immediately and the review server keeps running inside the MCP server
process (which lives as long as your editor session). Submitting a new review
supersedes the previous one. There is no verdict round-trip in detached mode —
it's the Phase 1 one-way viewer.

On Codex you can opt into **blocking** mode (`--standalone=blocking` plus a
large `tool_timeout_sec`): the tool call holds the turn and returns the
reviewer's verdict — including "request changes" notes — straight to the agent.

## Mode selection (server command flag)

The mode is a **CLI flag on the MCP server command**, deliberately not an env
var: env is ambient, and a globally exported variable would leak into the
Claude Code plugin's MCP server — where the hook has already served the review
— and open every review twice.

| Server args | Behavior |
|---|---|
| *(no flag)* | Claude Code mode: handler is an ack; the hook does the work |
| `--standalone` | Detached: capture + serve + open browser, return URL immediately |
| `--standalone=blocking` | Same, but await the reviewer's verdict before returning |

`REVIEW_BUDDY_CWD` — repo root fallback when the agent doesn't pass `cwd`
(VS Code can set it to `${workspaceFolder}`). Resolution order for the repo:
the review's `cwd` field → `REVIEW_BUDDY_CWD` → the MCP server's own cwd.
Whichever wins must be inside a git work tree.

The env vars (`REVIEW_BUDDY_BASE`, `REVIEW_BUDDY_NO_OPEN`,
`REVIEW_BUDDY_ROUNDTRIP`, `REVIEW_BUDDY_MODEL`) work the same in every mode,
with one exception: `--standalone=blocking` forces the verdict UI on (no need
to also set `REVIEW_BUDDY_ROUNDTRIP`) — returning the verdict is the mode's
purpose.

## Prerequisites (all harnesses)

- [Bun](https://bun.sh) ≥ 1.3 on your PATH (runs the MCP server and viewer).
- A clone of this repo. Nothing to install or build: the MCP server ships
  prebuilt as `dist/server.js` (all dependencies inlined) and the viewer as
  `src/ui/dist/`. Older configs point at `src/mcp/server.ts`;
  they keep working in a clone where you ran `bun install`, but switch them to
  `dist/server.js`.
- `gh` CLI authenticated if you want PR reviews (`source.type = "pr"`).

## Cursor

1. Merge `integrations/cursor/mcp.json` into `.cursor/mcp.json` (project) or
   `~/.cursor/mcp.json` (global), fixing the absolute path.
2. Copy `integrations/cursor/commands/review-buddy.md` into `.cursor/commands/`
   (project) or `~/.cursor/commands/` (global).
3. In chat: `/review-buddy` (optionally followed by a PR number/URL or base ref).

## VS Code + GitHub Copilot (agent mode)

1. Save `integrations/vscode-copilot/mcp.json` as `.vscode/mcp.json`, fixing the
   absolute path. `REVIEW_BUDDY_CWD: "${workspaceFolder}"` makes the repo
   location robust even if the model omits `cwd`.
2. Copy `integrations/vscode-copilot/prompts/review-buddy.prompt.md` into
   `.github/prompts/`.
3. In Copilot Chat (agent mode): `/review-buddy`. Note: prompt files work in
   VS Code / Visual Studio / JetBrains — the Copilot CLI doesn't support custom
   slash commands yet.

## Codex (CLI / IDE extension)

1. Merge `integrations/codex/config.toml` into `~/.codex/config.toml`, fixing
   the absolute path. For verdict round-trip, use the `blocking` variant in
   that file's comments.
2. Copy `integrations/codex/prompts/review-buddy.md` into `~/.codex/prompts/`.
3. In Codex: `/review-buddy` (arguments become `$ARGUMENTS`).

## How the pieces map

| Claude Code | Cursor | VS Code Copilot | Codex |
|---|---|---|---|
| plugin MCP server | `.cursor/mcp.json` | `.vscode/mcp.json` | `~/.codex/config.toml` |
| `/review` skill | `.cursor/commands/review-buddy.md` | `.github/prompts/review-buddy.prompt.md` | `~/.codex/prompts/review-buddy.md` |
| `PreToolUse` hook (blocks) | standalone detached | standalone detached | standalone detached or blocking |
| hook event `cwd` | agent-passed `cwd` | `cwd` or `${workspaceFolder}` | agent-passed `cwd` |

Two behavioral differences vs Claude Code to be aware of:

- **Schema enforcement**: Claude Code validates the tool input against
  `packages/core/schemas/review.schema.json` before the call; other harnesses may not, so the
  standalone handler validates itself and returns the reason as a tool error
  for the model to fix and retry.
- **Turn semantics**: in detached mode the agent's turn continues immediately —
  the prompt tells it to relay the viewer URL and stop. Only Claude Code (hook)
  and Codex-blocking hold the turn during the human review.
