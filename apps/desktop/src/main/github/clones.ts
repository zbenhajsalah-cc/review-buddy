/**
 * Large PRs via a local copy (US-19). GitHub will not send the diff of a very
 * large PR (more than 300 files or 20,000 lines), so the app asks git for it
 * instead, from a small local copy of the repository in the app data folder:
 *
 *   <dir>/<owner>/<repo>.git     a bare repository, kept for the next review
 *
 * The copy holds only what a diff needs: the PR's head commit and its merge
 * base, fetched by SHA, one commit deep (`--depth=1`) and without file
 * contents (`--filter=blob:none`). git fetches the contents the diff reads, on
 * demand. File bytes for the viewer and the agent still come from the GitHub
 * API (prFileReader), so a saved review never needs the copy, and deleting a
 * copy only costs a fetch next time.
 *
 * The token is given to git only for a repository that is not known to be
 * public, in the environment (never in the copy's config or the command
 * line), as an extra HTTP header for github.com, like actions/checkout.
 *
 * No Electron imports: tested with bun against a local "remote" repository.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import type { CloneInfo } from "../../shared/ipc.ts";
import { isRepoName, type PrRef, parsePrRef } from "./api-source.ts";

/** GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n came in git 2.31 (2021). */
export const MIN_GIT_VERSION = "2.31.0";
/** Where the fetched commits are kept in a copy. */
const REFS = "refs/review-buddy/";
/** The marker whose time says when a copy was last used. */
const USED = "review-buddy-used";
const SHA = /^[0-9a-f]{40}$/;
/** A diff larger than this is refused (the viewer could not show it anyway). */
const MAX_DIFF_BYTES = 256 * 1024 * 1024;

/** Where git may be: the PATH (absolute folders only), then the usual folders. */
export function gitCandidates(platform: string, env: Record<string, string | undefined>): string[] {
  const path = platform === "win32" ? win32 : posix;
  const name = platform === "win32" ? "git.exe" : "git";
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter((d) => path.isAbsolute(d));
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]) {
      if (base) dirs.push(path.join(base, "Git", "cmd"));
    }
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, "Programs", "Git", "cmd"));
  } else {
    dirs.push("/usr/bin", "/opt/homebrew/bin", "/usr/local/bin");
  }
  return [...new Set(dirs.map((d) => path.join(d, name)))];
}

/** Every git found, in search order (the first new enough one is used). */
export function findGits(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string[] {
  return gitCandidates(platform, env).filter(exists);
}

/** "git version 2.43.0" (or "2.43.0.windows.1") → "2.43.0"; null for anything else. */
export function parseGitVersion(output: string): string | null {
  return /^git version (\d+\.\d+\.\d+)/.exec(output.trim())?.[1] ?? null;
}

function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return true;
}

/**
 * The environment with more git config entries, added after any
 * GIT_CONFIG_KEY_n the environment already has (they stay in force).
 */
export function gitConfigEnv(
  base: Record<string, string | undefined>,
  entries: [key: string, value: string][],
): Record<string, string | undefined> {
  const count = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10);
  const first = Number.isSafeInteger(count) && count > 0 ? count : 0;
  const env: Record<string, string | undefined> = {
    ...base,
    GIT_CONFIG_COUNT: String(first + entries.length),
  };
  entries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${first + i}`] = key;
    env[`GIT_CONFIG_VALUE_${first + i}`] = value;
  });
  return env;
}

/** The header git sends to github.com with the token (as actions/checkout does). */
export function authHeader(token: string): string {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

/** "Receiving objects:  45% (12/27), 1.2 MiB | …" → what and how far, or null. */
export function parseProgress(line: string): { what: string; percent: number } | null {
  const m = /^(?:remote: )?([A-Z][a-z]+ objects|Resolving deltas):\s+(\d{1,3})%/.exec(line.trim());
  return m ? { what: m[1]!.toLowerCase(), percent: Number(m[2]) } : null;
}

export interface GitRunOptions {
  cwd?: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Each line git writes to stderr (progress lines end in \r). */
  onStderrLine?: (line: string) => void;
}

/** Runs git; resolves with stdout, rejects with git's last words. */
export type GitRun = (git: string, args: string[], options: GitRunOptions) => Promise<string>;

export const runGit: GitRun = (git, args, options) =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("stopped"));
    const child = spawn(git, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let partial = "";
    let failed: Error | undefined;
    const abort = () => {
      failed ??= new Error("stopped");
      child.kill();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_DIFF_BYTES) {
        failed ??= new Error(`git answered more than ${MAX_DIFF_BYTES / 1024 / 1024} MB.`);
        child.kill();
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = partial + chunk.toString("utf8");
      const lines = text.split(/[\r\n]/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (line) options.onStderrLine?.(line);
      }
      err = (err + chunk.toString("utf8")).slice(-4000);
    });
    child.on("error", (e) => {
      failed ??= e;
    });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (failed) return reject(failed);
      if (code !== 0) {
        const last = err
          .split(/[\r\n]+/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-3)
          .join(" ");
        return reject(new Error(last || `git exited with ${code}`));
      }
      resolve(Buffer.concat(out).toString("utf8"));
    });
  });

/** The PR whose diff is wanted. */
export interface ClonePr {
  ref: PrRef;
  headSha: string;
  /** The merge base: the diff's base side. */
  baseSha: string;
  /** GitHub says the repository is public: git gets no token. */
  isPublic?: boolean;
}

export interface PrClonesDeps {
  /** The copies' folder, e.g. `<userData>/clones`. */
  dir: string;
  /** The git binaries found, in search order (none: an empty list). */
  git: () => string[];
  token: () => Promise<string>;
  /** The URL git fetches from (tests use a local repository). */
  remote?: (ref: PrRef) => string;
  run?: GitRun;
  env?: Record<string, string | undefined>;
}

/** Local copies of repositories, for diffs GitHub's API will not send. */
export class PrClones {
  /** One git job per copy at a time (a fetch, a diff, a delete). */
  #locks = new Map<string, Promise<unknown>>();
  /** Copies a review is reading now: they cannot be deleted. */
  #inUse = new Map<string, number>();
  #gitChecked: string | undefined;

  constructor(private readonly deps: PrClonesDeps) {}

  /**
   * The PR's diff from the local copy (made or updated first), as `git diff
   * <merge base> <head>`. `onStep` gets what happens, in words.
   */
  async diff(pr: ClonePr, onStep: (step: string) => void, signal?: AbortSignal): Promise<string> {
    const ref = parsePrRef(pr.ref);
    if (!SHA.test(pr.headSha) || !SHA.test(pr.baseSha)) throw new Error("Not commit SHAs.");
    const git = await this.#git();
    const key = keyOf(ref.owner, ref.repo);
    const label = `${ref.owner}/${ref.repo}#${ref.number}`;
    const dir = this.#dirOf(key);
    this.#inUse.set(key, (this.#inUse.get(key) ?? 0) + 1);
    try {
      return await this.#locked(key, async () => {
        const env = await this.#env(pr.isPublic === true);
        const run = (args: string[], more: Partial<GitRunOptions> = {}) =>
          (this.deps.run ?? runGit)(git, ["-C", dir, ...args], { env, signal, ...more });
        if (!existsSync(join(dir, "HEAD"))) {
          onStep(`Making a local copy of ${ref.owner}/${ref.repo} (without file contents)`);
          await mkdir(dir, { recursive: true });
          await (this.deps.run ?? runGit)(git, ["init", "--bare", "--quiet", dir], { env, signal });
          const url = this.deps.remote?.(ref) ?? `https://github.com/${ref.owner}/${ref.repo}.git`;
          for (const [k, v] of [
            ["remote.origin.url", url],
            ["remote.origin.promisor", "true"],
            ["remote.origin.partialclonefilter", "blob:none"],
            // No automatic gc in the background of a review.
            ["gc.auto", "0"],
          ]) {
            await run(["config", k!, v!]);
          }
        }
        // Each fetched commit gets a ref (refs/review-buddy/<sha>): that keeps
        // it, and says it is here without asking for the object (in a partial
        // copy, asking for a missing object makes git fetch it on its own).
        const have = new Set(
          (await run(["for-each-ref", "--format=%(refname)", REFS])).split("\n").filter(Boolean),
        );
        const missing = [...new Set([pr.headSha, pr.baseSha])].filter(
          (sha) => !have.has(`${REFS}${sha}`),
        );
        if (missing.length > 0) {
          onStep(`Fetching the commits of ${label}`);
          let last = "";
          await run(
            [
              "fetch",
              "--depth=1",
              "--filter=blob:none",
              "--no-tags",
              "--no-write-fetch-head",
              "--progress",
              "origin",
              ...missing.map((sha) => `+${sha}:${REFS}${sha}`),
            ],
            {
              onStderrLine: (line) => {
                const p = parseProgress(line);
                // Only the long part (receiving), every 25 %: a few steps, not dozens.
                if (p?.what !== "receiving objects") return;
                const step = `Fetching the commits of ${label}: ${Math.floor(p.percent / 25) * 25}%`;
                if (step === last) return;
                last = step;
                onStep(step);
              },
            },
          ).catch((e: Error) => {
            if (signal?.aborted) throw e;
            throw new Error(`git could not fetch ${label}: ${e.message}`);
          });
        } else {
          onStep(`Using the local copy of ${ref.owner}/${ref.repo}`);
        }
        onStep(`Reading the diff of ${label} from the local copy`);
        const diff = await run([
          "-c",
          "core.quotePath=false",
          "diff",
          // Fixed options, whatever the user's git config says.
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--find-renames",
          "--diff-algorithm=myers",
          "--submodule=short",
          "--ignore-submodules=none",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          pr.baseSha,
          pr.headSha,
        ]).catch((e: Error) => {
          if (signal?.aborted) throw e;
          throw new Error(`git could not diff ${label}: ${e.message}`);
        });
        await writeFile(join(dir, USED), new Date().toISOString());
        return diff;
      });
    } finally {
      const n = (this.#inUse.get(key) ?? 1) - 1;
      if (n > 0) this.#inUse.set(key, n);
      else this.#inUse.delete(key);
    }
  }

  /** The local copies, most recently used first. */
  async list(): Promise<CloneInfo[]> {
    const found: CloneInfo[] = [];
    for (const owner of await names(this.deps.dir)) {
      if (!isRepoName(owner)) continue;
      for (const entry of await names(join(this.deps.dir, owner))) {
        const repo = entry.endsWith(".git") ? entry.slice(0, -4) : "";
        if (!isRepoName(repo)) continue;
        const dir = join(this.deps.dir, owner, entry);
        const key = keyOf(owner, repo);
        const used = await stat(join(dir, USED)).catch(() => stat(dir));
        found.push({
          repo: key,
          bytes: await sizeOf(dir),
          usedAt: used.mtime.toISOString(),
          inUse: this.#inUse.has(key),
        });
      }
    }
    return found.sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  }

  /** Deletes one copy (`owner/repo`); a copy a review is reading is refused. */
  async delete(repo: unknown): Promise<CloneInfo[]> {
    const parts = typeof repo === "string" ? repo.split("/") : [];
    if (parts.length !== 2 || !isRepoName(parts[0]!) || !isRepoName(parts[1]!)) {
      throw new Error("unknown copy");
    }
    const key = keyOf(parts[0]!, parts[1]!);
    if (this.#inUse.has(key)) {
      throw new Error(`A review is using the copy of ${key}. Delete it when the review ends.`);
    }
    await this.#locked(key, () => this.#remove(key));
    return this.list();
  }

  /** Deletes every copy no review is using now. */
  async deleteAll(): Promise<CloneInfo[]> {
    for (const info of await this.list()) {
      if (!this.#inUse.has(info.repo)) await this.#locked(info.repo, () => this.#remove(info.repo));
    }
    return this.list();
  }

  async #remove(key: string): Promise<void> {
    const [owner] = key.split("/");
    await rm(this.#dirOf(key), { recursive: true, force: true });
    await rmdir(join(this.deps.dir, owner!)).catch(() => {}); // only if empty
  }

  #dirOf(key: string): string {
    const [owner, repo] = key.split("/");
    return join(this.deps.dir, owner!, `${repo}.git`);
  }

  /**
   * The first git found that runs and is new enough (an old one early in the
   * PATH does not hide a newer one); checked once while it stays first.
   * None: the first one's reason, or "install git".
   */
  async #git(): Promise<string> {
    const found = this.deps.git();
    if (this.#gitChecked && found.includes(this.#gitChecked)) return this.#gitChecked;
    let firstProblem: string | undefined;
    for (const git of found) {
      const problem = await (this.deps.run ?? runGit)(git, ["--version"], {
        env: this.deps.env ?? process.env,
      }).then(
        (output) => {
          const version = parseGitVersion(output);
          return version && versionAtLeast(version, MIN_GIT_VERSION)
            ? undefined
            : `git ${version ?? "(unknown version)"} is too old (${git}): reviewing a PR this large needs git ${MIN_GIT_VERSION} or newer.`;
        },
        (e: Error) => `git did not run (${git}): ${e.message}`,
      );
      if (!problem) {
        this.#gitChecked = git;
        return git;
      }
      firstProblem ??= problem;
    }
    throw new Error(
      firstProblem ??
        "Reviewing a PR this large needs git, and the app found none. Install git, then try again.",
    );
  }

  /** git's environment: no prompts; the token only when the repo may be private. */
  async #env(isPublic: boolean): Promise<Record<string, string | undefined>> {
    const base = {
      ...(this.deps.env ?? process.env),
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
    };
    const entries: [string, string][] = [["credential.helper", ""]];
    if (!isPublic)
      entries.push(["http.https://github.com/.extraheader", authHeader(await this.deps.token())]);
    return gitConfigEnv(base, entries);
  }

  #locked<T>(key: string, step: () => Promise<T>): Promise<T> {
    const before = this.#locks.get(key) ?? Promise.resolve();
    const next = before.then(step, step);
    const settled = next.catch(() => {});
    this.#locks.set(key, settled);
    void settled.then(() => {
      if (this.#locks.get(key) === settled) this.#locks.delete(key);
    });
    return next;
  }
}

/** Copies are kept per lower-case `owner/repo` (GitHub names ignore case). */
function keyOf(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

async function names(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => []);
}

/** Bytes in a folder (links not followed). */
async function sizeOf(path: string): Promise<number> {
  const info = await lstat(path).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await names(path)) total += await sizeOf(join(path, name));
  return total;
}
