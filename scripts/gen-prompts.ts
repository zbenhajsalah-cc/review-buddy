/**
 * Generates every review prompt from the single template
 * (packages/core/prompts/review-template.md):
 *
 *  - the standalone MCP prompts under apps/plugin/integrations/ (Cursor,
 *    VS Code Copilot, Codex), which differ only in frontmatter (VS Code prompt
 *    files require it), how the review target reaches the agent (trailing
 *    text vs `$ARGUMENTS`), and the blocking-verdict section (Codex is the
 *    only harness that can run `--standalone=blocking`);
 *  - the desktop app's system prompt (packages/core/prompts/review-desktop.md),
 *    whose Step 0 is the `get_pr_diff` tool and whose submit has no `source`
 *    or `cwd`.
 *
 * The template marks variant-only text with `{{#standalone}}…{{/standalone}}`
 * and `{{#desktop}}…{{/desktop}}` blocks (tags on their own lines); Steps 1–3
 * and the Critical rules are shared.
 *
 * Run `pnpm gen:prompts` after editing the template (or the /review skill it
 * mirrors — see packages/core/prompts/README.md); CI's verify:prompts-fresh
 * fails if the generated files drift from the template.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const template = readFileSync(join(root, "packages/core/prompts/review-template.md"), "utf8");

type Kind = "standalone" | "desktop";

/** Keep the `kind` blocks (without their tags), drop the other kind's blocks. */
function selectBlocks(text: string, kind: Kind): string {
  return text.replace(
    /\{\{#(standalone|desktop)\}\}\n([\s\S]*?)\{\{\/\1\}\}\n?/g,
    (_, block: Kind, body: string) => (block === kind ? body : ""),
  );
}

const COPILOT_FRONTMATTER = `---
mode: agent
description: Narrative code review — Prologue + risk-rated Chapters, opened in the browser
---

`;

const TRAILING_TEXT_TARGET = `Determine what to review from any text after the command (nothing = the local
working tree). **Remember which**, because in Step 4 you must tell the tool via
\`source\` so it re-captures the *same* diff (the tool only sees your
\`submit_review\` payload):`;

const ARGUMENTS_TARGET = `Review target: \`$ARGUMENTS\` (empty = the local working tree). **Remember
which**, because in Step 4 you must tell the tool via \`source\` so it
re-captures the *same* diff (the tool only sees your \`submit_review\` payload):`;

const CODEX_BLOCKING_SECTION = `
### If the tool returns a verdict instead of a URL (blocking mode)

When the server is registered with \`--standalone=blocking\`, the tool holds
the turn until the reviewer finishes and returns their verdict, with their
note and line comments. Each comment names a file and lines, like
\`\` \`src/a.ts\` lines 10-14 (new): … \`\` — \`(new)\` is a line number in the
changed version of the file, \`(old)\` one in the base version.

If it reports **"Reviewer requested changes"**, read the note and the comments
as review feedback, make the requested edits, then call \`submit_review\` again
with the same \`source\` and \`cwd\`. Acknowledge what you changed between
submissions. Re-submit at most **3 times**; if the reviewer still requests
changes, stop and ask the human directly rather than looping.

If the reviewer approved with comments, answer their questions and make the
small fixes they ask for; do not call \`submit_review\` again unless the user
asks.
`;

const variants: {
  out: string;
  kind: Kind;
  frontmatter: string;
  target: string;
  blocking: string;
}[] = [
  {
    out: "apps/plugin/integrations/cursor/commands/review-buddy.md",
    kind: "standalone",
    frontmatter: "",
    target: TRAILING_TEXT_TARGET,
    blocking: "",
  },
  {
    out: "apps/plugin/integrations/vscode-copilot/prompts/review-buddy.prompt.md",
    kind: "standalone",
    frontmatter: COPILOT_FRONTMATTER,
    target: TRAILING_TEXT_TARGET,
    blocking: "",
  },
  {
    out: "apps/plugin/integrations/codex/prompts/review-buddy.md",
    kind: "standalone",
    frontmatter: "",
    target: ARGUMENTS_TARGET,
    blocking: CODEX_BLOCKING_SECTION,
  },
  {
    out: "packages/core/prompts/review-desktop.md",
    kind: "desktop",
    frontmatter: "",
    target: "",
    blocking: "",
  },
];

for (const v of variants) {
  const content = selectBlocks(template, v.kind)
    .replace("{{FRONTMATTER}}", v.frontmatter)
    .replace("{{TARGET_PARAGRAPH}}", v.target)
    .replace("{{BLOCKING_SECTION}}", v.blocking);
  if (content.includes("{{")) throw new Error(`unreplaced placeholder in ${v.out}`);
  writeFileSync(join(root, v.out), content);
  console.error(`[gen-prompts] wrote ${v.out}`);
}
