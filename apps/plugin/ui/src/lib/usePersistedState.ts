import { useCallback, useEffect, useState } from "react";

export type StorageBackend = "cookie" | "local";

export function parseStored<T>(raw: string | null, initial: T): T {
  if (!raw) return initial;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(initial)) {
      return (Array.isArray(parsed) ? parsed : initial) as T;
    }
    if (
      typeof initial === "object" &&
      initial !== null &&
      typeof parsed === "object" &&
      parsed !== null
    ) {
      return { ...initial, ...(parsed as Record<string, unknown>) } as T;
    }
    return parsed as T;
  } catch {
    return initial;
  }
}

function readLocal<T>(key: string, initial: T): T {
  try {
    return parseStored(localStorage.getItem(key), initial);
  } catch {
    return initial;
  }
}

function writeLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

function readCookie<T>(key: string, initial: T): T {
  try {
    const prefix = `${key}=`;
    const entry = document.cookie.split("; ").find((c) => c.startsWith(prefix));
    if (!entry) return initial;
    const raw = decodeURIComponent(entry.slice(prefix.length));
    return parseStored(raw, initial);
  } catch {
    return initial;
  }
}

function writeCookie<T>(key: string, value: T): void {
  try {
    const encoded = encodeURIComponent(JSON.stringify(value));
    // biome-ignore lint/suspicious/noDocumentCookie: viewer persists display preferences in a first-party cookie
    document.cookie = `${key}=${encoded}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* non-fatal */
  }
}

export function usePersistedState<T>(
  key: string,
  initial: T,
  backend: StorageBackend,
): readonly [T, (updater: T | ((prev: T) => T)) => void] {
  const read = backend === "local" ? readLocal : readCookie;

  const [value, setValue] = useState<T>(() => read(key, initial));

  useEffect(() => {
    if (backend === "local") {
      writeLocal(key, value);
    } else {
      writeCookie(key, value);
    }
  }, [key, value, backend]);

  const update = useCallback((updater: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater));
  }, []);

  return [value, update] as const;
}
