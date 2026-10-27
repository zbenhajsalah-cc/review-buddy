import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prompts = join(import.meta.dir, "..", "prompts");
const desktop = readFileSync(join(prompts, "review-desktop.md"), "utf8");

test("desktop prompt: tools only, no shell, no source/cwd payload", () => {
  expect(desktop).toContain("`get_pr_diff`");
  expect(desktop).toContain("`read_file`");
  expect(desktop).toContain("`{ prologue, chapters }`");
  // Standalone-only instructions must not leak into the desktop variant.
  expect(desktop).not.toMatch(/git (diff|rev-parse|status)|gh pr|\{ cwd, source/);
  expect(desktop).not.toContain("{{");
});

test("template: every variant block is closed, and only known variants are used", () => {
  const template = readFileSync(join(prompts, "review-template.md"), "utf8");
  const tags = [...template.matchAll(/\{\{([#/])(\w+)\}\}/g)].map((m) => `${m[1]}${m[2]}`);
  expect(tags.length).toBeGreaterThan(0);
  for (let i = 0; i < tags.length; i += 2) {
    expect(tags[i]).toMatch(/^#(standalone|desktop)$/);
    expect(tags[i + 1]).toBe(`/${tags[i]!.slice(1)}`);
  }
});
