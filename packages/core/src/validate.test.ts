import { expect, test } from "bun:test";
import { validateAgentReview } from "./validate.ts";

const good = {
  prologue: {
    why: "w",
    what: "x",
    key_changes: [{ headline: "h", detail: "d" }],
    review_focus: { summary: "s", file: "app.ts" },
  },
  chapters: [
    {
      index: 1,
      title: "t",
      risk: "Low",
      risk_reason: "r",
      description: "d",
      files: [{ path: "app.ts", change_type: "modified" }],
    },
  ],
};

test("accepts a well-formed agent review", () => {
  expect(validateAgentReview(good)).toBeNull();
});

test("accepts extra keys (source/stats) without stripping-driven failure", () => {
  expect(validateAgentReview({ ...good, source: { type: "pr", ref: "42" }, stats: {} })).toBeNull();
});

test("rejects chapter index < 1 (kills the -1 sentinel)", () => {
  const bad = { ...good, chapters: [{ ...good.chapters[0], index: -1 }] };
  expect(validateAgentReview(bad)).toContain("index");
});

test("rejects a risk value outside the enum", () => {
  const bad = { ...good, chapters: [{ ...good.chapters[0], risk: "Critical" }] };
  expect(validateAgentReview(bad)).not.toBeNull();
});

test("rejects a missing prologue field", () => {
  const { why, ...restProl } = good.prologue;
  expect(validateAgentReview({ ...good, prologue: restProl })).not.toBeNull();
});

test("rejects source.type pr without a ref (silent-worktree bug)", () => {
  const bad = { ...good, source: { type: "pr" } };
  const msg = validateAgentReview(bad);
  expect(msg).not.toBeNull();
  expect(msg).toContain("ref");
});

test("rejects source.type branch without a ref", () => {
  const bad = { ...good, source: { type: "branch" } };
  expect(validateAgentReview(bad)).not.toBeNull();
});

test("rejects an unknown source.type", () => {
  const bad = { ...good, source: { type: "prr", ref: "42" } };
  expect(validateAgentReview(bad)).not.toBeNull();
});

test("still accepts a valid pr source and absent source", () => {
  expect(validateAgentReview({ ...good, source: { type: "pr", ref: "42" } })).toBeNull();
  expect(validateAgentReview(good)).toBeNull();
});

test("rejects an absurd chapter count (size cap)", () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ ...good.chapters[0], index: i + 1 }));
  expect(validateAgentReview({ ...good, chapters: many })).not.toBeNull();
});
