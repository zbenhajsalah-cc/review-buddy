import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findGh, ghAuthToken, ghCandidates } from "./gh-cli.ts";

describe("ghCandidates", () => {
  test("PATH first, then the usual install folders (a Dock app has no shell PATH)", () => {
    const list = ghCandidates("darwin", { PATH: "/usr/bin:/custom/bin" });
    expect(list[0]).toBe("/usr/bin/gh");
    expect(list[1]).toBe("/custom/bin/gh");
    expect(list).toContain("/opt/homebrew/bin/gh");
    expect(list).toContain("/usr/local/bin/gh");
    expect(new Set(list).size).toBe(list.length);
  });

  test("Windows looks for gh.exe, also under Program Files", () => {
    const list = ghCandidates("win32", { PATH: "", ProgramFiles: "C:\\Program Files" });
    expect(list.every((p) => p.endsWith("gh.exe"))).toBe(true);
    expect(list.some((p) => p.includes("GitHub CLI"))).toBe(true);
  });
});

test("findGh returns the first one that exists, or null", () => {
  const env = { PATH: "/a:/b" };
  expect(findGh("linux", env, (p) => p === "/b/gh")).toBe("/b/gh");
  expect(findGh("linux", env, () => false)).toBeNull();
});

describe.skipIf(process.platform === "win32")("ghAuthToken", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-gh-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const fakeGh = (name: string, script: string) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
  };

  test("reads the token gh prints for github.com", async () => {
    const gh = fakeGh(
      "gh-ok",
      '[ "$*" = "auth token --hostname github.com" ] && echo "gho_abc123" || exit 1',
    );
    expect(await ghAuthToken(gh)).toBe("gho_abc123");
  });

  test("null when gh is logged out, prints nothing, or is missing", async () => {
    expect(await ghAuthToken(fakeGh("gh-out", "echo 'no oauth token' >&2; exit 1"))).toBeNull();
    expect(await ghAuthToken(fakeGh("gh-empty", "exit 0"))).toBeNull();
    expect(await ghAuthToken(join(dir, "missing"))).toBeNull();
    expect(await ghAuthToken(null)).toBeNull();
  });
});
