/**
 * Where a round's state lives between submissions (plan 020).
 *
 * localStorage cannot carry viewed marks across rounds: each submission is
 * served on a new ephemeral port, and a new port is a new origin with its own
 * empty storage. So the server keeps one small file per change, outside the
 * repo, and hands the previous round to the next review.
 *
 * What it holds is in `RoundState` (core/rounds.ts): file fingerprints, viewed
 * paths, the reviewer's own comments, dismissed finding ids. No diff text and
 * no source code — only hashes of it.
 *
 * Nothing here is allowed to stop a review. Every operation swallows its
 * errors and reports one line on stderr: an unwritable state folder costs the
 * round memory, not the review.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseRoundState, type RoundState } from "@review-buddy/core/rounds";
import type { ReviewSource } from "@review-buddy/core/types";

/** Rounds older than this are forgotten: a change nobody returned to in two weeks. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Owner-only, for both the folder and the files: a review is the user's business. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** `~/.review-buddy/rounds`, or REVIEW_BUDDY_STATE_DIR/rounds when set. */
export function roundsDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.REVIEW_BUDDY_STATE_DIR?.trim();
  return base ? join(base, "rounds") : join(homedir(), ".review-buddy", "rounds");
}

/**
 * The file name for one change: a hash of the repo and what is being reviewed.
 * Hashed rather than spelled out so no path of the user's filesystem shows up
 * in a shared temp folder, and so any ref is a safe file name.
 */
export function roundKey(repoRoot: string, source: ReviewSource = { type: "worktree" }): string {
  return createHash("sha256")
    .update([repoRoot, source.type, source.ref ?? ""].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
}

export interface RoundStore {
  /** The previous round of this change, or undefined (no file, or unreadable). */
  read(): RoundState | undefined;
  /** Replace the stored round. Failures are logged, never thrown. */
  write(state: RoundState): void;
  /** Forget this change — the review was approved, so the chain is over. */
  clear(): void;
}

function warn(action: string, e: unknown): void {
  console.error(`[review-buddy] could not ${action} the round state (${String(e)}) — continuing.`);
}

/**
 * A store for one change. Creating it never throws; `read` on a change that
 * has no state yet (the first round) returns undefined.
 */
export function roundStore(
  repoRoot: string,
  source?: ReviewSource,
  env: NodeJS.ProcessEnv = process.env,
): RoundStore {
  const dir = roundsDir(env);
  const file = join(dir, `${roundKey(repoRoot, source)}.json`);
  return {
    read() {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return undefined; // the usual case: round 1
      }
      try {
        return parseRoundState(JSON.parse(text));
      } catch {
        // Hand-edited or half-written: start over rather than guess.
        return undefined;
      }
    },
    write(state) {
      try {
        mkdirSync(dir, { recursive: true, mode: DIR_MODE });
        writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: FILE_MODE });
        // writeFileSync's mode applies only when it creates the file; an
        // existing one keeps its own, so set it either way.
        chmodSync(file, FILE_MODE);
      } catch (e) {
        warn("save", e);
      }
    },
    clear() {
      try {
        rmSync(file, { force: true });
      } catch (e) {
        warn("clear", e);
      }
    },
  };
}

/**
 * Drop rounds nobody came back to. Called when a session opens, so the folder
 * does not grow without bound; one unreadable entry does not stop the sweep.
 */
export function cleanupRounds(env: NodeJS.ProcessEnv = process.env, now = Date.now()): number {
  const dir = roundsDir(env);
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0; // nothing stored yet
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs <= MAX_AGE_MS) continue;
      rmSync(file, { force: true });
      removed++;
    } catch {
      /* someone else removed it, or it is not ours to read — leave it */
    }
  }
  return removed;
}
