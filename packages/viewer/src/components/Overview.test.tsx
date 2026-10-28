/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithApi } from "../../test/render.tsx";
import { fakeResolvedReview } from "../stories/fixtures.ts";
import { Overview } from "./Overview.tsx";

// fakeReviewApi()'s reviewKey is "fake-review".
const VIEWED_KEY = "rb.viewed.fake-review";

afterEach(() => {
  cleanup();
  localStorage.removeItem(VIEWED_KEY);
});

test("no viewed entries → no progress UI and heading has no complete text", () => {
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText(/viewed/)).toBeNull();
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("3 chapters");
});

test("partial progress → viewed label and progressbar aria-valuenow match", () => {
  // Chapter 2 has two files; mark one viewed.
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["2:src/server/auth/middleware.ts"]));
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.getByText("1/2 viewed")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  expect(bar.getAttribute("aria-valuemax")).toBe("2");
  expect(bar.getAttribute("aria-label")).toBe("Refactor auth middleware: 1 of 2 files viewed");
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("3 chapters");
});

test("all files in a chapter viewed → chapter complete and heading shows count", () => {
  localStorage.setItem(
    VIEWED_KEY,
    JSON.stringify(["2:src/server/auth/middleware.ts", "2:src/server/auth/session.ts"]),
  );
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.getByText("2/2 viewed")).toBeTruthy();
  expect(screen.getByText("✓")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
    "3 chapters · 1 of 3 complete",
  );
});

test("stale entry whose path is not in the chapter does not raise the count", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["1:src/example.ts", "1:src/gone.ts"]));
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  // Chapter 1 has only src/example.ts — stale path must not inflate to 2.
  expect(screen.getByText("1/1 viewed")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  expect(bar.getAttribute("aria-valuemax")).toBe("1");
});

test("entry for a different chapter index does not leak into this chapter's count", () => {
  // Chapter 1's file path stored under chapter 2 — must not count for chapter 2.
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["2:src/example.ts"]));
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.queryByText(/viewed/)).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("3 chapters");
});

test("Enter on document.body begins review at chapter 0", () => {
  const onBeginReview = mock(() => {});
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);

  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  expect(onBeginReview).toHaveBeenCalledTimes(1);
  expect(onBeginReview).toHaveBeenCalledWith(0);
});

test("after some progress, Begin review continues at the first chapter not complete", () => {
  // Chapter 1 complete, chapter 2 started: continue with chapter 2.
  localStorage.setItem(
    VIEWED_KEY,
    JSON.stringify(["1:src/example.ts", "2:src/server/auth/middleware.ts"]),
  );
  const onBeginReview = mock(() => {});
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);

  fireEvent.click(screen.getByRole("button", { name: "Continue with chapter 2 →" }));
  expect(onBeginReview).toHaveBeenLastCalledWith(1);
  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  expect(onBeginReview).toHaveBeenLastCalledWith(1);
});

test("a skipped chapter comes first: Continue goes back to it", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["3:src/jobs/backoff.ts"]));
  const onBeginReview = mock(() => {});
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);

  fireEvent.click(screen.getByRole("button", { name: "Continue with chapter 1 →" }));
  expect(onBeginReview).toHaveBeenCalledWith(0);
});

test("all chapters complete → Begin review starts at chapter 1 again", () => {
  localStorage.setItem(
    VIEWED_KEY,
    JSON.stringify([
      "1:src/example.ts",
      "2:src/server/auth/middleware.ts",
      "2:src/server/auth/session.ts",
      "3:src/jobs/backoff.ts",
    ]),
  );
  const onBeginReview = mock(() => {});
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);

  fireEvent.click(screen.getByRole("button", { name: "Begin review →" }));
  expect(onBeginReview).toHaveBeenCalledWith(0);
});

test("Enter on a chapter button does not fire the global Begin-review shortcut", () => {
  const onBeginReview = mock(() => {});
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);

  const secondChapter = screen.getByRole("button", { name: /Refactor auth middleware/ });
  act(() => {
    fireEvent.keyDown(secondChapter, { key: "Enter" });
  });
  // Global shortcut must not steal Enter and force chapter 0.
  expect(onBeginReview).not.toHaveBeenCalledWith(0);
});

test("shortcuts dialog on overview does not list Next file", () => {
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  expect(screen.queryByText("Next file")).toBeNull();
});

test("clicking copy control writes the full review as Markdown", async () => {
  const writeText = mock(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  const { reviewToMarkdown } = await import("../lib/reviewMarkdown.ts");
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy review as Markdown" }));
  });

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith(reviewToMarkdown(fakeResolvedReview));
});

const withFocus = (file: string) => ({
  ...fakeResolvedReview,
  prologue: { ...fakeResolvedReview.prologue, review_focus: { summary: "Check it.", file } },
});

test("the review focus file opens its chapter at that file", () => {
  const onBeginReview = mock((_position: number, _file?: string) => {});
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);
  fireEvent.click(screen.getByRole("button", { name: "src/example.ts →" }));
  expect(onBeginReview).toHaveBeenCalledWith(0, "src/example.ts");
});

test("a focus file written as ./path or path:line still finds its chapter", () => {
  const onBeginReview = mock((_position: number, _file?: string) => {});
  renderWithApi(
    <Overview
      review={withFocus("./src/server/auth/session.ts:42")}
      onBeginReview={onBeginReview}
    />,
  );
  fireEvent.click(screen.getByTitle("Open in chapter 2"));
  expect(onBeginReview).toHaveBeenCalledWith(1, "src/server/auth/session.ts");
});

test("a focus file the diff does not have stays plain text", () => {
  renderWithApi(<Overview review={withFocus("docs/missing.md")} onBeginReview={() => {}} />);
  expect(screen.getByText("docs/missing.md").tagName).toBe("CODE");
  expect(screen.queryByTitle(/Open in chapter/)).toBeNull();
});
