/**
 * Display settings — the reviewer's local view preferences (source D). Persisted
 * to a host-scoped cookie and mapped onto @pierre/diffs' FileDiffOptions.
 */

import type { FileDiffOptions, LineDiffTypes } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import type { DisplaySettings } from "@review-buddy/core/types";
import { useCallback, useEffect } from "react";
import { usePersistedState } from "./lib/usePersistedState.ts";

const KEY = "rb.display";

export const DEFAULT_SETTINGS: DisplaySettings = {
  layout: "unified",
  theme: "auto",
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

export function useDisplaySettings() {
  const [settings, setSettings] = usePersistedState(KEY, DEFAULT_SETTINGS, "cookie");
  const pool = useWorkerPool();

  useEffect(() => {
    void pool
      ?.setRenderOptions({
        lineDiffType: granularityToLineDiffType(settings.granularity),
      })
      ?.catch(() => {});
  }, [pool, settings.granularity]);

  const update = useCallback(
    (patch: Partial<DisplaySettings>) => setSettings((s) => ({ ...s, ...patch })),
    [setSettings],
  );

  return [settings, update] as const;
}

/** GitHub-flavored themes; "auto" lets @pierre/diffs follow prefers-color-scheme. */
const THEME = { dark: "github-dark", light: "github-light" } as const;

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
    // Syntax highlighting runs in the worker pool (ReviewWorkerPoolProvider);
    // these options control layout/labels only — tokenization stays off-thread.
    theme: THEME,
    ...(s.theme === "auto" ? {} : { themeType: s.theme }),
  };
}
