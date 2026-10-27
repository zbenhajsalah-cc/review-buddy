import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsFile } from "./settings-file.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function file(): string {
  const dir = mkdtempSync(join(tmpdir(), "rb-settings-"));
  dirs.push(dir);
  return join(dir, "settings.json");
}

test("missing or damaged: defaults", async () => {
  const path = file();
  expect(await new SettingsFile(path).read()).toEqual({});
  writeFileSync(path, "{ not json");
  expect(await new SettingsFile(path).read()).toEqual({});
});

test("updates run one at a time, so none is lost", async () => {
  const path = file();
  const settings = new SettingsFile(path);
  // Started together: each reads what the one before wrote.
  await Promise.all([
    settings.update({ ghDisabled: true }),
    settings.update((s) => ({ recentRepos: ["a/one", ...(s.recentRepos ?? [])] })),
    settings.update((s) => ({ recentRepos: ["a/two", ...(s.recentRepos ?? [])] })),
  ]);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    ghDisabled: true,
    recentRepos: ["a/two", "a/one"],
  });
});

test("a failed update does not block the next one", async () => {
  const path = file();
  const settings = new SettingsFile(path);
  const failing = settings.update(() => {
    throw new Error("boom");
  });
  await expect(failing).rejects.toThrow("boom");
  await settings.update({ ghDisabled: false });
  expect(await settings.read()).toEqual({ ghDisabled: false });
});
