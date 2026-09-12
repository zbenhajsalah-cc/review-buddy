# Harness integrations

`agent-plugin/` holds the authoring input for the portable [Agent Plugins](https://agent-plugins.org)
package — `plugin.json`, `mcp.json`, and the `review-buddy` skill that replaced
the old per-harness MCP configs and copied prompts (Cursor `.cursor/mcp.json` +
command, VS Code `.vscode/mcp.json` + prompt, Codex `config.toml` + prompt;
removed after the migration — see the previous release's `integrations/` tree
for them).

`agent-plugin/` alone is **not** installable — it lacks the runtime and viewer.
`bun run build:plugin` (`scripts/build-agent-plugin.ts`) assembles the
self-contained package into `dist/agent-plugin/review-buddy/` (bundled server,
vendored `zod`, committed viewer, review schema, dependency notices) plus a
`review-buddy-<version>.tar.gz` + `.sha256` for release attachment.

Install/migration instructions: [`../docs/HARNESSES.md`](../docs/HARNESSES.md).
Design rationale: [`../docs/PLAN-agent-plugins.md`](../docs/PLAN-agent-plugins.md).

> When you change `skills/review/SKILL.md`'s Steps 1–3 or Critical rules (the
> structuring-prompt source of truth), port the change into
> `agent-plugin/skills/review-buddy/SKILL.md` — there is no generator anymore.
