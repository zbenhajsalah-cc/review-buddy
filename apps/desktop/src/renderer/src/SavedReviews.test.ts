import { expect, test } from "bun:test";
import { formatBytes } from "./SavedReviews.tsx";

test("formatBytes", () => {
  expect(formatBytes(820)).toBe("820 B");
  expect(formatBytes(14 * 1024 + 100)).toBe("14 KB");
  expect(formatBytes(2.34 * 1024 * 1024)).toBe("2.3 MB");
});
