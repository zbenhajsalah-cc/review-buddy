/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fakeResolvedReview } from "../stories/fixtures.ts";

mock.module("../session.ts", () => ({
  getReviewToken: () => "testtoken",
}));

const { Overview } = await import("./Overview.tsx");

const VIEWED_KEY = "rb.viewed.testtoken";

afterEach(() => {
  cleanup();
  localStorage.removeItem(VIEWED_KEY);
});

test("no viewed entries → no progress UI and heading has no complete text", () => {
  render(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText(/viewed/)).toBeNull();
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("3 chapters");
});

test("partial progress → viewed label and progressbar aria-valuenow match", () => {
  // Chapter 2 has two files; mark one viewed.
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["2:src/server/auth/middleware.ts"]));
  render(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

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
  render(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.getByText("2/2 viewed")).toBeTruthy();
  expect(screen.getByText("✓")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
    "3 chapters · 1 of 3 complete",
  );
});

test("stale entry whose path is not in the chapter does not raise the count", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["1:src/example.ts", "1:src/gone.ts"]));
  render(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  // Chapter 1 has only src/example.ts — stale path must not inflate to 2.
  expect(screen.getByText("1/1 viewed")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  expect(bar.getAttribute("aria-valuemax")).toBe("1");
});

test("entry for a different chapter index does not leak into this chapter's count", () => {
  // Chapter 1's file path stored under chapter 2 — must not count for chapter 2.
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["2:src/example.ts"]));
  render(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.queryByText(/viewed/)).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("3 chapters");
});

test("Enter on document.body begins review at chapter 0", () => {
  const onBeginReview = mock(() => {});
  render(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);

  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  expect(onBeginReview).toHaveBeenCalledTimes(1);
  expect(onBeginReview).toHaveBeenCalledWith(0);
});

test("Enter on a chapter button does not fire the global Begin-review shortcut", () => {
  const onBeginReview = mock(() => {});
  render(<Overview review={fakeResolvedReview} onBeginReview={onBeginReview} />);

  const secondChapter = screen.getByRole("button", { name: /Refactor auth middleware/ });
  act(() => {
    fireEvent.keyDown(secondChapter, { key: "Enter" });
  });
  // Global shortcut must not steal Enter and force chapter 0.
  expect(onBeginReview).not.toHaveBeenCalledWith(0);
});

test("shortcuts dialog on overview does not list Next file", () => {
  render(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

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
  render(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy review as Markdown" }));
  });

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith(reviewToMarkdown(fakeResolvedReview));
});
