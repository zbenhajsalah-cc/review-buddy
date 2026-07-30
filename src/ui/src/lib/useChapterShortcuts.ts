import type { RefObject } from "react";
import { useShortcuts } from "./shortcuts.ts";

/**
 * Registers the chapter-review surface's keyboard shortcuts. Callers own
 * domain state and DOM scrolling; this hook only wires catalog ids to handlers.
 */
export function useChapterShortcuts({
  hasChapter,
  shortcutsActive,
  onShowShortcuts,
  hasNext,
  hasPrev,
  onNextChapter,
  onPrevChapter,
  onExit,
  focusedPathRef,
  focus,
  move,
  scrollToFile,
  isCollapsed,
  setCollapsed,
  chapterFilePaths,
  isViewed,
  onViewedChange,
}: {
  hasChapter: boolean;
  shortcutsActive: boolean;
  onShowShortcuts: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  onNextChapter: () => void;
  onPrevChapter: () => void;
  onExit: () => void;
  focusedPathRef: RefObject<string | null>;
  focus: (path: string | null) => void;
  move: (delta: 1 | -1) => string | null;
  scrollToFile: (path: string) => void;
  isCollapsed: (path: string) => boolean;
  setCollapsed: (path: string, collapsed: boolean) => void;
  /** Unfiltered chapter file paths (toggle-all ignores the sidebar filter). */
  chapterFilePaths: readonly string[];
  isViewed: (path: string) => boolean;
  onViewedChange: (path: string, viewed: boolean) => void;
}): void {
  useShortcuts({
    SHOW_SHORTCUTS: {
      handler: onShowShortcuts,
      enabled: hasChapter,
    },
    NEXT_CHAPTER: {
      handler: () => {
        if (hasNext) onNextChapter();
      },
      enabled: shortcutsActive,
    },
    PREV_CHAPTER: {
      handler: () => {
        if (hasPrev) onPrevChapter();
      },
      enabled: shortcutsActive,
    },
    BACK_TO_OVERVIEW: {
      handler: () => {
        if (focusedPathRef.current !== null) focus(null);
        else onExit();
      },
      enabled: shortcutsActive,
    },
    NEXT_FILE: {
      handler: () => {
        const path = move(1);
        if (path) scrollToFile(path);
      },
      enabled: shortcutsActive,
    },
    PREV_FILE: {
      handler: () => {
        const path = move(-1);
        if (path) scrollToFile(path);
      },
      enabled: shortcutsActive,
    },
    TOGGLE_COLLAPSED: {
      handler: () => {
        const path = focusedPathRef.current;
        if (path === null) return;
        setCollapsed(path, !isCollapsed(path));
      },
      enabled: shortcutsActive,
    },
    TOGGLE_ALL_COLLAPSED: {
      handler: () => {
        const anyExpanded = chapterFilePaths.some((p) => !isCollapsed(p));
        for (const p of chapterFilePaths) {
          setCollapsed(p, anyExpanded);
        }
      },
      enabled: shortcutsActive,
    },
    TOGGLE_VIEWED: {
      handler: () => {
        const path = focusedPathRef.current;
        if (path === null) return;
        onViewedChange(path, !isViewed(path));
      },
      enabled: shortcutsActive,
    },
  });
}
