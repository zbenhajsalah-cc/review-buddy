/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { hashOfView, viewFromHash } from "./view.ts";

test("#/chapter/N is the Nth chapter, both ways", () => {
  expect(viewFromHash("#/chapter/3")).toEqual({ mode: "chapter", position: 2 });
  expect(hashOfView({ mode: "chapter", position: 2 })).toBe("#/chapter/3");
  expect(hashOfView({ mode: "overview" })).toBe("");
});

test("anything else is the overview", () => {
  for (const hash of ["", "#", "#/chapter/0", "#/chapter/-1", "#/chapter/2x", "#/chapter/99999"]) {
    expect(viewFromHash(hash)).toEqual({ mode: "overview" });
  }
});
