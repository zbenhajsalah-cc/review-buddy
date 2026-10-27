/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

mock.module("../session.ts", () => ({
  getReviewToken: () => "testtoken",
}));

const { useViewedFiles, useCollapsedFiles, readViewedEntries, clearReviewFileState } = await import(
  "./chapterFileSet.ts"
);

const VIEWED_KEY = "rb.viewed.testtoken";
const COLLAPSED_KEY = "rb.collapsed.testtoken";

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
  render(<FlagHarness chapterIndex={1} flag="collapsed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  fireEvent.click(screen.getByText("set-a-true"));
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
});

test("set(false) removes the path; absent entry is a no-op", () => {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["1:a.ts"]));
  render(<FlagHarness chapterIndex={1} flag="collapsed" />);
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  fireEvent.click(screen.getByText("set-a-false"));
  expect(screen.getByTestId("set").textContent).toBe("");
  fireEvent.click(screen.getByText("set-a-false"));
  expect(screen.getByTestId("set").textContent).toBe("");
});

test("flag state is namespaced per chapter", () => {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["1:a.ts", "2:b.ts"]));
  const { rerender } = render(<FlagHarness chapterIndex={1} flag="collapsed" />);
  expect(screen.getByTestId("set").textContent).toBe("a.ts");
  rerender(<FlagHarness chapterIndex={2} flag="collapsed" />);
  expect(screen.getByTestId("set").textContent).toBe("b.ts");
});

test("viewed and collapsed persist under separate localStorage keys", () => {
  render(<FlagHarness chapterIndex={1} flag="viewed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
  expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();

  cleanup();
  render(<FlagHarness chapterIndex={1} flag="collapsed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["1:a.ts"]);
});

test("clearReviewFileState removes both storage keys", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["1:a.ts"]));
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["1:a.ts"]));
  clearReviewFileState();
  expect(localStorage.getItem(VIEWED_KEY)).toBeNull();
  expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
});

test("readViewedEntries returns what useViewedFiles wrote", () => {
  render(<FlagHarness chapterIndex={1} flag="viewed" />);
  fireEvent.click(screen.getByText("set-a-true"));
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["1:a.ts"]);

  cleanup();
  expect(readViewedEntries()).toEqual(["1:a.ts"]);
});
