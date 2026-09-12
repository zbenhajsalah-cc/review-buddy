# Review Buddy — Agent Plugin

AI-assisted **narrative code review**: an agent reads your diff, writes a
Prologue, and segments the work into risk-rated Chapters you walk through in a
browser-based diff viewer.

This directory is the [Agent Plugins](https://agent-plugins.org) authoring
input — the portable equivalent of the old per-harness `mcp.json` + prompt
files. It is **not** the installable package by itself: the MCP server runtime
and the prebuilt viewer are assembled into it by
`bun run build:plugin`, which emits `dist/agent-plugin/review-buddy/` — a
self-contained directory you can hand to any Agent Plugins–conformant client.

## What's in the package

| File | Purpose |
| --- | --- |
| `plugin.json` | Agent Plugins manifest (name, version, metadata) |
| `mcp.json` | `review-buddy` stdio server: `bun run ${PLUGIN_ROOT}/src/mcp/server.js --standalone` |
| `skills/review-buddy/SKILL.md` | The structuring prompt — source of truth for the non-Claude review instructions |
| `src/mcp/server.js` | The MCP runtime, bundled for Bun (`zod` vendored, everything else inlined) |
| `src/ui/dist/` | The prebuilt viewer (also shipped by the Claude Code plugin) |
| `schemas/review.schema.json` | The `submit_review` input schema the server loads at startup |
| `package.json` | Runtime metadata (the server reads `version` from it) |
| `THIRD_PARTY_NOTICES` | License texts for bundled/vendored dependencies |

## Runtime contract

- `submit_review` runs in **standalone detached** mode: it captures the real
  `git diff` at the `cwd` the agent passes, resolves chapter anchors onto the
  real hunks, serves the viewer on `127.0.0.1`, opens the browser, and returns
  the URL immediately. The viewer lives inside the MCP server process; a new
  `submit_review` supersedes the previous one.
- The agent's `cwd` field is load-bearing: the MCP process's working directory
  is the plugin root, not your repository. The skill instructs the agent to
  pass `git rev-parse --show-toplevel`.
- No network access, no package installation, and no writes into the install
  directory are needed at runtime. `git` is required; `gh` is needed only for
  `source.type = "pr"` reviews.

See `docs/HARNESSES.md` for per-client install steps and the blocking-mode
(`--standalone=blocking`) override.
