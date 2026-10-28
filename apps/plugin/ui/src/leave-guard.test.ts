/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { guardUnfinishedReview } from "./leave-guard.ts";

function leave(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

test("asks before the tab closes while the review is not done, not after", () => {
  let finished = false;
  const stop = guardUnfinishedReview(() => finished);
  try {
    expect(leave().defaultPrevented).toBe(true);
    finished = true;
    expect(leave().defaultPrevented).toBe(false);
  } finally {
    stop();
  }
});

test("the returned function removes the guard", () => {
  guardUnfinishedReview(() => false)();
  expect(leave().defaultPrevented).toBe(false);
});
