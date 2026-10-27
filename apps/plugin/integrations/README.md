# Harness integrations

Ready-to-copy MCP configs and review prompts for running Review Buddy outside
Claude Code. Setup instructions: [`docs/HARNESSES.md`](../../../docs/HARNESSES.md).

```
cursor/mcp.json                          → merge into .cursor/mcp.json
cursor/commands/review-buddy.md          → copy into .cursor/commands/
vscode-copilot/mcp.json                  → save as .vscode/mcp.json
vscode-copilot/prompts/review-buddy.prompt.md → copy into .github/prompts/
codex/config.toml                        → merge into ~/.codex/config.toml
codex/prompts/review-buddy.md            → copy into ~/.codex/prompts/
```

> **Generated files — don't edit the three prompts by hand.** They are emitted
> from the shared template, `packages/core/prompts/review-template.md`, by
> `pnpm gen:prompts` (varying only frontmatter, the Step 0 target line, and
> Codex's blocking-verdict section); CI's `verify:prompts-fresh` fails on
> drift. See [`packages/core/prompts/README.md`](../../../packages/core/prompts/README.md).
