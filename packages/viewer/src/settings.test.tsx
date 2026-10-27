/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { WorkerPoolContext } from "@pierre/diffs/react";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_SETTINGS,
  granularityToLineDiffType,
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

function SettingsHarness() {
  const [settings, update] = useDisplaySettings();
  return (
    <div>
      <output data-testid="granularity">{settings.granularity}</output>
      <button type="button" onClick={() => update({ granularity: "char" })}>
        set-char
      </button>
    </div>
  );
}

test("useDisplaySettings syncs lineDiffType to the worker pool", () => {
  const setRenderOptions = mock(() => Promise.resolve());
  const fakePool = { setRenderOptions } as unknown as WorkerPoolManager;

  render(
    <WorkerPoolContext.Provider value={fakePool}>
      <SettingsHarness />
    </WorkerPoolContext.Provider>,
  );

  expect(setRenderOptions).toHaveBeenCalledWith({ lineDiffType: "word" });
  expect(screen.getByTestId("granularity").textContent).toBe("word");

  fireEvent.click(screen.getByText("set-char"));

  expect(setRenderOptions).toHaveBeenCalledWith({ lineDiffType: "char" });
  expect(screen.getByTestId("granularity").textContent).toBe("char");
});
