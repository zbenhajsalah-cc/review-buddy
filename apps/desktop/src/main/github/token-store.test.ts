import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SecretCodec, TokenStore } from "./token-store.ts";

/** A stand-in for safeStorage: reversible, and never the plain text on disk. */
function fakeCodec(options: { available?: boolean; backend?: string } = {}): SecretCodec {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? "gnome_libsecret",
    encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString("base64")}`),
    decryptString: (b) => {
      const text = b.toString();
      if (!text.startsWith("enc:")) throw new Error("cannot decrypt");
      return Buffer.from(text.slice(4), "base64").toString();
    },
  };
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rb-token-"));
  file = join(dir, "github-token");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("canPersist", () => {
  test("needs OS encryption", () => {
    expect(new TokenStore(file, fakeCodec(), "darwin").canPersist()).toBe(true);
    expect(new TokenStore(file, fakeCodec({ available: false }), "darwin").canPersist()).toBe(
      false,
    );
  });

  test("on Linux, not with safeStorage's hard-coded key (basic_text)", () => {
    expect(new TokenStore(file, fakeCodec(), "linux").canPersist()).toBe(true);
    const basic = fakeCodec({ backend: "basic_text" });
    expect(new TokenStore(file, basic, "linux").canPersist()).toBe(false);
  });
});

describe("TokenStore", () => {
  test("saves encrypted, owner-only, and loads it back", async () => {
    const store = new TokenStore(file, fakeCodec(), "linux");
    await store.save("ghp_secret");
    expect(readFileSync(file, "utf8")).not.toContain("ghp_secret");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await store.load()).toBe("ghp_secret");
  });

  test("refuses to save without OS encryption", async () => {
    const store = new TokenStore(file, fakeCodec({ available: false }), "linux");
    await expect(store.save("ghp_secret")).rejects.toThrow("no OS encryption");
  });

  test("no file, or one it cannot decrypt, loads as null", async () => {
    const store = new TokenStore(file, fakeCodec(), "linux");
    expect(await store.load()).toBeNull();
    writeFileSync(file, "garbage");
    expect(await store.load()).toBeNull();
  });

  test("clear removes the file (and is fine when there is none)", async () => {
    const store = new TokenStore(file, fakeCodec(), "linux");
    await store.save("ghp_secret");
    await store.clear();
    expect(await store.load()).toBeNull();
    await store.clear();
  });
});
