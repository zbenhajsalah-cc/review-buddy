/**
 * The Claude Code the reviews run (US-21): the user's own installed `claude`,
 * not a copy in the app. Main looks for it in the PATH and in the usual
 * install folders (an app started from the Dock or the Start menu does not
 * get the shell's PATH), or uses the one the user chose in Settings. It must
 * be at least the Claude Code version of the Agent SDK the app is built with;
 * newer versions are accepted (Claude Code updates itself often).
 *
 * No Electron imports: tested with bun and fake `claude` scripts.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { ClaudeCodeStatus } from "../../shared/ipc.ts";

/** Where to look, in order: the PATH, then the usual install folders. */
export function claudeCandidates(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
): string[] {
  const path = platform === "win32" ? win32 : posix;
  const name = platform === "win32" ? "claude.exe" : "claude";
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  if (platform === "win32") {
    dirs.push(path.join(env.USERPROFILE ?? home, ".local", "bin"));
  } else {
    dirs.push(
      path.join(home, ".local", "bin"),
      path.join(home, ".claude", "local"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
    );
  }
  return [...new Set(dirs.map((d) => path.join(d, name)))];
}

/** "2.1.311 (Claude Code)" → "2.1.311"; null for anything else. */
export function parseClaudeVersion(output: string): string | null {
  const m = /^(\d+\.\d+\.\d+)\s+\(Claude Code\)/.exec(output.trim());
  return m ? m[1]! : null;
}

/** < 0, 0 or > 0, like a sort function, for "x.y.z" versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface RunResult {
  stdout: string;
  /** Could not run it, or it failed (with its stderr). */
  error?: string;
}

/** `<path> --version`, at most 10 s. */
export function runVersion(path: string): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      path,
      ["--version"],
      { timeout: 10_000, windowsHide: true },
      (error, stdout, stderr) => {
        const err = String(stderr).trim();
        resolve({
          stdout: String(stdout),
          error: error ? `${error.message}${err ? `\n${err}` : ""}` : undefined,
        });
      },
    );
  });
}

export interface CheckDeps {
  /** The SDK's Claude Code version: the oldest one that works. */
  minVersion: string;
  /** The `claude` the user chose in Settings; none: search. */
  chosen?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
  home?: string;
  exists?: (path: string) => boolean;
  run?: (path: string) => Promise<RunResult>;
  now?: () => Date;
}

/** Checks one binary. */
async function checkOne(
  path: string,
  deps: Required<Pick<CheckDeps, "minVersion" | "run">>,
): Promise<Pick<ClaudeCodeStatus, "state" | "version" | "message">> {
  const { stdout, error } = await deps.run(path);
  const version = error ? null : parseClaudeVersion(stdout);
  if (!version) {
    const said = (error ?? stdout).trim().slice(0, 500) || "nothing";
    return {
      state: "broken",
      message: `${path} did not answer like Claude Code (\`claude --version\` said: ${said}).`,
    };
  }
  if (compareVersions(version, deps.minVersion) < 0) {
    return {
      state: "too-old",
      version,
      message:
        `Claude Code ${version} is too old for this app (needs ${deps.minVersion} or newer). ` +
        "Run `claude update`, then press Check again.",
    };
  }
  return { state: "ok", version };
}

/**
 * Finds and checks Claude Code. With a chosen path, only that one. Without,
 * the first candidate that works; if none works, the first one found says why.
 */
export async function checkClaudeCode(deps: CheckDeps): Promise<ClaudeCodeStatus> {
  const exists = deps.exists ?? existsSync;
  const run = deps.run ?? runVersion;
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  const base = { minVersion: deps.minVersion, chosen: deps.chosen !== undefined, checkedAt };
  const searched = deps.chosen
    ? [deps.chosen]
    : claudeCandidates(
        deps.platform ?? process.platform,
        deps.env ?? process.env,
        deps.home ?? homedir(),
      );
  let first: ClaudeCodeStatus | undefined;
  for (const path of searched) {
    if (!exists(path)) continue;
    const result = {
      ...base,
      path,
      ...(await checkOne(path, { minVersion: deps.minVersion, run })),
    };
    if (result.state === "ok") return result;
    first ??= result;
  }
  return (
    first ?? {
      ...base,
      state: "missing",
      searched,
      message: deps.chosen
        ? `The Claude Code you chose is not there any more: ${deps.chosen}. Choose it again, or let the app search for it.`
        : "Review Buddy uses your Claude Code. Install it, then press Check again.",
    }
  );
}

/** Thrown when a review cannot start Claude Code; the job shows `message`. */
export class ClaudeCodeError extends Error {
  readonly kind = "claude";
}

export interface ClaudeCodeDeps {
  minVersion: string;
  /** The path chosen in Settings (kept in the app settings). */
  chosen: { get(): Promise<string | undefined>; set(path: string | undefined): Promise<void> };
  check?: (deps: CheckDeps) => Promise<ClaudeCodeStatus>;
}

/** The app's Claude Code: the last check, and checks on request. */
export class ClaudeCode {
  #last: ClaudeCodeStatus | undefined;
  #running: Promise<ClaudeCodeStatus> | undefined;

  constructor(private readonly deps: ClaudeCodeDeps) {}

  /** The last check (one runs if there was none). */
  async status(): Promise<ClaudeCodeStatus> {
    return this.#last ?? this.check();
  }

  /** Checks again (calls at the same time share one check). */
  check(): Promise<ClaudeCodeStatus> {
    this.#running ??= (async () => {
      try {
        const chosen = await this.deps.chosen.get();
        this.#last = await (this.deps.check ?? checkClaudeCode)({
          minVersion: this.deps.minVersion,
          chosen,
        });
        return this.#last;
      } finally {
        this.#running = undefined;
      }
    })();
    return this.#running;
  }

  /** Uses this binary from now on (undefined: search again). */
  async choose(path: string | undefined): Promise<ClaudeCodeStatus> {
    await this.deps.chosen.set(path);
    return this.check();
  }

  /**
   * Before a review: checks again (it may have been updated or removed) and
   * answers with the binary to run, or throws a ClaudeCodeError.
   */
  async ready(): Promise<{ path: string; version: string }> {
    const status = await this.check();
    if (status.state !== "ok") {
      throw new ClaudeCodeError(status.message ?? "Claude Code cannot run.");
    }
    return { path: status.path!, version: status.version! };
  }
}
