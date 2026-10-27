/**
 * Open a URL in the user's default browser, cross-platform. Best-effort: if it
 * fails (e.g. headless CI), we log and let the hook print the URL instead.
 */
import { spawn } from "node:child_process";

export function openBrowser(url: string): boolean {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
