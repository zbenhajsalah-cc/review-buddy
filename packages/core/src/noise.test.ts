import { describe, expect, test } from "bun:test";
import { isNoiseFile, NOISE_EXTENSIONS, NOISE_FILENAMES } from "./noise.ts";

describe("isNoiseFile", () => {
  test("matches known lockfile / artifact basenames", () => {
    expect(isNoiseFile("package-lock.json")).toBe(true);
    expect(isNoiseFile("yarn.lock")).toBe(true);
    expect(isNoiseFile("pnpm-lock.yaml")).toBe(true);
    expect(isNoiseFile("bun.lockb")).toBe(true);
    expect(isNoiseFile("bun.lock")).toBe(true);
    expect(isNoiseFile("go.sum")).toBe(true);
    expect(isNoiseFile("path/to/package-lock.json")).toBe(true);
    expect(NOISE_FILENAMES.has("cargo.lock")).toBe(true);
  });

  test("matches known noise extensions", () => {
    expect(isNoiseFile("bundle.min.js")).toBe(true);
    expect(isNoiseFile("styles.min.css")).toBe(true);
    expect(isNoiseFile("app.js.map")).toBe(true);
    expect(isNoiseFile("__tests__/foo.snap")).toBe(true);
    expect(isNoiseFile("assets/logo.png")).toBe(true);
    expect(isNoiseFile("icon.svg")).toBe(true);
    expect(NOISE_EXTENSIONS).toContain(".woff2");
  });

  test("matching is case-insensitive", () => {
    expect(isNoiseFile("Cargo.lock")).toBe(true);
    expect(isNoiseFile("Gemfile.lock")).toBe(true);
    expect(isNoiseFile("IMAGE.PNG")).toBe(true);
    expect(isNoiseFile("Bundle.MIN.JS")).toBe(true);
    expect(isNoiseFile(".DS_Store")).toBe(true);
  });

  test("near-misses do not match", () => {
    expect(isNoiseFile("my.map.ts")).toBe(false);
    expect(isNoiseFile("packages/lockfile-utils.ts")).toBe(false);
    expect(isNoiseFile("notes.pdf.md")).toBe(false);
    expect(isNoiseFile("not-a-package-lock.json.txt")).toBe(false);
  });

  test("plain source files are not noise", () => {
    expect(isNoiseFile("src/server/resolve.ts")).toBe(false);
    expect(isNoiseFile("App.tsx")).toBe(false);
  });
});
