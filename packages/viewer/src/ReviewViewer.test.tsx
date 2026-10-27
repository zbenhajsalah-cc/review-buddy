/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { fakeResolvedReview, fakeReviewApi } from "./stories/fixtures.ts";

// The real pool loads a Vite `?worker` module, which only exists in a Vite build.
mock.module("./workerPool.tsx", () => ({
  ReviewWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));

mock.module("@pierre/diffs/react", () => ({
  PatchDiff: () => null,
  FileDiff: () => null,
}));

const { ReviewViewer } = await import("./ReviewViewer.tsx");
afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("loads the review through the api and shows the overview", async () => {
  render(<ReviewViewer api={fakeReviewApi()} />);
  expect(screen.getByText("Loading review…")).toBeTruthy();
  expect(await screen.findByRole("heading", { level: 2 })).toBeTruthy();
  expect(screen.getByText(fakeResolvedReview.chapters[0]!.title)).toBeTruthy();
});

test("validates what the api returns and shows the error", async () => {
  const api = fakeReviewApi({
    overrides: { getReview: async () => ({ nope: 1 }) as never },
  });
  render(<ReviewViewer api={api} />);
  expect(await screen.findByText("Couldn’t load the review")).toBeTruthy();
});

test("shows the error when the api rejects", async () => {
  const api = fakeReviewApi({
    overrides: {
      getReview: async () => {
        throw new Error("offline");
      },
    },
  });
  render(<ReviewViewer api={api} />);
  expect(await screen.findByText(/offline/)).toBeTruthy();
});

test("a new api (another review) starts fresh and keeps that review's saved progress", async () => {
  localStorage.setItem("rb.viewed.review-b", JSON.stringify(["1:kept.ts"]));
  const a = fakeReviewApi({ overrides: { reviewKey: "review-a" } });
  const b = fakeReviewApi({ overrides: { reviewKey: "review-b" } });

  const { rerender } = render(<ReviewViewer api={a} />);
  await screen.findByRole("heading", { level: 2 });
  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" }); // into chapter 1 of review A
  });
  expect(await screen.findByText(/^Chapter 1 of/)).toBeTruthy();

  rerender(<ReviewViewer api={b} />);
  // Back on the overview of review B, and B's progress is untouched.
  await screen.findByRole("heading", { level: 2 });
  expect(screen.queryByText(/^Chapter 1 of/)).toBeNull();
  expect(JSON.parse(localStorage.getItem("rb.viewed.review-b") ?? "[]")).toEqual(["1:kept.ts"]);
});
