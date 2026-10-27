/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithApi } from "../../test/render.tsx";
import {
  clearReviewFileState,
  readViewedEntries,
  useCollapsedFiles,
  useViewedFiles,
} from "./chapterFileSet.ts";

// fakeReviewApi()'s reviewKey is "fake-review".
const KEY = "fake-review";
const VIEWED_KEY = `rb.viewed.${KEY}`;
const COLLAPSED_KEY = `rb.collapsed.${KEY}`;

function FlagHarness({
  chapterIndex,
  flag,
}: {
  chapterIndex: number;
  flag: "viewed" | "collapsed";
}) {
  const useHook = flag === "viewed" ? useViewedFiles : useCollapsedFiles;
  const [paths, setPath] = useHook(chapterIndex);
  return (
    <div>
      <output data-testid="set">{[...paths].sort().join(",")}</output>
      <button type="button" onClick={() => setPath("a.ts", true)}>
        set-a-true
      </button>
      <button type="button" onClick={() => setPath("a.ts", false)}>
        set-a-false
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(VIEWED_KEY);
  localStorage.removeItem(COLLAPSED_KEY);
});

test("set(true) adds the path once (idempotent)", () => {
  renderWithApi(<FlagHarness chapterIndex={1} flag="collapsed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  fireEvent.click(screen.getByText("set-a-true"));
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
});

test("set(false) removes the path; absent entry is a no-op", () => {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["1:a.ts"]));
  renderWithApi(<FlagHarness chapterIndex={1} flag="collapsed" />);
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  fireEvent.click(screen.getByText("set-a-false"));
  expect(screen.getByTestId("set").textContent).toBe("");
  fireEvent.click(screen.getByText("set-a-false"));
  expect(screen.getByTestId("set").textContent).toBe("");
});

test("flag state is namespaced per chapter", () => {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["1:a.ts", "2:b.ts"]));
  const { rerender } = renderWithApi(<FlagHarness chapterIndex={1} flag="collapsed" />);
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  rerender(<FlagHarness chapterIndex={2} flag="collapsed" />);
  expect(screen.getByTestId("set").textContent).toBe("b.ts");
});

test("viewed and collapsed persist under separate localStorage keys", () => {
  renderWithApi(<FlagHarness chapterIndex={1} flag="viewed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
  expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();

  cleanup();
  renderWithApi(<FlagHarness chapterIndex={1} flag="collapsed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
});

test("clearReviewFileState removes both storage keys", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["1:a.ts"]));
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["1:a.ts"]));
  clearReviewFileState(KEY);
  expect(localStorage.getItem(VIEWED_KEY)).toBeNull();
  expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
});

test("readViewedEntries returns what useViewedFiles wrote", () => {
  renderWithApi(<FlagHarness chapterIndex={1} flag="viewed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["1:a.ts"]);

  cleanup();
  expect(readViewedEntries(KEY)).toEqual(["1:a.ts"]);
});
