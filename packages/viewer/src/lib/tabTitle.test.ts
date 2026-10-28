import { expect, test } from "bun:test";
import { tabTitleFor } from "./tabTitle.ts";

test("the title says the review, and the chapter while one is shown", () => {
  expect(tabTitleFor("Fix login", { mode: "overview" }, 7, false)).toBe("Fix login · Review Buddy");
  expect(tabTitleFor("Fix login", { mode: "chapter", position: 2 }, 7, false)).toBe(
    "Ch 3/7 · Fix login",
  );
  expect(tabTitleFor("Fix login", { mode: "chapter", position: 2 }, 7, true)).toBe(
    "Submitted · Fix login",
  );
  expect(tabTitleFor("", { mode: "overview" }, 7, false)).toBe("Untitled review · Review Buddy");
});
