/**
 * Keeps a pasted GitHub token on disk, encrypted with Electron `safeStorage`
 * (the OS keychain: Keychain on macOS, DPAPI on Windows, the Secret Service /
 * KWallet on Linux). Only main reads it; it never goes to the renderer.
 *
 * When the OS has no real encryption (Linux without a keyring, where
 * safeStorage falls back to "basic_text"), nothing is written: the caller
 * keeps the token in memory for this run only.
 *
 * The codec is passed in (no Electron import), so this is tested with bun.
 */
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";

/** The parts of Electron's `safeStorage` this uses. */
export interface SecretCodec {
  isEncryptionAvailable(): boolean;
  /** Linux only in Electron; "basic_text" means a hard-coded key (not secret). */
  getSelectedStorageBackend?(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class TokenStore {
  constructor(
    private readonly file: string,
    private readonly codec: SecretCodec,
    private readonly platform: string = process.platform,
  ) {}

  /** True if a token can be kept on disk, encrypted by the OS. */
  canPersist(): boolean {
    if (!this.codec.isEncryptionAvailable()) return false;
    if (this.platform !== "linux") return true;
    const backend = this.codec.getSelectedStorageBackend?.() ?? "unknown";
    return backend !== "basic_text" && backend !== "unknown";
  }

  async save(token: string): Promise<void> {
    if (!this.canPersist()) throw new Error("no OS encryption available");
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, this.codec.encryptString(token), { mode: 0o600 });
    await chmod(tmp, 0o600); // the mode is ignored if the file already existed
    await rename(tmp, this.file);
  }

  /** The stored token, or null if there is none or it cannot be decrypted. */
  async load(): Promise<string | null> {
    let data: Buffer;
    try {
      data = await readFile(this.file);
    } catch {
      return null;
    }
    try {
      return this.codec.decryptString(data) || null;
    } catch {
      return null; // e.g. made by another OS user or a reset keychain
    }
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
