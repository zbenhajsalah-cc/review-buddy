import { describe, expect, test } from "bun:test";
import { parseDiff } from "./diff.ts";
import { detectMoves } from "./moves.ts";

/** A hunk body: every line of `text` with `sign` in front. */
const signed = (sign: string, text: string) =>
  text
    .split("\n")
    .map((l) => sign + l)
    .join("\n");

const BLOCK = `export function formatPrice(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return \`$\${rounded.toFixed(2)}\`;
}`;

const fileDiff = (path: string, hunks: string) =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunks}\n`;

describe("detectMoves", () => {
  test("a block moved between two files", () => {
    const diff =
      fileDiff("src/cart.ts", `@@ -10,6 +10,2 @@\n ctx\n${signed("-", BLOCK)}\n ctx`) +
      fileDiff("src/money.ts", `@@ -1,2 +1,6 @@\n ctx\n${signed("+", BLOCK)}\n ctx`);
    expect(detectMoves(parseDiff(diff))).toEqual([
      {
        kind: "moved",
        from: { path: "src/cart.ts", start: 11, lines: 4 },
        to: { path: "src/money.ts", start: 2, lines: 4 },
        whitespaceChanged: false,
      },
    ]);
  });

  test("a block moved inside one file, with new indentation", () => {
    const indented = BLOCK.split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    const diff = fileDiff(
      "src/cart.ts",
      `@@ -5,6 +5,2 @@\n ctx\n${signed("-", BLOCK)}\n ctx\n` +
        `@@ -40,2 +36,6 @@\n ctx\n${signed("+", indented)}\n ctx`,
    );
    expect(detectMoves(parseDiff(diff))).toEqual([
      {
        kind: "moved",
        from: { path: "src/cart.ts", start: 6, lines: 4 },
        to: { path: "src/cart.ts", start: 37, lines: 4 },
        whitespaceChanged: true,
      },
    ]);
  });

  test("a multiline string whose leading spaces changed is found, but flagged as not identical", () => {
    // The spaces before "Product" are part of the string's value: trimming
    // finds the block, and the flag stops the viewer from calling it identical.
    const before = "const label = `\n  Product name and price\n  Total with tax\n`;";
    const after = "const label = `\nProduct name and price\nTotal with tax\n`;";
    const diff =
      fileDiff("a.ts", `@@ -1,4 +0,0 @@\n${signed("-", before)}`) +
      fileDiff("b.ts", `@@ -0,0 +1,4 @@\n${signed("+", after)}`);
    const [move] = detectMoves(parseDiff(diff));
    expect(move?.whitespaceChanged).toBe(true);
  });

  test("a block re-indented in place is not a move", () => {
    const indented = BLOCK.split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    const diff = fileDiff(
      "src/cart.ts",
      `@@ -5,6 +5,6 @@\n ctx\n${signed("-", BLOCK)}\n${signed("+", indented)}\n ctx`,
    );
    expect(detectMoves(parseDiff(diff))).toEqual([]);
  });

  test("a small block is not a move", () => {
    const small = "  }\n}\n});";
    const diff =
      fileDiff("a.ts", `@@ -10,5 +10,2 @@\n ctx\n${signed("-", small)}\n ctx`) +
      fileDiff("b.ts", `@@ -1,2 +1,5 @@\n ctx\n${signed("+", small)}\n ctx`);
    expect(detectMoves(parseDiff(diff))).toEqual([]);
  });

  test("an edited line splits the move; only the unchanged parts are marked", () => {
    const before = `${BLOCK}\nconst TAX = 0.2;\n${BLOCK.replaceAll("Price", "Total")}`;
    const after = `${BLOCK}\nconst TAX = 0.25;\n${BLOCK.replaceAll("Price", "Total")}`;
    const diff =
      fileDiff("a.ts", `@@ -1,9 +0,0 @@\n${signed("-", before)}`) +
      fileDiff("b.ts", `@@ -0,0 +1,9 @@\n${signed("+", after)}`);
    const moves = detectMoves(parseDiff(diff));
    expect(moves.map((m) => [m.from.start, m.to.start, m.from.lines])).toEqual([
      [1, 1, 4],
      [6, 6, 4],
    ]);
  });

  test("the same removed block added twice: a move, then a copy", () => {
    const diff =
      fileDiff("a.ts", `@@ -1,4 +0,0 @@\n${signed("-", BLOCK)}`) +
      fileDiff("b.ts", `@@ -0,0 +1,4 @@\n${signed("+", BLOCK)}`) +
      fileDiff("c.ts", `@@ -0,0 +1,4 @@\n${signed("+", BLOCK)}`);
    expect(detectMoves(parseDiff(diff)).map((m) => [m.kind, m.to.path])).toEqual([
      ["moved", "b.ts"],
      ["copied", "c.ts"],
    ]);
  });

  test("blank lines inside a block are kept, at its end they are dropped", () => {
    const withBlank = BLOCK.replace("\n  return", "\n\n  return");
    const diff =
      fileDiff("a.ts", `@@ -1,6 +0,0 @@\n${signed("-", `${withBlank}\n`)}`) +
      fileDiff("b.ts", `@@ -0,0 +1,6 @@\n${signed("+", `${withBlank}\n`)}`);
    expect(detectMoves(parseDiff(diff))[0]?.to).toEqual({ path: "b.ts", start: 1, lines: 5 });
  });

  test("noise files are left out", () => {
    const diff =
      fileDiff("a.ts", `@@ -1,4 +0,0 @@\n${signed("-", BLOCK)}`) +
      fileDiff("pnpm-lock.yaml", `@@ -0,0 +1,4 @@\n${signed("+", BLOCK)}`);
    expect(detectMoves(parseDiff(diff))).toEqual([]);
  });

  test("a renamed file: both ends name the new path", () => {
    const diff =
      `diff --git a/old/cart.ts b/new/cart.ts\nsimilarity index 80%\nrename from old/cart.ts\nrename to new/cart.ts\n--- a/old/cart.ts\n+++ b/new/cart.ts\n` +
      `@@ -1,5 +1,1 @@\n${signed("-", BLOCK)}\n ctx\n@@ -20,1 +16,5 @@\n ctx\n${signed("+", BLOCK)}\n`;
    const [move] = detectMoves(parseDiff(diff));
    expect(move?.from.path).toBe("new/cart.ts");
    expect(move?.to).toEqual({ path: "new/cart.ts", start: 17, lines: 4 });
  });
});
