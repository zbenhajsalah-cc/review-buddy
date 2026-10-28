/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import type { SelectedLineRange } from "@pierre/diffs";
import type { PatchDiffProps } from "@pierre/diffs/react";
import type { ResolvedFile } from "@review-buddy/core/types";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderWithApi } from "../../test/render.tsx";
import type { LineComment } from "../lib/comments.ts";
import { DEFAULT_SETTINGS } from "../settings.ts";
import { fakeReviewApi } from "../stories/fixtures.ts";

// Like @pierre/diffs: the annotation slots are keyed by index, and the gutter
// "+" reports its lines (`pick`), then selects them.
let pick: SelectedLineRange = { start: 2, end: 2, side: "additions" };
function FakeDiff({
  options,
  lineAnnotations = [],
  renderAnnotation,
  selectedLines,
}: PatchDiffProps<string>) {
  return (
    <div data-testid="diff" data-selected={selectedLines ? "yes" : "no"}>
      <button
        type="button"
        onClick={() => {
          options?.onGutterUtilityClick?.(pick);
          options?.onLineSelected?.(pick);
        }}
      >
        gutter +
      </button>
      {lineAnnotations.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: what @pierre/diffs does
        <div key={i}>{renderAnnotation?.(a)}</div>
      ))}
    </div>
  );
}
mock.module("@pierre/diffs/react", () => ({
  PatchDiff: FakeDiff,
  FileDiff: FakeDiff,
}));

let fetchImpl: (path: string, side: string) => Promise<{ content: string }>;
const api = fakeReviewApi({
  overrides: {
    getFileContent: async (path, side) => ({
      path,
      side,
      language: "",
      ...(await fetchImpl(path, side)),
    }),
  },
});

const { FileDiffCard } = await import("./FileDiffCard.tsx");
afterEach(cleanup);

const modified: ResolvedFile = {
  path: "app.ts",
  change_type: "modified",
  additions: 1,
  deletions: 1,
  language: "ts",
  hunks: [
    {
      old_start: 1,
      old_lines: 1,
      new_start: 1,
      new_lines: 1,
      header: "@@",
      lines: [" a", "-b", "+c"],
    },
  ],
};

function renderCard(overrides: Partial<ComponentProps<typeof FileDiffCard>> = {}) {
  return renderWithApi(
    <FileDiffCard
      file={modified}
      settings={DEFAULT_SETTINGS}
      viewed={false}
      collapsed={false}
      onViewedChange={() => {}}
      onSetCollapsed={() => {}}
      onAddComment={() => {}}
      onEditComment={() => {}}
      onDeleteComment={() => {}}
      {...overrides}
    />,
    api,
  );
}

test("expand surfaces an error notice when file-content fetch rejects", async () => {
  fetchImpl = async () => {
    throw new Error("boom");
  };
  renderCard();
  fireEvent.click(screen.getByText("expand"));
  await waitFor(() => expect(screen.getByText(/Full file unavailable/)).toBeDefined());
});

test("expand shows the unavailable notice when required content is empty", async () => {
  fetchImpl = async () => ({ content: "" });
  renderCard();
  fireEvent.click(screen.getByText("expand"));
  await waitFor(() => expect(screen.getByText(/Full file unavailable/)).toBeDefined());
});

test("checking viewed calls onViewedChange(path, true)", () => {
  const onViewedChange = mock(() => {});
  renderCard({ onViewedChange });
  fireEvent.click(screen.getByLabelText("viewed"));
  expect(onViewedChange).toHaveBeenCalledWith("app.ts", true);
});

test("unchecking viewed calls onViewedChange(path, false)", () => {
  const onViewedChange = mock(() => {});
  renderCard({ viewed: true, collapsed: true, onViewedChange });
  fireEvent.click(screen.getByLabelText("viewed"));
  expect(onViewedChange).toHaveBeenCalledWith("app.ts", false);
});

test("when collapsed, the diff body is hidden and the caret expands", () => {
  const onSetCollapsed = mock(() => {});
  const binary: ResolvedFile = { ...modified, binary: true, hunks: [] };
  renderCard({ file: binary, collapsed: true, onSetCollapsed });
  expect(screen.queryByText(/Binary file/)).toBeNull();
  fireEvent.click(screen.getByLabelText("Expand file"));
  expect(onSetCollapsed).toHaveBeenCalledWith("app.ts", false);
});

test("collapsing after expand keeps the body mounted but hidden", () => {
  const binary: ResolvedFile = { ...modified, binary: true, hunks: [] };
  const { rerender } = renderCard({ file: binary, collapsed: false });
  const body = screen.getByText(/Binary file/);
  expect(body.closest("[hidden]")).toBeNull();

  rerender(
    <FileDiffCard
      file={binary}
      settings={DEFAULT_SETTINGS}
      viewed={false}
      collapsed={true}
      onViewedChange={() => {}}
      onSetCollapsed={() => {}}
      onAddComment={() => {}}
      onEditComment={() => {}}
      onDeleteComment={() => {}}
    />,
  );
  expect(screen.getByText(/Binary file/).closest("[hidden]")).not.toBeNull();

  rerender(
    <FileDiffCard
      file={binary}
      settings={DEFAULT_SETTINGS}
      viewed={false}
      collapsed={false}
      onViewedChange={() => {}}
      onSetCollapsed={() => {}}
      onAddComment={() => {}}
      onEditComment={() => {}}
      onDeleteComment={() => {}}
    />,
  );
  expect(screen.getByText(/Binary file/).closest("[hidden]")).toBeNull();
});

const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;

test("the gutter + opens a form on its line, and Comment saves it", () => {
  pick = { start: 2, end: 2, side: "additions" };
  const onAddComment = mock(() => {});
  renderCard({ onAddComment });
  fireEvent.click(screen.getByText("gutter +"));
  expect(screen.getByLabelText("Comment on line 2 (new)")).toBe(textarea());
  expect(document.activeElement).toBe(textarea());

  const save = screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true); // nothing to say yet
  fireEvent.change(textarea(), { target: { value: "  Looks off.\n" } });
  fireEvent.click(save);
  expect(onAddComment).toHaveBeenCalledWith("app.ts", { side: "new", line: 2 }, "Looks off.");
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("⌘/Ctrl+Enter saves; Esc and Cancel close without saving", () => {
  const onAddComment = mock(() => {});
  renderCard({ onAddComment });
  fireEvent.click(screen.getByText("gutter +"));
  fireEvent.keyDown(textarea(), { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();

  fireEvent.click(screen.getByText("gutter +"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(onAddComment).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("gutter +"));
  fireEvent.change(textarea(), { target: { value: "Quick one" } });
  fireEvent.keyDown(textarea(), { key: "Enter", ctrlKey: true });
  expect(onAddComment).toHaveBeenCalledTimes(1);
});

test("lines dragged over: the form names them, and they are not left selected", () => {
  pick = { start: 3, end: 1, side: "additions" };
  renderCard();
  fireEvent.click(screen.getByText("gutter +"));
  expect(screen.getByLabelText("Comment on lines 1-3 (new)")).toBeDefined();
  // A selection would pin the "+" to these lines.
  expect(screen.getByTestId("diff").dataset.selected).toBe("no");
});

const shown: LineComment = {
  id: "c1",
  chapterIndex: 1,
  path: "app.ts",
  side: "new",
  line: 1,
  body: "Rename **c**?",
};

test("comments show under their lines, and can be edited and deleted", () => {
  const onEditComment = mock(() => {});
  const onDeleteComment = mock(() => {});
  renderCard({ comments: [shown], onEditComment, onDeleteComment });
  expect(screen.getByText("line 1 (new)")).toBeDefined();
  expect(screen.getByText("c").tagName).toBe("STRONG"); // Markdown

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(textarea().value).toBe("Rename **c**?");
  fireEvent.change(textarea(), { target: { value: "Rename c to d? " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onEditComment).toHaveBeenCalledWith("c1", "Rename c to d?");

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByText("Delete this comment?")).toBeDefined();
  expect(onDeleteComment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onDeleteComment).toHaveBeenCalledWith("c1");
});

test("an open form keeps its text when a comment is added above it", () => {
  pick = { start: 5, end: 5, side: "additions" };
  const props = {
    file: modified,
    settings: DEFAULT_SETTINGS,
    viewed: false,
    collapsed: false,
    onViewedChange: () => {},
    onSetCollapsed: () => {},
    onAddComment: () => {},
    onEditComment: () => {},
    onDeleteComment: () => {},
  };
  const { rerender } = renderWithApi(<FileDiffCard {...props} />, api);
  fireEvent.click(screen.getByText("gutter +"));
  fireEvent.change(textarea(), { target: { value: "Half a thought" } });

  // The new comment's slot comes first: the form's slot moves.
  rerender(<FileDiffCard {...props} comments={[shown]} />);
  expect(screen.getByText("line 1 (new)")).toBeDefined();
  expect(textarea().value).toBe("Half a thought");
});

test("full-file view: a range across sides is ordered by the whole file's changes", async () => {
  // This chapter has only the two added lines; another chapter has the
  // deleted i and j, which the full-file view also shows.
  const base = `${"a b c d e f g h i j k l".split(" ").join("\n")}\n`;
  const head = `${"a b c d e f x y g h k l".split(" ").join("\n")}\n`;
  fetchImpl = async (_path, side) => ({ content: side === "base" ? base : head });
  const insertOnly: ResolvedFile = {
    ...modified,
    hunks: [
      {
        old_start: 6,
        old_lines: 0,
        new_start: 7,
        new_lines: 2,
        header: "@@ -6,0 +7,2 @@",
        lines: ["+x", "+y"],
      },
    ],
  };
  renderCard({ file: insertOnly });
  fireEvent.click(screen.getByText("expand"));
  await waitFor(() => expect(screen.getByText("collapse to diff")).toBeDefined());

  // Dragged up from k (new 11) to the deleted j (old 10), which is above k.
  pick = { start: 11, side: "additions", end: 10, endSide: "deletions" };
  fireEvent.click(screen.getByText("gutter +"));
  expect(screen.getByLabelText("Comment on lines 10 (old) to 11 (new)")).toBeDefined();
});
