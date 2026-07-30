import { type RefObject, useRef, useState } from "react";

export function useFileFocus(paths: readonly string[]): {
  focusedPath: string | null;
  /** Latest value, readable synchronously from a shortcut handler. */
  focusedPathRef: RefObject<string | null>;
  focus: (path: string | null) => void;
  move: (delta: 1 | -1) => string | null;
} {
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  // Synced immediately in focus so rapid j→v (before re-render) still sees the path.
  const focusedPathRef = useRef<string | null>(null);

  const focus = (path: string | null) => {
    focusedPathRef.current = path;
    setFocusedPath(path);
  };

  const move = (delta: 1 | -1): string | null => {
    if (paths.length === 0) return null;
    const current = focusedPathRef.current;
    const idx = current === null ? -1 : paths.indexOf(current);
    // null or no longer present → first (j) / last (k); otherwise step and clamp.
    const nextIdx = idx < 0 ? (delta === 1 ? 0 : paths.length - 1) : idx + delta;
    if (nextIdx < 0 || nextIdx >= paths.length) return null;
    const target = paths[nextIdx];
    if (target === undefined) return null;
    focus(target);
    return target;
  };

  return { focusedPath, focusedPathRef, focus, move };
}
