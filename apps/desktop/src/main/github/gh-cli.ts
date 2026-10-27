/**
 * Reads the token of a logged-in GitHub CLI (`gh auth token`). gh keeps its
 * token in the OS keychain; the app asks gh each time it starts and keeps the
 * answer in memory only.
 *
 * A packaged app started from the Dock or Start menu does not get the shell's
 * PATH, so the usual install folders are searched too.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export function ghCandidates(platform: string, env: Record<string, string | undefined>): string[] {
  const name = platform === "win32" ? "gh.exe" : "gh";
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]) {
      if (base) dirs.push(join(base, "GitHub CLI"));
    }
  } else {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin");
  }
  return [...new Set(dirs.map((d) => join(d, name)))];
}

export function findGh(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string | null {
  return ghCandidates(platform, env).find(exists) ?? null;
}

/** The token gh uses for github.com, or null if gh is missing or logged out. */
export function ghAuthToken(gh: string | null = findGh()): Promise<string | null> {
  if (!gh) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      gh,
      ["auth", "token", "--hostname", "github.com"],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        const token = String(stdout).trim();
        resolve(error || !token || /\s/.test(token) ? null : token);
      },
    );
  });
}
