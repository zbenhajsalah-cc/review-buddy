/**
 * Small app settings (never secrets), as JSON in Electron's userData folder.
 */
import { readFile, rename, writeFile } from "node:fs/promises";

export interface Settings {
  /** The user signed out of the GitHub CLI login in the app. */
  ghDisabled?: boolean;
}

export class SettingsFile {
  constructor(private readonly file: string) {}

  async read(): Promise<Settings> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, "utf8"));
      return value && typeof value === "object" ? (value as Settings) : {};
    } catch {
      return {}; // missing or damaged: start from defaults
    }
  }

  async update(change: Partial<Settings>): Promise<void> {
    const next = { ...(await this.read()), ...change };
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
    await rename(tmp, this.file);
  }
}
