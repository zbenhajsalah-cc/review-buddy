/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

afterEach(cleanup);

// Elements that can't legally sit inside a <p> (phrasing content only).
const BLOCK_SELECTOR =
  "div, p, ul, ol, li, h1, h2, h3, h4, h5, h6, pre, blockquote, table, hr, section";

function renderInsideP(value: string) {
  render(
    <p data-testid="host">
      <Markdown value={value} variant="inline" className="inline" />
    </p>,
  );
  const host = document.querySelector("p[data-testid=host]");
  if (!host) throw new Error("host <p> not rendered");
  return host;
}

test("inline variant renders a <span> wrapper with no block elements inside a <p>", () => {
  const host = renderInsideP("Check **the token** in `auth.ts` and [docs](https://x.test).");

  expect(host.firstElementChild?.tagName).toBe("SPAN");
  expect(host.querySelectorAll(BLOCK_SELECTOR).length).toBe(0);
  expect(host.querySelector("strong")?.textContent).toBe("the token");
  expect(host.querySelector("code")?.textContent).toBe("auth.ts");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("https://x.test");
});

test("inline variant unwraps block markdown (paragraphs, lists, headings, fences) to text", () => {
  const host = renderInsideP(
    "First para.\n\nSecond para.\n\n- one\n- two\n\n## Heading\n\n> quote\n\n```\nfenced\n```",
  );

  expect(host.querySelectorAll(BLOCK_SELECTOR).length).toBe(0);
  const text = host.textContent ?? "";
  for (const part of ["First para.", "Second para.", "one", "two", "Heading", "quote", "fenced"]) {
    expect(text).toContain(part);
  }
});

test("block variant keeps the <div> wrapper and real paragraphs", () => {
  render(
    <article data-testid="host">
      <Markdown value={"A\n\nB"} />
    </article>,
  );
  const host = document.querySelector("article[data-testid=host]");

  expect(host?.firstElementChild?.tagName).toBe("DIV");
  expect(host?.querySelectorAll("p").length).toBe(2);
});
