/**
 * Which screen the viewer shows: the overview or one chapter. An app that
 * shows one review per page (the plugin) can keep it in the URL hash, so a
 * reload stays on the chapter and the browser's Back / Forward move between
 * the screens: `#/chapter/3` is the third chapter, anything else the overview.
 */
import { useCallback, useEffect, useState } from "react";

export type View = { mode: "overview" } | { mode: "chapter"; position: number };

const OVERVIEW: View = { mode: "overview" };
const CHAPTER_HASH = /^#\/chapter\/([1-9]\d{0,3})$/;

export function viewFromHash(hash: string): View {
  const match = CHAPTER_HASH.exec(hash);
  return match ? { mode: "chapter", position: Number(match[1]) - 1 } : OVERVIEW;
}

export function hashOfView(view: View): string {
  return view.mode === "chapter" ? `#/chapter/${view.position + 1}` : "";
}

/**
 * The current view and a `navigate` that changes it. With `inHash`, the view
 * starts from the URL hash, each navigation is a new history entry, and Back /
 * Forward (popstate) bring the view along. Off: plain state, the URL untouched
 * (the desktop app shows many reviews in one window, so a hash would outlive
 * the review it was for).
 */
export function useView(inHash: boolean): readonly [View, (next: View) => void] {
  const [view, setView] = useState<View>(() => (inHash ? viewFromHash(location.hash) : OVERVIEW));

  useEffect(() => {
    if (!inHash) return;
    const onPopState = () => setView(viewFromHash(location.hash));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [inHash]);

  const navigate = useCallback(
    (next: View) => {
      setView(next);
      if (!inHash) return;
      const hash = hashOfView(next);
      if (hash !== location.hash) {
        history.pushState(null, "", `${location.pathname}${location.search}${hash}`);
      }
    },
    [inHash],
  );

  return [view, navigate] as const;
}
