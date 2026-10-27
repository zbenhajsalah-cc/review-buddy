/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { fetchFileContent, postDone } from "./api.ts";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

test("fetchFileContent requests the encoded path+side and returns JSON", async () => {
  const calls: string[] = [];
  globalThis.fetch = mock(async (url: string) => {
    calls.push(url);
    return new Response(
      JSON.stringify({ path: "a b.ts", side: "head", language: "ts", content: "x" }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const r = await fetchFileContent("a b.ts", "head");
  expect(calls[0]).toContain("/api/file-content?path=a%20b.ts&side=head");
  expect(r.content).toBe("x");
});

test("getJSON throws on a non-OK response", async () => {
  globalThis.fetch = mock(
    async () => new Response("nope", { status: 403, statusText: "Forbidden" }),
  ) as unknown as typeof fetch;
  await expect(fetchFileContent("x", "head")).rejects.toThrow("403");
});

test("postDone throws on a non-OK response", async () => {
  globalThis.fetch = mock(
    async () => new Response("", { status: 500, statusText: "Error" }),
  ) as unknown as typeof fetch;
  await expect(postDone({ verdict: "approve" })).rejects.toThrow("/api/done");
});
