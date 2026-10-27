/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { parseStored } from "./usePersistedState.ts";

test("parseStored returns initial when raw is null", () => {
  expect(parseStored(null, "init")).toBe("init");
});

test("parseStored returns initial when JSON.parse throws", () => {
  expect(parseStored("{ not json", "init")).toBe("init");
});

test("parseStored returns initial when parsed value is not an array but initial is", () => {
  expect(parseStored('{"a":1}', [])).toEqual([]);
});

test("parseStored merges parsed object over defaults", () => {
  expect(parseStored('{"b":9}', { a: 1, b: 2 })).toEqual({ a: 1, b: 9 });
});

test("parseStored round-trips primitive values", () => {
  expect(parseStored("5", 0)).toBe(5);
});
