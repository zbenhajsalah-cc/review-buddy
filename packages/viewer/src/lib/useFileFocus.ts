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
  // Where the focused file was in the list: when it then leaves the list
  // (hidden once viewed), j / k go on from there.
  const focusedIndexRef = useRef(-1);

  const focus = (path: string | null) => {
    focusedPathRef.current = path;
    focusedIndexRef.current = path === null ? -1 : paths.indexOf(path);
    setFocusedPath(path);
  };

  const move = (delta: 1 | -1): string | null => {
    if (paths.length === 0) return null;
    const current = focusedPathRef.current;
    const idx = current === null ? -1 : paths.indexOf(current);
    const was = focusedIndexRef.current;
    let nextIdx: number;
    if (idx >= 0) {
      nextIdx = idx + delta; // step; past either end → no move
    } else if (was >= 0) {
      nextIdx = delta === 1 ? was : was - 1; // it left the list: the file now in its place / before it
    } else {
      nextIdx = delta === 1 ? 0 : paths.length - 1; // nothing focused: first (j) / last (k)
    }
    if (nextIdx < 0 || nextIdx >= paths.length) return null;
    const target = paths[nextIdx];
    if (target === undefined) return null;
    focus(target);
    return target;
  };

  return { focusedPath, focusedPathRef, focus, move };
}
