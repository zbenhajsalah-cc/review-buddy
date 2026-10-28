/**
 * Display settings — the reviewer's local view preferences (source D). Persisted
 * to a host-scoped cookie and mapped onto @pierre/diffs' FileDiffOptions.
 */

import type { FileDiffOptions, LineDiffTypes, ThemesType } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import type { DisplaySettings } from "@review-buddy/core/types";
import { useCallback, useEffect, useMemo } from "react";
import { CODE_FONTS, FONT_SIZES, THEMES } from "./appearance.ts";
import { readPersisted, usePersistedState } from "./lib/usePersistedState.ts";

const KEY = "rb.display";

export const DEFAULT_SETTINGS: DisplaySettings = {
  layout: "unified",
  theme: "auto",
  lightTheme: "github-light",
  darkTheme: "github-dark",
  font: "jetbrains-mono",
  fontSize: 13,
  ligatures: false,
  changeIndicator: "classic",
  granularity: "word",
  wrap: false,
  lineNumbers: true,
  backgrounds: true,
};

export function granularityToLineDiffType(
  granularity: DisplaySettings["granularity"],
): LineDiffTypes {
  return granularity === "line" ? "none" : granularity;
}

/** The light/dark syntax theme pair @pierre/diffs renders with. */
export function diffThemes(s: Pick<DisplaySettings, "lightTheme" | "darkTheme">): ThemesType {
  return { light: s.lightTheme, dark: s.darkTheme };
}

/**
 * Replace values a stale cookie may carry (a theme or font no longer in the
 * catalog, an unsupported size) with defaults, so the worker pool is never
 * asked to resolve a theme that does not exist.
 */
export function sanitizeSettings(s: DisplaySettings): DisplaySettings {
  const known = (list: readonly { id: string }[], id: string) => list.some((o) => o.id === id);
  return {
    ...s,
    lightTheme: known(THEMES.light, s.lightTheme) ? s.lightTheme : DEFAULT_SETTINGS.lightTheme,
    darkTheme: known(THEMES.dark, s.darkTheme) ? s.darkTheme : DEFAULT_SETTINGS.darkTheme,
    font: known(CODE_FONTS, s.font) ? s.font : DEFAULT_SETTINGS.font,
    fontSize: (FONT_SIZES as readonly number[]).includes(s.fontSize)
      ? s.fontSize
      : DEFAULT_SETTINGS.fontSize,
  };
}

/** Saved settings, read outside React (the worker pool is created before first render). */
export function readDisplaySettings(): DisplaySettings {
  return sanitizeSettings(readPersisted(KEY, DEFAULT_SETTINGS, "cookie"));
}

export function useDisplaySettings() {
  const [stored, setSettings] = usePersistedState(KEY, DEFAULT_SETTINGS, "cookie");
  const settings = useMemo(() => sanitizeSettings(stored), [stored]);
  const pool = useWorkerPool();
  const { granularity, lightTheme, darkTheme } = settings;

  // While the pool is working, @pierre/diffs highlights with the POOL's render
  // options, not the card's — so a theme change must reach the pool.
  useEffect(() => {
    void pool
      ?.setRenderOptions({
        lineDiffType: granularityToLineDiffType(granularity),
        theme: diffThemes({ lightTheme, darkTheme }),
      })
      ?.catch(() => {});
  }, [pool, granularity, lightTheme, darkTheme]);

  const update = useCallback(
    (patch: Partial<DisplaySettings>) => setSettings((s) => ({ ...s, ...patch })),
    [setSettings],
  );

  return [settings, update] as const;
}

/** Translate our DisplaySettings into @pierre/diffs render options. */
export function toDiffOptions(s: DisplaySettings): FileDiffOptions<undefined> {
  return {
    diffStyle: s.layout,
    diffIndicators: s.changeIndicator,
    lineDiffType: granularityToLineDiffType(s.granularity),
    overflow: s.wrap ? "wrap" : "scroll",
    disableLineNumbers: !s.lineNumbers,
    disableBackground: !s.backgrounds,
    hunkSeparators: "line-info",
    // Same pair as the worker pool (useDisplaySettings): the pool highlights
    // while it is working, the main-thread fallback uses this one. "auto" lets
    // @pierre/diffs follow prefers-color-scheme.
    theme: diffThemes(s),
    ...(s.theme === "auto" ? {} : { themeType: s.theme }),
  };
}
