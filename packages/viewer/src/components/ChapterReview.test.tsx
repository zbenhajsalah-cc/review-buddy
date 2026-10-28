/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithApi } from "../../test/render.tsx";
import { fakeResolvedReview, fakeReviewApi } from "../stories/fixtures.ts";

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
  // biome-ignore lint/suspicious/noDocumentCookie: drop the "hide viewed" preference
  document.cookie = "rb.hideViewed=; path=/; max-age=0";
});

/** Chapter 2 of the fixture: two files, in src/server/auth. */
function renderChapter2(props: { openFile?: string } = {}) {
  return renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={1}
      onNavigate={() => {}}
      onExit={() => {}}
      {...props}
    />,
  );
}

const card = (path: string) => document.querySelector(`[data-file-path="${path}"]`);
/** An element inside a file's card; null also when the card is missing. */
const inCard = (path: string, selector: string) =>
  document.querySelector(`[data-file-path="${path}"] ${selector}`);
const MIDDLEWARE = "src/server/auth/middleware.ts";
const SESSION = "src/server/auth/session.ts";

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

test("Done (default): the review's viewed state is cleared and the viewer says submitted", async () => {
  const done = mock(async () => {});
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
    fakeReviewApi({ overrides: { done } }),
  );
  fireEvent.click(screen.getByLabelText("viewed"));
  expect(localStorage.getItem(VIEWED_KEY)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  // Not every file is viewed, so Done asks first.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish anyway" }));
  });
  expect(done).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(VIEWED_KEY)).toBeNull();
  expect(screen.getByText("Review submitted — you can close this tab.")).toBeTruthy();
});

test('Done with afterDone "keep": the state stays and the review stays open', async () => {
  const done = mock(async () => {});
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
    fakeReviewApi({ overrides: { done, afterDone: "keep" } }),
  );
  fireEvent.click(screen.getByLabelText("viewed"));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  // Not every file is viewed, so Done asks first.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish anyway" }));
  });
  expect(done).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY)!)).toHaveLength(1);
  expect(screen.queryByText(/Review submitted/)).toBeNull();
  const button = screen.getByRole("button", { name: "Done ✓" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

test("Done with every file viewed submits without asking", async () => {
  localStorage.setItem(
    VIEWED_KEY,
    JSON.stringify([
      "1:src/example.ts",
      `2:${MIDDLEWARE}`,
      `2:${SESSION}`,
      "3:src/jobs/backoff.ts",
    ]),
  );
  const done = mock(async () => {});
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
    fakeReviewApi({ overrides: { done } }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  });
  expect(done).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Finish anyway/)).toBeNull();
});

test("Done with files not viewed asks; Keep reviewing does not submit", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["1:src/example.ts"]));
  const done = mock(async () => {});
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
    fakeReviewApi({ overrides: { done } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByText("Viewed 1 of 4 files. Finish anyway?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
  expect(screen.queryByText(/Finish anyway/)).toBeNull();
  expect(done).toHaveBeenCalledTimes(0);
});

test("Collapse all collapses every file, then Expand all opens them again", () => {
  renderChapter2();
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(inCard(MIDDLEWARE, "[hidden]")).not.toBeNull();
  expect(inCard(SESSION, "[hidden]")).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  expect(inCard(MIDDLEWARE, "[hidden]")).toBeNull();
  expect(inCard(SESSION, "[hidden]")).toBeNull();
});

test("Hide viewed files takes viewed files out of the list and the diffs", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify([`2:${MIDDLEWARE}`]));
  renderChapter2();
  fireEvent.click(screen.getByRole("switch", { name: "Hide viewed files" }));
  expect(card(MIDDLEWARE)).toBeNull();
  expect(document.querySelector(`aside [title="${MIDDLEWARE}"]`)).toBeNull();
  expect(card(SESSION)).not.toBeNull();

  fireEvent.click(screen.getByRole("switch", { name: "viewed" })); // the last one
  expect(screen.getByText(/All 2 files are viewed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show them" }));
  expect(card(MIDDLEWARE)).not.toBeNull();
  expect(card(SESSION)).not.toBeNull();
});

test("the file list shows each file's folder after its name, and the full path on hover", () => {
  renderChapter2();
  const item = document.querySelector(`aside [title="${MIDDLEWARE}"]`)!;
  expect(item.textContent).toContain("middleware.ts");
  expect(item.textContent).toContain("src/server/auth");
});

test("openFile focuses that file when the chapter opens", () => {
  renderChapter2({ openFile: SESSION });
  expect(inCard(SESSION, "[data-focused]")).not.toBeNull();
  expect(inCard(MIDDLEWARE, "[data-focused]")).toBeNull();
});

test("with Hide viewed on, the file the focus link opened stays shown, and open", () => {
  // biome-ignore lint/suspicious/noDocumentCookie: turn the "hide viewed" preference on
  document.cookie = "rb.hideViewed=true; path=/";
  // Viewed, so also collapsed.
  localStorage.setItem(VIEWED_KEY, JSON.stringify([`2:${SESSION}`]));
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([`2:${SESSION}`]));
  renderChapter2({ openFile: SESSION });
  expect(inCard(SESSION, "[data-focused]")).not.toBeNull();
  expect(inCard(SESSION, "[data-testid='patch-diff']")).not.toBeNull();
  expect(inCard(SESSION, "[hidden]")).toBeNull();
  expect(card(MIDDLEWARE)).not.toBeNull();
});

// Behavior checks only: in a real browser React re-renders between Radix's
// capture listener and ours, which happy-dom doesn't reproduce. The regression
// guard for that timing is the preventDefault test in lib/shortcuts.test.tsx.
test("Esc closes the shortcuts dialog without leaving the chapter", () => {
  const onExit = mock(() => {});
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={onExit}
    />,
  );

  act(() => {
    fireEvent.keyDown(document, { key: "?" });
  });
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  });
  expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  expect(onExit).toHaveBeenCalledTimes(0);

  act(() => {
    fireEvent.keyDown(document, { key: "Escape" });
  });
  expect(onExit).toHaveBeenCalledTimes(1);
});

test("Esc closes the theme & font popover without leaving the chapter", async () => {
  const onExit = mock(() => {});
  renderWithApi(
    <ChapterReview
      review={fakeResolvedReview}
      position={0}
      onNavigate={() => {}}
      onExit={onExit}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Theme & font" }));
  });
  expect(screen.queryByLabelText("Font")).not.toBeNull();

  act(() => {
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  });
  expect(screen.queryByLabelText("Font")).toBeNull();
  expect(onExit).toHaveBeenCalledTimes(0);
});
