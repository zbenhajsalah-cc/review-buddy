# Harnesses

Running Review Buddy outside Claude Code: one portable **Agent Plugin** that
any conformant client (Cursor, VS Code Copilot, Codex) loads — instead of the
old per-harness `mcp.json` + copied prompt files.

> For the Claude Code plugin (the `PreToolUse` hook + `/review` skill), see
> `README.md` — it is a separate package and unchanged by anything here.

## What the plugin is

`integrations/agent-plugin/` in this repo is the authoring input;
`bun run build:plugin` assembles the installable directory into
`dist/agent-plugin/review-buddy/`:

| Piece | What it does |
| --- | --- |
| `plugin.json` | Agent Plugins 1.0 manifest (`name: "review-buddy"`) |
| `mcp.json` | registers the `review-buddy` MCP server: `bun run ${PLUGIN_ROOT}/src/mcp/server.js --standalone` |
| `skills/review-buddy/` | the structuring prompt — the portable equivalent of `/review` |
| `src/mcp/server.js` + `node_modules/zod/` | the MCP runtime, self-contained (no install step) |
| `src/ui/dist/` | the same prebuilt viewer the Claude Code plugin serves |

`--standalone` means **detached**: `submit_review` itself captures the real
`git diff`, resolves the agent's chapter anchors onto the real hunks, serves
the viewer on `127.0.0.1`, opens the browser, and **returns the URL
immediately** — because Cursor cancels MCP calls at ~5 min and VS Code
Copilot's tool timeout is unconfigurable; a human review can't fit inside a
tool call. The viewer lives inside the long-lived MCP server process; a new
`submit_review` supersedes the previous one, and the server stops the viewer
when the client disconnects.

**Prerequisites:** `bun` and `git` on `PATH`; `gh` (authenticated) only for
PR reviews. Nothing else — the package carries its own dependencies.

## Install

**Get the package** — either way produces the `review-buddy/` directory:

- From a clone: `bun install && bun run build:plugin` → `dist/agent-plugin/review-buddy/`
- From a release: download `review-buddy-<version>.tar.gz` from the GitHub
  release and extract it (`shasum -a 256 -c review-buddy-<version>.tar.gz.sha256`
  to verify).

**Enable it in your client:**

| Client | Install path |
| --- | --- |
| Cursor | Copy the `review-buddy/` directory into your [local plugin location](https://cursor.com/docs/plugins) and reload; the skill and MCP server should appear together. Cursor loads Agent Plugins natively. |
| VS Code Copilot | Register the directory through the [`chat.pluginLocations`](https://code.visualstudio.com/docs/agent-customization/agent-plugins) setting, then confirm the skill + MCP server are discovered. |
| Codex | Codex maps a root `plugin.json` into its plugin manifest (skills + `mcp.json`). Place the directory where your Codex version loads plugins and confirm the skill + server appear. |

> **Verify before relying on it:** after enabling, ask the client to list its
> MCP tools — `submit_review` must appear — and check that the `review-buddy`
> skill is discoverable. Exact menus vary by client version; if your version
> lacks an Agent Plugins loader, see the legacy fallback below.

## Using it

Invoke the review skill the way your client surfaces skills (slash command,
skill picker, or just asking for a review), optionally naming the target:

- nothing → the local working tree
- a PR number/URL → `gh pr diff <ref>` (requires `gh` auth)
- a base branch/ref → `git diff <base>`

The agent resolves your repo root (`git rev-parse --show-toplevel`) and passes
it as `cwd` to `submit_review` — **this field is load-bearing**: the MCP
server's working directory is the plugin install dir, not your project. If the
agent skips it, the server refuses rather than risk reviewing the wrong repo
(or replies that it can't find the repo — same fix: pass `cwd`).

The tool returns the review URL immediately. The review walks Prologue →
risk-rated Chapters in your browser; the agent gets resolution notes back if
any anchors missed, so a second submit fixes them.

## Blocking mode (verdict round-trip)

The portable `mcp.json` can't express a client-side tool timeout, so it ships
detached only. `--standalone=blocking` still exists in the runtime: the tool
call holds until the reviewer finishes and returns their verdict (including a
**request changes** note the agent can act on). To use it, register the
server natively instead of via the plugin — e.g. Codex:

```toml
# ~/.codex/config.toml
[mcp_servers.review-buddy]
command = "bun"
args = ["run", "/absolute/path/to/review-buddy/src/mcp/server.js", "--standalone=blocking"]
# the plugin's detached mode returns instantly; blocking needs a long timeout
tool_timeout_sec = 345600
```

and keep the plugin's skill available for the prompt (or keep the old
`~/.codex/prompts/review-buddy.md` prompt — see legacy below).

## Environment variables

Resolution order for the repo directory: the review's `cwd` field →
`REVIEW_BUDDY_CWD` → the MCP server's own cwd (which, under a plugin install,
must not resolve to the repo hosting the package — the server refuses rather
than review the wrong thing). `REVIEW_BUDDY_CWD` is the escape hatch for
clients that can inject the workspace path into `env`.

`REVIEW_BUDDY_BASE` (custom worktree base), `REVIEW_BUDDY_NO_OPEN` (don't open
a browser), `REVIEW_BUDDY_ROUNDTRIP` (verdict UI outside blocking mode), and
`REVIEW_BUDDY_MODEL` work the same in every mode.

## Migrating from the manual setup

Earlier versions registered the server with hand-copied files:

- `.cursor/mcp.json` + `.cursor/commands/review-buddy.md`
- `.vscode/mcp.json` + `.github/prompts/review-buddy.prompt.md`
- `~/.codex/config.toml` + `~/.codex/prompts/review-buddy.md`

To migrate: **disable/remove the old `review-buddy` MCP registration and the
copied prompt**, then enable the plugin — otherwise the server and the review
command appear twice. Leave other MCP entries alone. Rollback: disable the
plugin and restore the old registration (the last pre-plugin release's
`integrations/` tree still has the files — see the repo's tagged releases).

## Legacy fallback (clients without Agent Plugins support)

If your client can't load Agent Plugins, the old mechanism still works and is
the same server: register `bun run <repo>/src/mcp/server.ts --standalone` (or
`--standalone=blocking` where the client supports a long tool timeout) as a
stdio MCP server from a local clone (`bun install` first), and copy the
review prompt from the previous release's `integrations/` tree. The runtime,
schema, and viewer are identical — only the packaging differs.
