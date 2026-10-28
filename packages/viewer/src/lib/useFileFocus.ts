import { type RefObject, useRef, useState } from "react";

/**
 * Keyboard focus over the listed files (`paths`). `order`: all the chapter's
 * files in order, a superset of `paths`; when the focused file leaves the
 * list (hidden once viewed), j / k go on from where it was in that order.
 */
export function useFileFocus(
  paths: readonly string[],
  order: readonly string[] = paths,
): {
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
    const current = focusedPathRef.current;
    const idx = current === null ? -1 : paths.indexOf(current);
    let target: string | undefined;
    if (idx >= 0) {
      target = paths[idx + delta]; // step; past either end → no move
    } else if (current !== null && order.includes(current)) {
      // It left the list: the nearest listed file after it (j) / before it (k).
      const at = order.indexOf(current);
      const around = delta === 1 ? order.slice(at + 1) : order.slice(0, at).reverse();
      target = around.find((p) => paths.includes(p));
    } else {
      target = delta === 1 ? paths[0] : paths[paths.length - 1]; // nothing focused: first / last
    }
    if (target === undefined) return null;
    focus(target);
    return target;
  };

  return { focusedPath, focusedPathRef, focus, move };
}
