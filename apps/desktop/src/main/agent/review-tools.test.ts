import { describe, expect, test } from "bun:test";
import fixture from "../fixture/review.json" with { type: "json" };
import { connectMcp } from "./mcp-test-client.ts";
import {
  ALLOWED_TOOLS,
  createReviewTools,
  desktopReviewSchema,
  MAX_LINE_CHARS,
  MAX_SUBMISSIONS,
  type ReviewToolsInput,
  splitDiff,
} from "./review-tools.ts";

const files: Record<string, string> = fixture.files;

/** The tools over a real MCP connection, as the agent sees them. */
async function connect(overrides: Partial<ReviewToolsInput> = {}) {
  const steps: string[] = [];
  const tools = createReviewTools({
    label: "octocat/hello-world#42",
    pr: fixture.pr,
    diff: fixture.diff,
    fileContent: async (path, side) => files[`${side}:${path}`] ?? "",
    generatedBy: () => "test-model",
    onProgress: ({ phase, step }) => steps.push(`${phase}: ${step}`),
    ...overrides,
  });
  const client = await connectMcp(tools.server);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool(name, args);
    return { text: res.content.map((c) => c.text).join(""), isError: res.isError === true };
  };
  return { tools, client, call, steps };
}

/** JSON Schema as compared here: no draft marker, no zod's "max safe integer" bound. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k, v]) => k !== "$schema" && !(k === "maximum" && v === Number.MAX_SAFE_INTEGER))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

describe("the tool list", () => {
  test("exactly the three tools, all allowed by name", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["get_pr_diff", "read_file", "submit_review"]);
    expect(ALLOWED_TOOLS).toEqual([
      "mcp__review-buddy__get_pr_diff",
      "mcp__review-buddy__read_file",
      "mcp__review-buddy__submit_review",
    ]);
  });

  test("submit_review's input schema is the shared JSON schema, minus cwd and source", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "submit_review")!.inputSchema;
    const shared = desktopReviewSchema();
    expect(Object.keys(shared.properties).sort()).toEqual(["chapters", "prologue"]);
    // The top level differs only in what the SDK adds or drops around the shape.
    expect(normalize(schema.properties)).toEqual(normalize(shared.properties));
    expect(schema.required).toEqual(shared.required);
  });
});

describe("get_pr_diff", () => {
  test("metadata, then the diff exactly", async () => {
    const { call, steps } = await connect();
    const { text, isError } = await call("get_pr_diff");
    expect(isError).toBe(false);
    expect(text).toStartWith(
      "Pull request octocat/hello-world#42: Friendlier greetings and calmer retries\n",
    );
    expect(text).toContain("Author: @octocat · base `main` ← head `feature/greeting-suffix`");
    expect(text).toContain("The retry change follows the outage on Monday");
    expect(text).toEndWith(`Diff:\n\n${fixture.diff}`);
    expect(steps).toEqual(["reading: Reading the diff"]);
  });

  test("a large diff comes in parts that join to the exact diff", async () => {
    // 4 files of ~15k characters each: 2 parts of at most 40k.
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1,1 +1,1 @@\n-a\n+${"x".repeat(15_000)}\n`;
    const diff = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file).join("");
    const { call, steps } = await connect({ diff });
    const one = await call("get_pr_diff");
    expect(one.text).toContain("Diff, part 1 of 2. Call get_pr_diff with part 2 next.");
    const two = await call("get_pr_diff", { part: 2 });
    expect(two.text).toStartWith("Diff, part 2 of 2. This is the last part.\n\n");
    expect(two.text).not.toContain("Pull request");
    const body = (t: string) => t.slice(t.indexOf("\n\ndiff --git") + 2);
    expect(body(one.text) + body(two.text)).toBe(diff);
    expect(await call("get_pr_diff", { part: 3 })).toEqual({
      text: "There are only 2 part(s).",
      isError: true,
    });
    expect(steps).toEqual([
      "reading: Reading the diff (part 1 of 2)",
      "reading: Reading the diff (part 2 of 2)",
    ]);
  });
});

describe("splitDiff", () => {
  const big = (n: number) => `+${"y".repeat(n)}\n`;
  test("joins back exactly; parts start at files when they can", () => {
    const diff = `diff --git a/a b/a\n@@ -1 +1 @@\n${big(30)}diff --git a/b b/b\n@@ -1 +1 @@\n${big(30)}`;
    const parts = splitDiff(diff, 70);
    expect(parts.join("")).toBe(diff);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.startsWith("diff --git"))).toBe(true);
  });

  test("a file larger than a part is split at hunks, then lines, then inside a line", () => {
    const diff = `diff --git a/a b/a\n@@ -1 +1 @@\n${big(20)}@@ -9 +9 @@\n${big(20)}${big(20)}${big(150)}`;
    const parts = splitDiff(diff, 50);
    expect(parts.join("")).toBe(diff);
    expect(parts.every((p) => p.length <= 50)).toBe(true);
    expect(parts.some((p) => p.startsWith("@@ -9 +9 @@"))).toBe(true);
  });

  test("an empty diff is one empty part", () => {
    expect(splitDiff("")).toEqual([""]);
  });
});

describe("read_file", () => {
  test("numbered lines at the head (default) and the base", async () => {
    const { call, steps } = await connect();
    const head = await call("read_file", { path: "src/retry.ts" });
    const lines = files["head:src/retry.ts"]!.trimEnd().split("\n");
    expect(head.text).toStartWith(
      `src/retry.ts (head), ${lines.length} lines:\n\n1\t${lines[0]}\n`,
    );
    const base = await call("read_file", { path: "src/retry.ts", side: "base" });
    expect(base.text).toContain(`1\t${files["base:src/retry.ts"]!.split("\n")[0]}`);
    expect(steps).toEqual([
      "reading: Reading src/retry.ts",
      "reading: Reading src/retry.ts (before the PR)",
    ]);
  });

  test("a very long line is cut, so a minified file still fits one answer", async () => {
    const minified = `${"m".repeat(500_000)}\nsecond line\n`;
    const { call } = await connect({ fileContent: async () => minified });
    const res = await call("read_file", { path: "src/retry.ts" });
    expect(res.text.length).toBeLessThan(3_000);
    expect(res.text).toContain(
      `1\t${"m".repeat(MAX_LINE_CHARS)} … [line cut: ${500_000 - MAX_LINE_CHARS} more characters]\n2\tsecond line`,
    );
    expect(res.text).toStartWith("src/retry.ts (head), 2 lines:");
  });

  test("only files in the diff", async () => {
    let asked = false;
    const { call } = await connect({
      fileContent: async () => {
        asked = true;
        return "secret";
      },
    });
    for (const path of ["package.json", "../etc/passwd", "src"]) {
      expect(await call("read_file", { path })).toEqual({
        text: `${path} is not a file in this PR's diff; read_file reads only those.`,
        isError: true,
      });
    }
    expect(asked).toBe(false);
  });

  test("no text, read errors, and windows of a long file", async () => {
    const long = Array.from({ length: 5000 }, (_, i) => `line ${i + 1} ${"z".repeat(20)}`).join(
      "\n",
    );
    const { call } = await connect({
      fileContent: async (_path, side) => {
        if (side === "base") throw new Error("GitHub answered 500.");
        return long;
      },
    });
    expect(await call("read_file", { path: "src/retry.ts", side: "base" })).toEqual({
      text: "Could not read src/retry.ts: GitHub answered 500.",
      isError: true,
    });
    const first = await call("read_file", { path: "src/retry.ts" });
    const end = Number(/lines 1–(\d+) of 5000/.exec(first.text)?.[1]);
    expect(end).toBeGreaterThan(1000);
    expect(first.text.length).toBeLessThan(41_000);
    expect(first.text).toContain(`Call read_file with start_line ${end + 1} for more.`);
    const next = await call("read_file", { path: "src/retry.ts", start_line: end + 1 });
    expect(next.text).toContain(`\n\n${end + 1}\tline ${end + 1} `);
    expect((await call("read_file", { path: "src/retry.ts", start_line: 9999 })).isError).toBe(
      true,
    );

    const empty = await connect({ fileContent: async () => "" });
    expect((await empty.call("read_file", { path: "src/retry.ts" })).text).toBe(
      "src/retry.ts has no text at the head: it is binary, does not exist on that side " +
        "(added or deleted in this PR), or is too large.",
    );
  });
});

describe("submit_review", () => {
  test("a matching review is resolved against the same diff and accepted", async () => {
    const { call, tools, steps } = await connect();
    const res = await call("submit_review", fixture.agent);
    expect(res.isError).toBe(false);
    expect(res.text).toStartWith("Review accepted: every anchor matched the diff.");
    const latest = tools.latest()!;
    expect(latest.number).toBe(1);
    expect(latest.warnings).toEqual([]);
    expect(latest.review.pr.title).toBe(fixture.pr.title);
    expect(latest.review.meta.generatedBy).toBe("test-model");
    expect(latest.review.chapters.map((c) => c.title)).toEqual(
      fixture.agent.chapters.map((c) => c.title),
    );
    expect(steps).toEqual([
      "checking: Checking the chapters against the diff",
      "checking: Review submitted",
    ]);
  });

  test("anchors that miss come back as notes; resubmits are capped", async () => {
    const { call, tools } = await connect();
    const wrong = structuredClone(fixture.agent);
    wrong.chapters[0]!.files[0]!.path = "src/nope.ts";
    const first = await call("submit_review", wrong);
    expect(first.isError).toBe(false);
    expect(first.text).toContain("Review received (submission 1 of at most 3)");
    expect(first.text).toContain("src/nope.ts");
    expect(first.text).toContain(
      "You may call submit_review again with the fixes (2 more time(s)).",
    );
    expect(tools.latest()!.warnings.length).toBeGreaterThan(0);

    await call("submit_review", wrong);
    const third = await call("submit_review", wrong);
    expect(third.text).toEndWith("That was the last submission: stop now.");
    const fourth = await call("submit_review", fixture.agent);
    expect(fourth).toEqual({
      text: `The app already has ${MAX_SUBMISSIONS} submissions and shows the last one. Stop now.`,
      isError: true,
    });
    expect(tools.latest()!.number).toBe(3);
  });

  test("an invalid payload is an error and does not count", async () => {
    const { call, tools } = await connect();
    // A chapter index of 0 breaks the schema (minimum 1).
    const bad = structuredClone(fixture.agent) as { chapters: { index: number }[] };
    bad.chapters[0]!.index = 0;
    const res = await call("submit_review", bad);
    expect(res.isError).toBe(true);
    expect(tools.latest()).toBeUndefined();
    expect((await call("submit_review", fixture.agent)).text).toStartWith("Review accepted");
    expect(tools.latest()!.number).toBe(1);
  });
});
