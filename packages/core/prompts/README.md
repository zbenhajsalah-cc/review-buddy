# Review prompts

One template, every harness:

```
review-template.md   ← edit this (source of truth for the generated prompts)
review-desktop.md    ← GENERATED: the desktop app's system prompt
apps/plugin/integrations/{cursor,vscode-copilot,codex}/…  ← GENERATED: standalone MCP prompts (repo path)
```

`pnpm gen:prompts` (`scripts/gen-prompts.ts`) writes all of them. CI's
`verify:prompts-fresh` fails if a generated file drifts from the template, so
never edit a generated prompt by hand.

The template marks text that only one kind of harness gets:

- `{{#standalone}} … {{/standalone}}` — Cursor / Copilot / Codex: the agent runs
  `git` / `gh` itself and passes `cwd` + `source` to `submit_review`.
- `{{#desktop}} … {{/desktop}}` — the desktop app: no shell; the agent calls
  `get_pr_diff` / `read_file` and submits only `{ prologue, chapters }`, then
  fixes anchors from the resolution notes the tool returns.

Put each tag on its own line. Everything outside the blocks — Steps 1–3 and the
Critical rules, which are the product — is shared.

The template is a port of the Claude Code skill,
`apps/plugin/skills/review/SKILL.md`, which stays hand-written (its Step 0 and
Step 4 are about the `PreToolUse` hook). When you change the skill's Steps 1–3
or Critical rules, port the change into the template and regenerate.
