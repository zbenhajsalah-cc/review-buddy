/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithApi } from "../../test/render.tsx";
import type { LineComment } from "../lib/comments.ts";
import { reviewToMarkdown } from "../lib/reviewMarkdown.ts";
import {
  fakeResolvedReview,
  fakeReviewApi,
  fakeReviewWithFindings,
  fakeReviewWithQuestions,
} from "../stories/fixtures.ts";
import { Overview } from "./Overview.tsx";

/** The overview's chapter list heading ("3 chapters", "3 chapters · 1 of 3 complete"). */
const CHAPTER_LIST = /^\d+ chapters?/;

// fakeReviewApi()'s reviewKey is "fake-review".
const VIEWED_KEY = "rb.viewed.fake-review";
const COMMENTS_KEY = "rb.comments.fake-review";

afterEach(() => {
  cleanup();
  localStorage.removeItem(VIEWED_KEY);
  localStorage.removeItem(COMMENTS_KEY);
});

test("no viewed entries → no progress UI and heading has no complete text", () => {
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText(/viewed/)).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: CHAPTER_LIST }).textContent).toBe(
    "3 chapters",
  );
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
  expect(screen.getByRole("heading", { level: 2, name: CHAPTER_LIST }).textContent).toBe(
    "3 chapters",
  );
});

test("all files in a chapter viewed → chapter complete and heading shows count", () => {
  localStorage.setItem(
    VIEWED_KEY,
    JSON.stringify(["2:src/server/auth/middleware.ts", "2:src/server/auth/session.ts"]),
  );
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  expect(screen.getByText("2/2 viewed")).toBeTruthy();
  expect(screen.getByText("✓")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: CHAPTER_LIST }).textContent).toBe(
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
  expect(screen.getByRole("heading", { level: 2, name: CHAPTER_LIST }).textContent).toBe(
    "3 chapters",
  );
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

test("a focus file named by its old path opens the renamed file", () => {
  const onBeginReview = mock((_position: number, _file?: string) => {});
  const review = withFocus("src/jobs/retry.ts");
  const [first, second, third] = review.chapters;
  const renamed = {
    ...third!.files[0]!,
    change_type: "renamed" as const,
    old_path: "src/jobs/retry.ts",
  };
  review.chapters = [first!, second!, { ...third!, files: [renamed] }];
  renderWithApi(<Overview review={review} onBeginReview={onBeginReview} />);
  fireEvent.click(screen.getByTitle("Open in chapter 3"));
  expect(onBeginReview).toHaveBeenCalledWith(2, "src/jobs/backoff.ts");
});

const comment = (id: string, chapterIndex: number): LineComment => ({
  id,
  chapterIndex,
  path: "src/example.ts",
  side: "new",
  line: 11,
  body: `Note ${id}`,
});

test("a chapter card counts its comments, and the copy includes them", async () => {
  const comments = [comment("a", 2), comment("b", 2), comment("c", 3)];
  localStorage.setItem(COMMENTS_KEY, JSON.stringify(comments));
  const writeText = mock(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);

  const card = (title: string) => screen.getByText(title).closest("li")?.textContent;
  expect(card("Update greeting copy")).not.toContain("comment");
  expect(card("Refactor auth middleware")).toContain("2 comments");
  expect(card("Adjust retry backoff")).toContain("1 comment");

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy review as Markdown" }));
  });
  expect(writeText).toHaveBeenCalledWith(reviewToMarkdown(fakeResolvedReview, comments));
});

test("no open questions → no 'Before you read the code' card", () => {
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);
  expect(screen.queryByText("Before you read the code")).toBeNull();
});

test("open questions are shown first, with their context", () => {
  renderWithApi(<Overview review={fakeReviewWithQuestions} onBeginReview={() => {}} />);
  const card = screen.getByRole("region", { name: "Before you read the code" });
  expect(card.textContent).toContain("Should the auth refactor be its own PR?");
  expect(card.textContent).toContain("which the PR description does not mention");
  expect(card.querySelectorAll("li")).toHaveLength(2);
});

test("round-trip off → questions shown without 'Raise with the agent'", async () => {
  const getConfig = mock(async () => ({ roundtrip: false }));
  renderWithApi(
    <Overview
      review={fakeReviewWithQuestions}
      onBeginReview={() => {}}
      onRaiseQuestion={() => {}}
    />,
    fakeReviewApi({ roundtrip: false, overrides: { getConfig } }),
  );
  await act(async () => {});
  expect(getConfig).toHaveBeenCalled();
  expect(screen.getByText("Before you read the code")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Raise with the agent" })).toBeNull();
});

test("round-trip on → 'Raise with the agent' starts the note with the question", async () => {
  const onRaiseQuestion = mock((_position: number, _note: string) => {});
  renderWithApi(
    <Overview
      review={fakeReviewWithQuestions}
      onBeginReview={() => {}}
      onRaiseQuestion={onRaiseQuestion}
    />,
    fakeReviewApi({ roundtrip: true }),
  );
  const buttons = await screen.findAllByRole("button", { name: "Raise with the agent" });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[1]!);
  expect(onRaiseQuestion).toHaveBeenCalledWith(
    0,
    "> Is a fixed backoff still right, now that `docs/QUEUE.md` asks for jitter?\n\n",
  );
});

test("the Evidence card shows on the overview, with a muted line when nothing was reported", () => {
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);
  const card = screen.getByRole("region", { name: "Evidence" });
  expect(card.textContent).toContain("No checks were reported for this change.");
});

test("findings: the counts, other findings, and a count on each chapter card", () => {
  renderWithApi(<Overview review={fakeReviewWithFindings} onBeginReview={() => {}} />);
  const card = screen.getByRole("region", { name: "Findings" });
  expect(card.textContent).toContain("2 important · 1 nit · 1 pre-existing");
  expect(card.textContent).toContain("Other findings — on files this change does not touch");
  expect(card.textContent).toContain("src/legacy/cookies.ts line 14 (new)");
  expect(card.textContent).toContain("Not from this change.");
  // The chapter findings are not repeated on the overview.
  expect(card.textContent).not.toContain("Name the 30-minute constant");
  expect(screen.getByText("3 findings")).toBeDefined(); // chapter 2's card
});

test('findings: with round-trip, an "other" finding is answered on the overview', async () => {
  renderWithApi(
    <Overview review={fakeReviewWithFindings} onBeginReview={() => {}} />,
    fakeReviewApi({ review: fakeReviewWithFindings, roundtrip: true }),
  );
  const card = await screen.findByRole("region", { name: "Findings" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Fix" })).toBeDefined());
  expect(card.textContent).toContain("4 with no answer yet");

  // The pre-existing one belongs to no chapter, so this is the only place it
  // can be answered.
  fireEvent.click(screen.getByRole("button", { name: "Fix" }));
  expect(JSON.parse(localStorage.getItem("rb.findings.fake-review") ?? "[]")).toEqual([
    { id: "f-0000dddd", decision: "fix" },
  ]);
  expect(card.textContent).toContain("3 with no answer yet");
  expect(screen.getByText("3 findings · 3 unanswered")).toBeDefined(); // chapter 2's card
  localStorage.removeItem("rb.findings.fake-review");
});

test("no findings → no Findings card", () => {
  renderWithApi(<Overview review={fakeResolvedReview} onBeginReview={() => {}} />);
  expect(screen.queryByRole("region", { name: "Findings" })).toBeNull();
});
