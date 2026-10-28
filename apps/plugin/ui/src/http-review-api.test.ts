/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { httpReviewApi, reviewFinished } from "./http-review-api.ts";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

test("getFileContent requests the encoded path+side and returns JSON", async () => {
  const calls: string[] = [];
  globalThis.fetch = mock(async (url: string) => {
    calls.push(url);
    return new Response(
      JSON.stringify({ path: "a b.ts", side: "head", language: "ts", content: "x" }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const r = await httpReviewApi.getFileContent("a b.ts", "head");
  expect(calls[0]).toContain("/api/file-content?path=a%20b.ts&side=head");
  expect(r.content).toBe("x");
});

test("getJSON throws on a non-OK response", async () => {
  globalThis.fetch = mock(
    async () => new Response("nope", { status: 403, statusText: "Forbidden" }),
  ) as unknown as typeof fetch;
  await expect(httpReviewApi.getFileContent("x", "head")).rejects.toThrow("403");
});

test("done throws on a non-OK response", async () => {
  globalThis.fetch = mock(
    async () => new Response("", { status: 500, statusText: "Error" }),
  ) as unknown as typeof fetch;
  await expect(httpReviewApi.done({ verdict: "approve" })).rejects.toThrow("/api/done");
  expect(reviewFinished()).toBe(false);
});

test("the review is finished once the server takes Done", async () => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 204 }),
  ) as unknown as typeof fetch;
  await httpReviewApi.done({});
  expect(reviewFinished()).toBe(true);
});

test("reviewKey is the URL token, which session.ts removes from the address bar", () => {
  expect(httpReviewApi.reviewKey).toBe("test-token");
  expect(location.search).toBe("");
});
