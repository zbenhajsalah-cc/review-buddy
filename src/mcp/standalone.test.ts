import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeTempRepo, sampleReview, testGit, VIEWER_URL_RE } from "../test-helpers.ts";
import type { AgentReview } from "../types/review.ts";
import { standaloneMode } from "./mode.ts";
import {
  handleStandaloneSubmit,
  makeShutdown,
  resolveStandaloneCwd,
  stopCurrentSession,
} from "./standalone.ts";

// Capture each session URL from the console.error the session module emits —
// lets blocking-mode tests reach the pending review without module internals.
let lastLoggedUrl: string | undefined;
const origError = console.error;
console.error = (...args: unknown[]) => {
  const m = args.map(String).join(" ").match(VIEWER_URL_RE);
  if (m) lastLoggedUrl = m[0];
  origError(...args);
};

/** Await the next session URL logged after `fn` kicks a session off. */
async function urlOf(fn: () => void): Promise<URL> {
  lastLoggedUrl = undefined;
  fn();
  for (let i = 0; i < 100 && !lastLoggedUrl; i++) await Bun.sleep(20);
  expect(lastLoggedUrl).toBeDefined();
  return new URL(lastLoggedUrl!);
}

let dir: string;

beforeAll(() => {
  process.env.REVIEW_BUDDY_NO_OPEN = "1";
  dir = makeTempRepo("rb-standalone-");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => stopCurrentSession());

const review = (cwd?: string): AgentReview => sampleReview({ cwd });

test("makeShutdown stops the session and exits exactly once (idempotent)", () => {
  let exits = 0;
  const shutdown = makeShutdown(() => {
    exits++;
  });
  shutdown();
  shutdown(); // second call must be a no-op
  expect(exits).toBe(1);
});

test("standaloneMode: argv flag parsing", () => {
  const argv = (...args: string[]) => ["bun", "server.ts", ...args];
  expect(standaloneMode(argv())).toBe("off");
  expect(standaloneMode(argv("--standalone"))).toBe("detached");
  expect(standaloneMode(argv("--standalone=blocking"))).toBe("blocking");
  // A typo'd value must fail loudly at startup, not silently ack every review.
  expect(() => standaloneMode(argv("--standalone=block"))).toThrow("Unknown");
});

test("detached: serves the review, returns the URL immediately, keeps server alive", async () => {
  const res = await handleStandaloneSubmit(review(dir), "detached");
  expect(res.isError).toBeUndefined();
  const m = res.content[0]!.text.match(VIEWER_URL_RE);
  expect(m).not.toBeNull();

  // The viewer must still be live AFTER the tool call returned — that's the
  // whole point of detached mode (harness tool timeouts can't hold a review).
  const r = await fetch(`http://127.0.0.1:${m![1]}/api/review?token=${m![2]}`);
  const body = (await r.json()) as {
    chapters: Array<{ files: Array<{ hunks: Array<{ lines: string[] }> }> }>;
  };
  expect(body.chapters[0]!.files[0]!.hunks[0]!.lines).toContain("+let y = 20;");
});

test("detached: a new submit supersedes the previous viewer", async () => {
  const first = await handleStandaloneSubmit(review(dir), "detached");
  const m1 = first.content[0]!.text.match(VIEWER_URL_RE)!;
  const second = await handleStandaloneSubmit(review(dir), "detached");
  expect(second.isError).toBeUndefined();

  // Old server is stopped; new one serves.
  const dead = await fetch(`http://127.0.0.1:${m1[1]}/api/review?token=${m1[2]}`).then(
    () => false,
    () => true,
  );
  expect(dead).toBe(true);
});

test("detached: a FAILED resubmit keeps the previous viewer alive", async () => {
  const first = await handleStandaloneSubmit(review(dir), "detached");
  const m1 = first.content[0]!.text.match(VIEWER_URL_RE)!;

  // A source.ref that assertSafeRef rejects makes openReviewSession throw.
  const bad = { ...review(dir), source: { type: "branch", ref: "--evil" } };
  const res = await handleStandaloneSubmit(bad, "detached");
  expect(res.isError).toBe(true);

  // The reviewer keeps the viewer they had.
  const r = await fetch(`http://127.0.0.1:${m1[1]}/api/review?token=${m1[2]}`);
  expect(r.status).toBe(200);
});

test("invalid payload returns isError with the reason (no server started)", async () => {
  const res = await handleStandaloneSubmit({ chapters: [] }, "detached");
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("Invalid review payload");
});

test("cwd outside a git repo returns isError naming the cwd field", async () => {
  const notRepo = mkdtempSync(join(tmpdir(), "rb-norepo-"));
  try {
    const res = await handleStandaloneSubmit(review(notRepo), "detached");
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("not inside a git repository");
  } finally {
    rmSync(notRepo, { recursive: true, force: true });
  }
});

test("relative cwd returns isError", async () => {
  const res = await handleStandaloneSubmit(review("./somewhere"), "detached");
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("absolute path");
});

test("cwd fallback: a normal repo still resolves from the process cwd", () => {
  const savedCwd = process.cwd();
  const savedEnv = process.env.REVIEW_BUDDY_CWD;
  delete process.env.REVIEW_BUDDY_CWD;
  const repo = makeTempRepo("rb-cwdfallback-");
  process.chdir(repo);
  try {
    // git canonicalizes the toplevel (e.g. /var → /private/var on macOS).
    expect(resolveStandaloneCwd()).toBe(testGit(repo, "rev-parse", "--show-toplevel").trim());
  } finally {
    process.chdir(savedCwd);
    if (savedEnv !== undefined) process.env.REVIEW_BUDDY_CWD = savedEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("cwd fallback refuses the repo that hosts the package", () => {
  const savedCwd = process.cwd();
  const savedEnv = process.env.REVIEW_BUDDY_CWD;
  delete process.env.REVIEW_BUDDY_CWD;
  // Standalone servers start with cwd = the package dir (plugin install or
  // source checkout); inside a git repo the ambient fallback must refuse
  // rather than silently review the host repo.
  process.chdir(resolve(import.meta.dir, "..", ".."));
  try {
    expect(() => resolveStandaloneCwd()).toThrow("hosting the Review Buddy package");
  } finally {
    process.chdir(savedCwd);
    if (savedEnv !== undefined) process.env.REVIEW_BUDDY_CWD = savedEnv;
  }
});

test("blocking: forces the verdict UI on and returns the request-changes note", async () => {
  let pending!: Promise<Awaited<ReturnType<typeof handleStandaloneSubmit>>>;
  const u = await urlOf(() => {
    pending = handleStandaloneSubmit(review(dir), "blocking");
  });
  const token = u.searchParams.get("token")!;

  // Blocking mode must force the verdict UI on — without it the reviewer only
  // gets a bare Done and the agent could never receive "request changes".
  const config = (await (await fetch(`${u.origin}/api/config?token=${token}`)).json()) as {
    roundtrip: boolean;
  };
  expect(config.roundtrip).toBe(true);

  await fetch(`${u.origin}/api/done?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict: "request_changes", summary: "tighten the null check" }),
  });
  const res = await pending;
  expect(res.isError).toBeUndefined();
  expect(res.content[0]!.text).toContain("tighten the null check");
});

test("blocking: a newer submit supersedes the pending review and unblocks its await", async () => {
  let pending!: Promise<Awaited<ReturnType<typeof handleStandaloneSubmit>>>;
  const old = await urlOf(() => {
    pending = handleStandaloneSubmit(review(dir), "blocking");
  });

  // Second review arrives while the first still awaits its verdict.
  const second = await handleStandaloneSubmit(review(dir), "detached");
  expect(second.isError).toBeUndefined();

  // The first tool call resolves (no hang) and reports the supersession...
  const first = await pending;
  expect(first.content[0]!.text).toContain("superseded");

  // ...its server is stopped, and the new viewer is the live one.
  const oldDead = await fetch(
    `${old.origin}/api/review?token=${old.searchParams.get("token")}`,
  ).then(
    () => false,
    () => true,
  );
  expect(oldDead).toBe(true);
  const m2 = second.content[0]!.text.match(VIEWER_URL_RE)!;
  const alive = await fetch(`http://127.0.0.1:${m2[1]}/api/review?token=${m2[2]}`);
  expect(alive.status).toBe(200);
});

test("detached: resolution warnings are appended to the tool result text", async () => {
  const agent = sampleReview({
    cwd: dir,
    chapters: [
      {
        index: 1,
        title: "Ghost file",
        risk: "Low",
        risk_reason: "tiny",
        description: "points at a missing path",
        files: [{ path: "missing.ts", change_type: "modified" }],
      },
    ],
  });
  const res = await handleStandaloneSubmit(agent, "detached");
  expect(res.isError).toBeUndefined();
  const text = res.content[0]!.text;
  expect(text).toContain("resolution note");
  expect(text).toContain('file "missing.ts" not found in the diff');
  expect(text).toContain("old_start");
});

test("detached: clean review has no resolution-notes block in the tool result", async () => {
  const res = await handleStandaloneSubmit(review(dir), "detached");
  expect(res.isError).toBeUndefined();
  expect(res.content[0]!.text).not.toContain("resolution note");
});
