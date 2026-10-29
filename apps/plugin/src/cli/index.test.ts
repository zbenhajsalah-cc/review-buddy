import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTempRepo, sampleReview, testGit, VIEWER_URL_RE } from "../test-helpers.ts";

let dir: string;

beforeAll(() => {
  dir = makeTempRepo("rb-cli-");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Spawn open-review (round-trip on unless `env` turns it off) and wait for its
 * viewer URL. Returns the review's API, `postDone`, and `decision`, which
 * waits for the hook to exit and parses what it printed.
 */
async function startOpenReview(event: unknown, label: string, env: Record<string, string> = {}) {
  const outPath = join(tmpdir(), `rb-cli-out-${label}-${process.pid}.txt`);
  const errPath = join(tmpdir(), `rb-cli-err-${label}-${process.pid}.txt`);
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");

  const { REVIEW_BUDDY_ROUNDTRIP: _, ...baseEnv } = process.env;
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.ts"), "open-review"], {
    cwd: dir,
    env: { ...baseEnv, REVIEW_BUDDY_NO_OPEN: "1", ...env },
    stdin: "pipe",
    stdout: outFd,
    stderr: errFd,
  });
  proc.stdin.write(JSON.stringify(event));
  proc.stdin.end();

  let m: RegExpMatchArray | null = null;
  for (let i = 0; i < 100 && !m; i++) {
    m = readFileSync(errPath, "utf8").match(VIEWER_URL_RE);
    if (!m) await Bun.sleep(50);
  }
  expect(m).not.toBeNull();
  const api = (p: string) => `http://127.0.0.1:${m![1]!}/${p}?token=${m![2]!}`;
  // Cross-process requests use curl (fresh connection each time). Bun's global
  // fetch pools connections to the child server and would reuse a dead socket.
  const curl = (...args: string[]) => execFileSync("curl", ["-s", ...args], { encoding: "utf8" });

  const postDone = (body: unknown) => {
    const out = curl(
      ...["-X", "POST", api("api/done"), "-H", "content-type: application/json"],
      ...["-d", JSON.stringify(body), "-w", "\n%{http_code}"],
    );
    const i = out.lastIndexOf("\n");
    return { status: Number(out.slice(i + 1)), body: JSON.parse(out.slice(0, i)) };
  };
  const decision = async () => {
    const code = await proc.exited;
    closeSync(outFd);
    closeSync(errFd);
    expect(code).toBe(0);
    return JSON.parse(readFileSync(outPath, "utf8"));
  };
  return { api, curl, postDone, decision };
}

/** Spawn open-review, POST Done with `{}`, return parsed decision JSON. */
async function openReviewRoundTrip(event: unknown, label: string) {
  const review = await startOpenReview(event, label);
  review.postDone({});
  return review.decision();
}

test("open-review: stdin hook event -> serves review -> returns allow on Done", async () => {
  const agent = sampleReview();
  const event = {
    tool_name: "mcp__plugin_review-buddy_review-buddy__submit_review",
    tool_input: agent,
    cwd: dir,
  };

  // Redirect child stdout/stderr to files (no pipe backpressure / lock issues).
  // Kept OUTSIDE the repo so they aren't captured as untracked changes.
  const outPath = join(tmpdir(), `rb-cli-out-${process.pid}.txt`);
  const errPath = join(tmpdir(), `rb-cli-err-${process.pid}.txt`);
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");

  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.ts"), "open-review"], {
    cwd: dir,
    env: { ...process.env, REVIEW_BUDDY_NO_OPEN: "1" },
    stdin: "pipe",
    stdout: outFd,
    stderr: errFd,
  });
  proc.stdin.write(JSON.stringify(event));
  proc.stdin.end();

  // Discover the ephemeral port + token from the stderr file.
  let m: RegExpMatchArray | null = null;
  for (let i = 0; i < 100 && !m; i++) {
    m = readFileSync(errPath, "utf8").match(VIEWER_URL_RE);
    if (!m) await Bun.sleep(50);
  }
  expect(m).not.toBeNull();
  const port = m![1]!;
  const token = m![2]!;
  const api = (p: string) => `http://127.0.0.1:${port}/${p}?token=${token}`;

  // Cross-process requests use curl (fresh connection each time). Bun's global
  // fetch pools connections to the child server and would reuse a dead socket.
  const curl = (...args: string[]) => execFileSync("curl", ["-s", ...args], { encoding: "utf8" });

  // Served review must carry the real hunk content (reference-not-reproduce).
  const review = JSON.parse(curl(api("api/review")));
  expect(review.chapters[0].files[0].hunks[0].lines).toContain("+let y = 20;");

  // Reviewer clicks Done -> hook unblocks and prints the allow decision.
  curl("-X", "POST", api("api/done"), "-H", "content-type: application/json", "-d", "{}");
  await proc.exited;
  closeSync(outFd);
  closeSync(errFd);

  const decision = JSON.parse(readFileSync(outPath, "utf8"));
  expect(decision.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(decision.hookSpecificOutput.permissionDecision).toBe("allow");
}, 20_000);

const hookEvent = () => ({
  tool_name: "mcp__plugin_review-buddy_review-buddy__submit_review",
  tool_input: sampleReview(),
  cwd: dir,
});

const lineComment = {
  chapterIndex: 1,
  path: "app.ts",
  side: "new",
  line: 2,
  body: "Why 20?",
};

test("open-review: request changes denies with the note and the line comments", async () => {
  const review = await startOpenReview(hookEvent(), "deny");
  // Round-trip is on by default: the viewer shows the verdict UI.
  expect(JSON.parse(review.curl(review.api("api/config"))).roundtrip).toBe(true);

  const res = review.postDone({
    verdict: "request_changes",
    summary: "tighten the null check",
    comments: [lineComment],
  });
  expect(res).toEqual({ status: 200, body: { ok: true } });

  const out = (await review.decision()).hookSpecificOutput;
  expect(out.hookEventName).toBe("PreToolUse");
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toContain(
    "Reviewer requested changes:\n\ntighten the null check",
  );
  expect(out.permissionDecisionReason).toContain("- `app.ts` line 2 (new): Why 20?");
}, 20_000);

test("open-review: a malformed Done is refused and the hook keeps waiting", async () => {
  const review = await startOpenReview(hookEvent(), "bad-done");
  const bad = review.postDone({ verdict: "request_changes", summary: 123 });
  expect(bad.status).toBe(400);
  expect(bad.body.error).toContain("summary");

  // Still blocked: the reviewer can try again.
  expect(review.postDone({ verdict: "request_changes" }).status).toBe(200);
  const out = (await review.decision()).hookSpecificOutput;
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toContain("no details provided");
}, 20_000);

test("open-review: an approval with comments allows and passes them as additionalContext", async () => {
  const review = await startOpenReview(hookEvent(), "approve");
  review.postDone({ verdict: "approve", comments: [lineComment] });
  const out = (await review.decision()).hookSpecificOutput;
  expect(out.permissionDecision).toBe("allow");
  expect(out.additionalContext).toContain("Reviewer approved, with comments.");
  expect(out.additionalContext).toContain("- `app.ts` line 2 (new): Why 20?");
}, 20_000);

test("open-review: REVIEW_BUDDY_ROUNDTRIP=0 is the one-way viewer: always allow", async () => {
  const review = await startOpenReview(hookEvent(), "oneway", { REVIEW_BUDDY_ROUNDTRIP: "0" });
  expect(JSON.parse(review.curl(review.api("api/config"))).roundtrip).toBe(false);
  review.postDone({ verdict: "request_changes", summary: "ignored", comments: [lineComment] });
  const out = (await review.decision()).hookSpecificOutput;
  expect(out.permissionDecision).toBe("allow");
  expect(out.permissionDecisionReason).toBe("Review viewed by the human.");
  expect("additionalContext" in out).toBe(false);
}, 20_000);

test("open-review: resolution warnings ride back as additionalContext", async () => {
  // Chapter references a path absent from the diff → resolver warns.
  const agent = sampleReview({
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
  const event = {
    tool_name: "mcp__plugin_review-buddy_review-buddy__submit_review",
    tool_input: agent,
    cwd: dir,
  };

  const decision = await openReviewRoundTrip(event, "warn");
  expect(decision.hookSpecificOutput.permissionDecision).toBe("allow");
  expect(decision.hookSpecificOutput.additionalContext).toContain(
    'file "missing.ts" not found in the diff',
  );
}, 20_000);

test("open-review: clean review omits additionalContext from the decision JSON", async () => {
  const agent = sampleReview();
  const event = {
    tool_name: "mcp__plugin_review-buddy_review-buddy__submit_review",
    tool_input: agent,
    cwd: dir,
  };

  const decision = await openReviewRoundTrip(event, "clean");
  expect(decision.hookSpecificOutput.permissionDecision).toBe("allow");
  expect("additionalContext" in decision.hookSpecificOutput).toBe(false);
}, 20_000);

test("open-review: source.type=branch captures the diff against the given base ref", async () => {
  // Commit the pending change, then review it against the base commit via a
  // branch source — exercises the source-routing added for PR/branch reviews.
  testGit(dir, "add", "-A");
  testGit(dir, "commit", "-q", "-m", "change");

  const agent = sampleReview({ source: { type: "branch", ref: "HEAD~1" } });
  const event = { tool_name: "mcp__review-buddy__submit_review", tool_input: agent, cwd: dir };

  const outPath = join(tmpdir(), `rb-cli-out2-${process.pid}.txt`);
  const errPath = join(tmpdir(), `rb-cli-err2-${process.pid}.txt`);
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");

  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.ts"), "open-review"], {
    cwd: dir,
    env: { ...process.env, REVIEW_BUDDY_NO_OPEN: "1" },
    stdin: "pipe",
    stdout: outFd,
    stderr: errFd,
  });
  proc.stdin.write(JSON.stringify(event));
  proc.stdin.end();

  let m: RegExpMatchArray | null = null;
  for (let i = 0; i < 100 && !m; i++) {
    m = readFileSync(errPath, "utf8").match(VIEWER_URL_RE);
    if (!m) await Bun.sleep(50);
  }
  expect(m).not.toBeNull();
  const api = (p: string) => `http://127.0.0.1:${m![1]!}/${p}?token=${m![2]!}`;
  const curl = (...args: string[]) => execFileSync("curl", ["-s", ...args], { encoding: "utf8" });

  // Diff vs base commit resolves the branch's real hunk (not an empty worktree).
  const review = JSON.parse(curl(api("api/review")));
  expect(review.chapters[0].files[0].hunks[0].lines).toContain("+let y = 20;");

  curl("-X", "POST", api("api/done"), "-H", "content-type: application/json", "-d", "{}");
  await proc.exited;
  closeSync(outFd);
  closeSync(errFd);
}, 20_000);

test("open-review: invalid chapter index fails open without starting server", async () => {
  const agent = sampleReview();
  agent.chapters[0]!.index = -1; // fails the hook's structural backstop
  const event = {
    tool_name: "mcp__plugin_review-buddy_review-buddy__submit_review",
    tool_input: agent,
    cwd: dir,
  };

  const outPath = join(tmpdir(), `rb-cli-out3-${process.pid}.txt`);
  const errPath = join(tmpdir(), `rb-cli-err3-${process.pid}.txt`);
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");

  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.ts"), "open-review"], {
    cwd: dir,
    env: { ...process.env, REVIEW_BUDDY_NO_OPEN: "1" },
    stdin: "pipe",
    stdout: outFd,
    stderr: errFd,
  });
  proc.stdin.write(JSON.stringify(event));
  proc.stdin.end();

  await proc.exited;
  closeSync(outFd);
  closeSync(errFd);

  const decision = JSON.parse(readFileSync(outPath, "utf8"));
  expect(decision.hookSpecificOutput.permissionDecision).toBe("allow");
  const err = readFileSync(errPath, "utf8");
  expect(err).toContain("Invalid review payload");
  expect(err).not.toContain("Review ready at");
}, 20_000);
