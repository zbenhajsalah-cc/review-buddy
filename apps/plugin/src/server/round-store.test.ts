import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoundState } from "@review-buddy/core/rounds";
import { cleanupRounds, roundKey, roundStore, roundsDir } from "./round-store.ts";

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rb-rounds-"));
  env = { REVIEW_BUDDY_STATE_DIR: dir };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const state = (over: Partial<RoundState> = {}): RoundState => ({
  round: 1,
  files: { "src/a.ts": "aaaa" },
  viewed: ["src/a.ts"],
  comments: [{ chapterIndex: 0, path: "src/a.ts", side: "new", line: 4, body: "Why?" }],
  dismissedFindings: ["f1"],
  ...over,
});

test("roundsDir: the state dir when set, the home folder otherwise", () => {
  expect(roundsDir(env)).toBe(join(dir, "rounds"));
  expect(roundsDir({ REVIEW_BUDDY_STATE_DIR: "  " })).toContain(join(".review-buddy", "rounds"));
  expect(roundsDir({})).toContain(join(".review-buddy", "rounds"));
});

test("roundKey: one key per repo and per thing reviewed, and never a path", () => {
  const worktree = roundKey("/repo");
  expect(worktree).toMatch(/^[0-9a-f]{32}$/);
  expect(worktree).not.toContain("repo");
  // Same change, same key — that is what makes round 2 find round 1.
  expect(roundKey("/repo", { type: "worktree" })).toBe(worktree);
  // Another repo, another source type, another ref: all separate chains.
  expect(roundKey("/other")).not.toBe(worktree);
  expect(roundKey("/repo", { type: "pr", ref: "12" })).not.toBe(worktree);
  expect(roundKey("/repo", { type: "pr", ref: "13" })).not.toBe(
    roundKey("/repo", { type: "pr", ref: "12" }),
  );
  expect(roundKey("/repo", { type: "branch", ref: "12" })).not.toBe(
    roundKey("/repo", { type: "pr", ref: "12" }),
  );
});

test("a change with no state yet reads as no previous round", () => {
  expect(roundStore("/repo", undefined, env).read()).toBeUndefined();
});

test("write then read: the round comes back, in a file only the user can read", () => {
  const store = roundStore("/repo", { type: "pr", ref: "7" }, env);
  store.write(state({ round: 2 }));
  expect(store.read()).toEqual(state({ round: 2 }));

  const file = join(roundsDir(env), `${roundKey("/repo", { type: "pr", ref: "7" })}.json`);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(roundsDir(env)).mode & 0o777).toBe(0o700);
  // Hashes, not code: nothing of the diff is in the file.
  expect(readFileSync(file, "utf8")).not.toContain("+");
});

test("writing twice keeps the mode, and the second round replaces the first", () => {
  const store = roundStore("/repo", undefined, env);
  store.write(state());
  store.write(state({ round: 2, viewed: [] }));
  expect(store.read()?.round).toBe(2);
  expect(store.read()?.viewed).toEqual([]);
  const file = join(roundsDir(env), `${roundKey("/repo")}.json`);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("another change's state is never read as this one's", () => {
  roundStore("/repo", undefined, env).write(state());
  expect(roundStore("/elsewhere", undefined, env).read()).toBeUndefined();
});

test("a hand-edited or half-written file starts the chain over", async () => {
  const store = roundStore("/repo", undefined, env);
  store.write(state());
  const file = join(roundsDir(env), `${roundKey("/repo")}.json`);
  await Bun.write(file, "{ not json");
  expect(store.read()).toBeUndefined();
  await Bun.write(file, JSON.stringify({ round: "two" }));
  expect(store.read()).toBeUndefined();
});

test("clear forgets the change, and clearing twice is fine", () => {
  const store = roundStore("/repo", undefined, env);
  store.write(state());
  store.clear();
  expect(store.read()).toBeUndefined();
  store.clear();
});

test("a folder that cannot be created costs the memory, not the review", async () => {
  // A plain file where the state folder should be: mkdir fails with ENOTDIR,
  // which no permission bit (and no root) talks its way past.
  const blocked = { REVIEW_BUDDY_STATE_DIR: join(dir, "blocked") };
  await Bun.write(join(dir, "blocked"), "not a folder");
  const store = roundStore("/repo", undefined, blocked);
  expect(() => store.write(state())).not.toThrow();
  expect(store.read()).toBeUndefined();
  expect(() => store.clear()).not.toThrow();
  expect(cleanupRounds(blocked)).toBe(0);
});

test("cleanupRounds: old rounds go, recent ones stay, and other files are left alone", async () => {
  const store = roundStore("/repo", undefined, env);
  store.write(state());
  const old = roundStore("/old", undefined, env);
  old.write(state());
  const oldFile = join(roundsDir(env), `${roundKey("/old")}.json`);
  const ancient = Date.now() / 1000 - 15 * 24 * 60 * 60;
  utimesSync(oldFile, ancient, ancient);
  await Bun.write(join(roundsDir(env), "notes.txt"), "mine");

  expect(cleanupRounds(env)).toBe(1);
  expect(old.read()).toBeUndefined();
  expect(store.read()).toEqual(state());
  expect(await Bun.file(join(roundsDir(env), "notes.txt")).text()).toBe("mine");
});

test("cleanupRounds: nothing stored yet is not an error", () => {
  expect(cleanupRounds({ REVIEW_BUDDY_STATE_DIR: join(dir, "nope") })).toBe(0);
});
