import { expect, test } from "bun:test";
import { roundtripEnabled } from "./session.ts";

test("roundtripEnabled: on by default, off only when turned off", () => {
  expect(roundtripEnabled({})).toBe(true);
  for (const on of ["", "1", "true", "yes", "on"]) {
    expect(roundtripEnabled({ REVIEW_BUDDY_ROUNDTRIP: on })).toBe(true);
  }
  for (const off of ["0", "false", "off", "no", " OFF ", "False"]) {
    expect(roundtripEnabled({ REVIEW_BUDDY_ROUNDTRIP: off })).toBe(false);
  }
});
