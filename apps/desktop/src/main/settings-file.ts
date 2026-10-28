/**
 * Small app settings (never secrets), as JSON in Electron's userData folder.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import type { ReviewEffort } from "../shared/ipc.ts";

export interface Settings {
  /** The user signed out of the GitHub CLI login in the app. */
  ghDisabled?: boolean;
  /** `owner/name` of the repositories used last, most recent first. */
  recentRepos?: string[];
  /** The `claude` binary chosen in Settings (US-21); none: the app searches. */
  claudePath?: string;
  /**
   * The model reviews run on, as picked in Settings: an alias ("opus") or a
   * full id. None means Claude Code's own default. Checked before use
   * (main/agent/models.ts): a settings file is editable by hand.
   */
  model?: string;
  /** The effort level picked in Settings; none means Claude Code's default. */
  effort?: ReviewEffort;
}

export class SettingsFile {
  /** One update at a time, so two changes never overwrite each other. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async read(): Promise<Settings> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, "utf8"));
      return value && typeof value === "object" ? (value as Settings) : {};
    } catch {
      return {}; // missing or damaged: start from defaults
    }
  }

  /** `change` may be a function of the current settings (read inside the queue). */
  update(change: Partial<Settings> | ((current: Settings) => Partial<Settings>)): Promise<void> {
    const step = async () => {
      const current = await this.read();
      const next = { ...current, ...(typeof change === "function" ? change(current) : change) };
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
      await rename(tmp, this.file);
    };
    const done = this.#queue.then(step, step);
    this.#queue = done.catch(() => {});
    return done;
  }
}
