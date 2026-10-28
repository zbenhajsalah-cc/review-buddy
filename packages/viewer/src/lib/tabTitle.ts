/**
 * The browser tab's title for what the viewer shows, opt-in with
 * `<ReviewViewer tabTitle />` (the plugin: one review per tab, and several
 * tabs open side by side are told apart by their titles).
 */
import { useEffect } from "react";
import type { View } from "./view.ts";

export function tabTitleFor(
  prTitle: string,
  view: View,
  chapterCount: number,
  submitted: boolean,
): string {
  const title = prTitle || "Untitled review";
  if (submitted) return `Submitted · ${title}`;
  if (view.mode === "chapter") return `Ch ${view.position + 1}/${chapterCount} · ${title}`;
  return `${title} · Review Buddy`;
}

/** Sets `document.title` while `title` is given; puts the old one back after. */
export function useTabTitle(title: string | undefined): void {
  useEffect(() => {
    if (title === undefined) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}
