/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bundledThemesInfo } from "shiki/themes";
import { CODE_FONTS, codeFontStyle, FONT_SIZES, THEMES } from "./appearance.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

test("theme lists hold the defaults and only themes of their own mode", () => {
  const ids = (mode: "light" | "dark") => THEMES[mode].map((t) => t.id);
  expect(ids("light")).toContain(DEFAULT_SETTINGS.lightTheme);
  expect(ids("dark")).toContain(DEFAULT_SETTINGS.darkTheme);
  expect(ids("light")).toContain("github-light");
  expect(ids("dark")).toContain("dracula");

  const shikiType = new Map(bundledThemesInfo.map((t) => [t.id, t.type]));
  for (const mode of ["light", "dark"] as const) {
    for (const id of ids(mode)) {
      if (!id.startsWith("pierre-")) expect(shikiType.get(id)).toBe(mode);
    }
  }
});

test("every code font family is declared in theme.css, and vice versa", () => {
  const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
  const declared = new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1] ?? ""));
  const families = CODE_FONTS.flatMap((f) => (f.family ? [f.family] : []));
  expect(families.length).toBeGreaterThan(0);
  for (const family of families) expect(declared).toContain(family);
  // No orphan @font-face rules either (besides the design's text faces).
  const textFaces = ["Inter", "Instrument Serif"];
  expect([...declared].filter((f) => !textFaces.includes(f)).sort()).toEqual(
    [...new Set(families)].sort(),
  );
});

test("defaults are in the catalogs", () => {
  expect(CODE_FONTS.map((f) => f.id)).toContain(DEFAULT_SETTINGS.font);
  expect(FONT_SIZES).toContain(DEFAULT_SETTINGS.fontSize as (typeof FONT_SIZES)[number]);
});

test("codeFontStyle sets the diffs font variables", () => {
  const style = codeFontStyle({ font: "victor-mono", fontSize: 14, ligatures: true }) as Record<
    string,
    string
  >;
  expect(style["--diffs-font-family"]).toStartWith('"Victor Mono", ');
  // The UI's mono face (labels) is not the reviewer's to change.
  expect(style["--font-mono"]).toBeUndefined();
  expect(style["--diffs-font-size"]).toBe("14px");
  expect(style["--diffs-line-height"]).toBe("22px");
  expect(style["--diffs-font-features"]).toBe("normal");
});

test("codeFontStyle: the system font has no bundled family, 13px keeps the 20px line", () => {
  const style = codeFontStyle({ font: "system", fontSize: 13, ligatures: false }) as Record<
    string,
    string
  >;
  expect(style["--diffs-font-family"]).toStartWith("ui-monospace, ");
  expect(style["--diffs-line-height"]).toBe("20px");
  expect(style["--diffs-font-features"]).toBe('"liga" 0, "calt" 0');
});
