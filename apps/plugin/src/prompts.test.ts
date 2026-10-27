import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Steps 1–3 and the Critical rules are the product: every harness must get the
 * same text. The skill is hand-written; the other prompts are generated from
 * packages/core/prompts/review-template.md (`pnpm gen:prompts`). This catches
 * a change to one that was not ported to the other.
 */
const plugin = join(import.meta.dir, "..");
const corePrompts = dirname(
  Bun.resolveSync("@review-buddy/core/prompts/review-desktop.md", plugin),
);

const PROMPTS = {
  "skills/review/SKILL.md": join(plugin, "skills/review/SKILL.md"),
  cursor: join(plugin, "integrations/cursor/commands/review-buddy.md"),
  "vscode-copilot": join(plugin, "integrations/vscode-copilot/prompts/review-buddy.prompt.md"),
  codex: join(plugin, "integrations/codex/prompts/review-buddy.md"),
  desktop: join(corePrompts, "review-desktop.md"),
};

function sharedSection(text: string): string {
  const start = text.indexOf("## Step 1");
  const end = text.indexOf("## Step 4");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

test("every prompt has the same Steps 1–3 and Critical rules as the skill", () => {
  const skill = sharedSection(readFileSync(PROMPTS["skills/review/SKILL.md"], "utf8"));
  for (const [name, path] of Object.entries(PROMPTS)) {
    expect({ name, section: sharedSection(readFileSync(path, "utf8")) }).toEqual({
      name,
      section: skill,
    });
  }
});
