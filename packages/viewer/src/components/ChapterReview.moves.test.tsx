/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import type { PatchDiffProps } from "@pierre/diffs/react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithApi } from "../../test/render.tsx";
import { fakeReviewWithMoves } from "../stories/fixtures.ts";

// Like @pierre/diffs, it shows what is under the lines: here, the move notes.
function FakePatchDiff({ lineAnnotations = [], renderAnnotation }: PatchDiffProps<string>) {
  return (
    <div data-testid="patch-diff">
      {lineAnnotations.map((a) => (
        <div key={`${a.side}:${a.lineNumber}`}>{renderAnnotation?.(a)}</div>
      ))}
    </div>
  );
}
mock.module("@pierre/diffs/react", () => ({
  PatchDiff: FakePatchDiff,
  FileDiff: () => null,
}));

const { ChapterReview } = await import("./ChapterReview.tsx");

afterEach(cleanup);

test("the sidebar lists the chapter's moved blocks; the other end in another chapter opens it at the file", () => {
  const onNavigate = mock(() => {});
  renderWithApi(
    <ChapterReview
      review={fakeReviewWithMoves}
      position={0}
      onNavigate={onNavigate}
      onExit={() => {}}
    />,
  );
  expect(screen.getByRole("heading", { name: "1 moved block" })).toBeDefined();
  expect(screen.getByTitle("src/cart/cart.ts, lines 2–5").textContent).toContain(
    "4 lines moved to money.ts:2",
  );

  // The block went to chapter 3 (position 2): its note jumps there, at the
  // block's other end — not at the file, whose header can be far above it.
  fireEvent.click(screen.getByText("Show where it is now"));
  expect(onNavigate).toHaveBeenCalledWith(2, undefined, "m1-to");
});

test("a chapter opened at one end of a move opens that end's file and scrolls to its note", () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute("data-move-id") ?? this.getAttribute("data-file-path") ?? "?");
  };
  try {
    renderWithApi(
      <ChapterReview
        review={fakeReviewWithMoves}
        position={2}
        openMove="m1-to"
        onNavigate={() => {}}
        onExit={() => {}}
      />,
    );
    // The note itself, not the file card it is in.
    expect(scrolled).toContain("m1-to");
    expect(scrolled).not.toContain("src/money.ts");
    expect(document.querySelector('[data-file-path="src/money.ts"] [data-focused]')).not.toBeNull();
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test("both ends in one chapter: the note opens the other end here, without leaving", () => {
  const review = {
    ...fakeReviewWithMoves,
    chapters: fakeReviewWithMoves.chapters.map((ch) =>
      ch.index === 1
        ? { ...ch, files: [...ch.files, fakeReviewWithMoves.chapters[2]!.files[1]!] }
        : ch,
    ),
    moves: fakeReviewWithMoves.moves!.map((m) => ({ ...m, to: { ...m.to, chapterIndex: 1 } })),
  };
  const onNavigate = mock(() => {});
  renderWithApi(
    <ChapterReview review={review} position={0} onNavigate={onNavigate} onExit={() => {}} />,
  );
  // One move, listed at each of its two ends: the heading counts moves.
  expect(screen.getByRole("heading", { name: "1 moved block" })).toBeDefined();
  expect(screen.getAllByTitle(/^src\/(cart\/cart|money)\.ts, lines/)).toHaveLength(2);
  fireEvent.click(screen.getByText("Show where it is now"));
  expect(onNavigate).not.toHaveBeenCalled();
  expect(document.querySelector('[data-file-path="src/money.ts"] [data-focused]')).not.toBeNull();
});

test("a chapter with no moved block has no such list", () => {
  renderWithApi(
    <ChapterReview
      review={fakeReviewWithMoves}
      position={1}
      onNavigate={() => {}}
      onExit={() => {}}
    />,
  );
  expect(screen.queryByRole("heading", { name: /moved block/ })).toBeNull();
});
