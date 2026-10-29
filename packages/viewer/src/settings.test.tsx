/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { WorkerPoolContext } from "@pierre/diffs/react";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import type { DisplaySettings } from "@review-buddy/core/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_SETTINGS,
  granularityToLineDiffType,
  readDisplaySettings,
  sanitizeSettings,
  toDiffOptions,
  useDisplaySettings,
} from "./settings.ts";

const DISPLAY_KEY = "rb.display";

function clearDisplayCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: test cleanup for persisted display prefs
  document.cookie = `${DISPLAY_KEY}=; path=/; max-age=0`;
}

afterEach(() => {
  cleanup();
  clearDisplayCookie();
});

test("granularityToLineDiffType maps line→none, word→word, char→char", () => {
  expect(granularityToLineDiffType("line")).toBe("none");
  expect(granularityToLineDiffType("word")).toBe("word");
  expect(granularityToLineDiffType("char")).toBe("char");
});

test("toDiffOptions maps granularity line→none, word→word, char→char", () => {
  expect(toDiffOptions({ ...DEFAULT_SETTINGS, granularity: "line" }).lineDiffType).toBe("none");
  expect(toDiffOptions({ ...DEFAULT_SETTINGS, granularity: "word" }).lineDiffType).toBe("word");
  expect(toDiffOptions({ ...DEFAULT_SETTINGS, granularity: "char" }).lineDiffType).toBe("char");
});

test("toDiffOptions passes the light/dark theme pair", () => {
  const opts = toDiffOptions({
    ...DEFAULT_SETTINGS,
    lightTheme: "github-light",
    darkTheme: "nord",
  });
  expect(opts.theme).toEqual({ light: "github-light", dark: "nord" });
});

test("sanitizeSettings keeps known values and resets unknown ones", () => {
  const good: DisplaySettings = {
    ...DEFAULT_SETTINGS,
    lightTheme: "solarized-light",
    darkTheme: "dracula",
    font: "fira-code",
    fontSize: 15,
  };
  expect(sanitizeSettings(good)).toEqual(good);

  const stale: DisplaySettings = {
    ...DEFAULT_SETTINGS,
    lightTheme: "no-such-theme",
    // A dark theme is not valid in the light slot (and vice versa).
    darkTheme: "github-light",
    font: "comic-sans",
    fontSize: 42,
  };
  const fixed = sanitizeSettings(stale);
  expect(fixed.lightTheme).toBe(DEFAULT_SETTINGS.lightTheme);
  expect(fixed.darkTheme).toBe(DEFAULT_SETTINGS.darkTheme);
  expect(fixed.font).toBe(DEFAULT_SETTINGS.font);
  expect(fixed.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
});

test("readDisplaySettings fills new fields for an old cookie and sanitizes it", () => {
  // A cookie written before themes/fonts existed, plus one stale theme id.
  const old = { layout: "split", theme: "dark", darkTheme: "gone-theme" };
  // biome-ignore lint/suspicious/noDocumentCookie: seeding persisted display prefs
  document.cookie = `${DISPLAY_KEY}=${encodeURIComponent(JSON.stringify(old))}; path=/`;

  const s = readDisplaySettings();
  expect(s.layout).toBe("split");
  expect(s.theme).toBe("dark");
  expect(s.darkTheme).toBe(DEFAULT_SETTINGS.darkTheme);
  expect(s.font).toBe(DEFAULT_SETTINGS.font);
  expect(s.ligatures).toBe(false);
});

function SettingsHarness() {
  const [settings, update] = useDisplaySettings();
  return (
    <div>
      <output data-testid="granularity">{settings.granularity}</output>
      <button type="button" onClick={() => update({ granularity: "char" })}>
        set-char
      </button>
      <button type="button" onClick={() => update({ darkTheme: "tokyo-night" })}>
        set-theme
      </button>
    </div>
  );
}

const DEFAULT_THEMES = { light: "github-light", dark: "github-dark" };

test("useDisplaySettings syncs lineDiffType and theme to the worker pool", () => {
  const setRenderOptions = mock(() => Promise.resolve());
  const fakePool = { setRenderOptions } as unknown as WorkerPoolManager;

  render(
    <WorkerPoolContext.Provider value={fakePool}>
      <SettingsHarness />
    </WorkerPoolContext.Provider>,
  );

  expect(setRenderOptions).toHaveBeenCalledWith({ lineDiffType: "word", theme: DEFAULT_THEMES });
  expect(screen.getByTestId("granularity").textContent).toBe("word");

  fireEvent.click(screen.getByText("set-char"));

  expect(setRenderOptions).toHaveBeenCalledWith({ lineDiffType: "char", theme: DEFAULT_THEMES });
  expect(screen.getByTestId("granularity").textContent).toBe("char");

  fireEvent.click(screen.getByText("set-theme"));

  expect(setRenderOptions).toHaveBeenLastCalledWith({
    lineDiffType: "char",
    theme: { light: "github-light", dark: "tokyo-night" },
  });
});
