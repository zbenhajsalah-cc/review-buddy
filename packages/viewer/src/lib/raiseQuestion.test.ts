import { expect, test } from "bun:test";
import { raiseQuestionNote } from "./raiseQuestion.ts";

test("quotes the question and leaves room for the answer", () => {
  expect(raiseQuestionNote("Should this be its own PR?")).toBe("> Should this be its own PR?\n\n");
});

test("quotes every line, and trims", () => {
  expect(raiseQuestionNote("  One?\n\nTwo.\n")).toBe("> One?\n>\n> Two.\n\n");
});
