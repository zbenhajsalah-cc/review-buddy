/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { fakeResolvedReview, fakeReviewApi } from "./stories/fixtures.ts";

// The real pool loads a Vite `?worker` module, which only exists in a Vite build.
mock.module("./workerPool.tsx", () => ({
  ReviewWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));

const { ReviewViewer } = await import("./ReviewViewer.tsx");
afterEach(cleanup);

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
