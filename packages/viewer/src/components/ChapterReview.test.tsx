/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithApi } from "../../test/render.tsx";
import { fakeResolvedReview } from "../stories/fixtures.ts";

mock.module("@pierre/diffs/react", () => ({
  PatchDiff: () => <div data-testid="patch-diff" />,
  FileDiff: () => null,
}));

const { ChapterReview } = await import("./ChapterReview.tsx");

// fakeReviewApi()'s reviewKey is "fake-review".
const VIEWED_KEY = "rb.viewed.fake-review";
const COLLAPSED_KEY = "rb.collapsed.fake-review";

afterEach(() => {
  cleanup();
  localStorage.removeItem(VIEWED_KEY);
  localStorage.removeItem(COLLAPSED_KEY);
});

test("marking viewed collapses the card; caret re-expands while viewed stays checked", () => {
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );

  expect(screen.getByTestId("patch-diff").closest("[hidden]")).toBeNull();

  fireEvent.click(screen.getByLabelText("viewed"));
  expect(screen.getByTestId("patch-diff").closest("[hidden]")).not.toBeNull();

  fireEvent.click(screen.getByLabelText("Expand file"));
  expect(screen.getByTestId("patch-diff").closest("[hidden]")).toBeNull();

  const viewedSwitch = screen.getByRole("switch", { name: "viewed" });
  expect(viewedSwitch.getAttribute("data-state")).toBe("checked");
});

test("ArrowRight / ArrowLeft call onNavigate and do nothing at the ends", () => {
  const onNavigate = mock(() => {});
  const { rerender } = renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={onNavigate}
      onExit={() => {}}
    />,
  );

  act(() => {
    fireEvent.keyDown(document, { key: "ArrowLeft" });
  });
  expect(onNavigate).toHaveBeenCalledTimes(0);

  act(() => {
    fireEvent.keyDown(document, { key: "ArrowRight" });
  });
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith(1);

  onNavigate.mockClear();
  rerender(
    <ChapterReview
      review={fakeResolvedReview}
      position={2}
      onNavigate={onNavigate}
      onExit={() => {}}
    />,
  );

  act(() => {
    fireEvent.keyDown(document, { key: "ArrowRight" });
  });
  expect(onNavigate).toHaveBeenCalledTimes(0);

  act(() => {
    fireEvent.keyDown(document, { key: "ArrowLeft" });
  });
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith(1);
});

test("j focuses the first file", () => {
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={1}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );

  expect(document.querySelector("[data-focused]")).toBeNull();

  act(() => {
    fireEvent.keyDown(document, { key: "j" });
  });

  const focused = document.querySelector("[data-focused]");
  expect(focused).not.toBeNull();
  expect(focused?.closest("[data-file-path]")?.getAttribute("data-file-path")).toBe(
    "src/server/auth/middleware.ts",
  );
});

test("v after j marks the first file viewed", () => {
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={1}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );

  act(() => {
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "v" });
  });

  const switches = screen.getAllByRole("switch", { name: "viewed" });
  expect(switches[0]?.getAttribute("data-state")).toBe("checked");
  expect(switches[1]?.getAttribute("data-state")).toBe("unchecked");
});

test("typing j inside the filter input does not move focus", () => {
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={1}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );

  const filter = screen.getByPlaceholderText("Filter files…");
  act(() => {
    fireEvent.keyDown(filter, { key: "j" });
  });

  expect(document.querySelector("[data-focused]")).toBeNull();
});

test("? opens the shortcuts dialog", () => {
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );

  act(() => {
    fireEvent.keyDown(document, { key: "?" });
  });
  expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
});

test("pressing c copies the current chapter as Markdown", async () => {
  const writeText = mock(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  const { chapterToMarkdown } = await import("../lib/reviewMarkdown.ts");
  const chapter = fakeResolvedReview.chapters[1];
  if (!chapter) throw new Error("expected chapter at position 1");

  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={1}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );

  await act(async () => {
    fireEvent.keyDown(document, { key: "c" });
  });

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith(chapterToMarkdown(chapter));
});

test("typing c inside the filter input does not copy", async () => {
  const writeText = mock(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={1}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );

  const filter = screen.getByPlaceholderText("Filter files…");
  act(() => {
    fireEvent.keyDown(filter, { key: "c" });
  });

  expect(writeText).toHaveBeenCalledTimes(0);
});
