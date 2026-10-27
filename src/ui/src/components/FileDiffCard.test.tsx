/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import type { ResolvedFile } from "@review-buddy/core/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { DEFAULT_SETTINGS } from "../settings.ts";

mock.module("@pierre/diffs/react", () => ({
  PatchDiff: () => null,
  FileDiff: () => null,
}));

let fetchImpl: (path: string, side: string) => Promise<{ content: string }>;
mock.module("../api.ts", () => ({
  fetchFileContent: (path: string, side: string) => fetchImpl(path, side),
}));

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
  return render(
    <FileDiffCard
      file={modified}
      settings={DEFAULT_SETTINGS}
      viewed={false}
      collapsed={false}
      onViewedChange={() => {}}
      onSetCollapsed={() => {}}
      {...overrides}
    />,
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
    />,
  );
  expect(screen.getByText(/Binary file/).closest("[hidden]")).toBeNull();
});
