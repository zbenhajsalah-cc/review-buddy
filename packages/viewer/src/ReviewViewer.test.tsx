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
  history.replaceState(null, "", "/");
});

/** The browser's Back / Forward: the URL changes, then popstate. */
function goTo(url: string) {
  act(() => {
    history.replaceState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

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

test('afterDone "keep": Done stays marked when the reviewer goes back and opens a chapter', async () => {
  const done = mock(async () => {});
  render(<ReviewViewer api={fakeReviewApi({ overrides: { done, afterDone: "keep" } })} />);
  await screen.findByRole("heading", { level: 2 });
  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  });
  expect(screen.getByRole("button", { name: "Done ✓" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Overview/ }));
  await screen.findByRole("heading", { level: 2 });
  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  const button = (await screen.findByRole("button", { name: "Done ✓" })) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(done).toHaveBeenCalledTimes(1);
});

test("urlHash: opens the chapter in the hash, and each move is in the URL", async () => {
  history.replaceState(null, "", "/#/chapter/2");
  render(<ReviewViewer api={fakeReviewApi()} urlHash />);
  expect(await screen.findByText(/^Chapter 2 of/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByText(/^Chapter 3 of/)).toBeTruthy();
  expect(location.hash).toBe("#/chapter/3");

  fireEvent.click(screen.getByRole("button", { name: /Overview/ }));
  await screen.findByRole("heading", { level: 2 });
  expect(location.hash).toBe("");
});

test("urlHash: Back and Forward bring the view along", async () => {
  render(<ReviewViewer api={fakeReviewApi()} urlHash />);
  await screen.findByRole("heading", { level: 2 });

  goTo("/#/chapter/3");
  expect(screen.getByText(/^Chapter 3 of/)).toBeTruthy();
  goTo("/");
  expect(await screen.findByRole("heading", { level: 2 })).toBeTruthy();
});

test("urlHash: a chapter the review does not have shows the overview", async () => {
  history.replaceState(null, "", "/#/chapter/9");
  render(<ReviewViewer api={fakeReviewApi()} urlHash />);
  expect(await screen.findByRole("heading", { level: 2 })).toBeTruthy();
});

test("without urlHash the URL is not read or changed", async () => {
  history.replaceState(null, "", "/#/chapter/2");
  render(<ReviewViewer api={fakeReviewApi()} />);
  await screen.findByRole("heading", { level: 2 });
  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  expect(await screen.findByText(/^Chapter 1 of/)).toBeTruthy();
  expect(location.hash).toBe("#/chapter/2");
});

test("Done (close): Back does not open the review again", async () => {
  render(<ReviewViewer api={fakeReviewApi()} urlHash />);
  await screen.findByRole("heading", { level: 2 });
  act(() => {
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  });
  expect(screen.getByText("Review submitted — you can close this tab.")).toBeTruthy();

  goTo("/");
  expect(screen.getByText("Review submitted — you can close this tab.")).toBeTruthy();
  expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
});
