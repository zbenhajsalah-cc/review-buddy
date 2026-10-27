/**
 * Generates the per-harness review prompts under apps/plugin/integrations/ from
 * the single template (apps/plugin/integrations/prompt-template.md). The
 * variants differ only in:
 *  - frontmatter (VS Code prompt files require it),
 *  - how the review target reaches the agent (trailing text vs `$ARGUMENTS`),
 *  - the blocking-verdict section (Codex is the only harness that can run
 *    `--standalone=blocking`).
 *
 * Run `pnpm gen:prompts` after editing the template (or the /review skill it
 * mirrors — see apps/plugin/integrations/README.md); CI's verify:prompts-fresh
 * fails if the generated files drift from the template.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const integrations = join(import.meta.dir, "..", "apps", "plugin", "integrations");
const template = readFileSync(join(integrations, "prompt-template.md"), "utf8");

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
the turn until the reviewer finishes and returns their verdict. If it reports
**"Reviewer requested changes"**, read the note as review feedback, make the
requested edits, then call \`submit_review\` again with the same \`source\` and
\`cwd\`. Acknowledge what you changed between submissions. Re-submit at most
**3 times**; if the reviewer still requests changes, stop and ask the human
directly rather than looping.
`;

const variants = [
  {
    out: "cursor/commands/review-buddy.md",
    frontmatter: "",
    target: TRAILING_TEXT_TARGET,
    blocking: "",
  },
  {
    out: "vscode-copilot/prompts/review-buddy.prompt.md",
    frontmatter: COPILOT_FRONTMATTER,
    target: TRAILING_TEXT_TARGET,
    blocking: "",
  },
  {
    out: "codex/prompts/review-buddy.md",
    frontmatter: "",
    target: ARGUMENTS_TARGET,
    blocking: CODEX_BLOCKING_SECTION,
  },
];

for (const v of variants) {
  const content = template
    .replace("{{FRONTMATTER}}", v.frontmatter)
    .replace("{{TARGET_PARAGRAPH}}", v.target)
    .replace("{{BLOCKING_SECTION}}", v.blocking);
  if (content.includes("{{")) throw new Error(`unreplaced placeholder in ${v.out}`);
  writeFileSync(join(integrations, v.out), content);
  console.error(`[gen-prompts] wrote apps/plugin/integrations/${v.out}`);
}
