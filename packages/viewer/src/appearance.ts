/**
 * Appearance catalogs for the diff viewer: the syntax themes @pierre/diffs can
 * render (its own Pierre themes + every Shiki bundled theme) and the code fonts
 * declared in theme.css. Plain data, so the settings bar, the settings
 * sanitizer and the tests share one source of truth.
 */

import type { DisplaySettings } from "@review-buddy/core/types";
import type { CSSProperties } from "react";
import { bundledThemesInfo } from "shiki/themes";

export type ThemeMode = "light" | "dark";

export interface ThemeOption {
  id: string;
  name: string;
}

// Registered by @pierre/diffs itself, not part of Shiki's catalog.
const PIERRE_THEMES: Record<ThemeMode, ThemeOption[]> = {
  light: [
    { id: "pierre-light", name: "Pierre Light" },
    { id: "pierre-light-soft", name: "Pierre Light Soft" },
  ],
  dark: [
    { id: "pierre-dark", name: "Pierre Dark" },
    { id: "pierre-dark-soft", name: "Pierre Dark Soft" },
  ],
};

function shikiThemes(mode: ThemeMode): ThemeOption[] {
  return bundledThemesInfo
    .filter((t) => t.type === mode)
    .map((t) => ({ id: t.id, name: t.displayName }));
}

/** Selectable syntax themes per color mode. Shiki lazy-loads each on first use. */
export const THEMES: Record<ThemeMode, ThemeOption[]> = {
  light: [...shikiThemes("light"), ...PIERRE_THEMES.light],
  dark: [...shikiThemes("dark"), ...PIERRE_THEMES.dark],
};

export interface CodeFont {
  id: string;
  name: string;
  /** CSS family name declared in theme.css; null = the OS monospace. */
  family: string | null;
}

/**
 * Free (SIL OFL 1.1) code fonts, self-hosted because VIEWER_CSP is
 * font-src 'self'. JetBrains Mono is the design's mono face and the default.
 */
export const CODE_FONTS: readonly CodeFont[] = [
  { id: "jetbrains-mono", name: "JetBrains Mono", family: "JetBrains Mono" },
  { id: "fira-code", name: "Fira Code", family: "Fira Code" },
  { id: "cascadia-code", name: "Cascadia Code", family: "Cascadia Code" },
  { id: "geist-mono", name: "Geist Mono", family: "Geist Mono" },
  { id: "monaspace-neon", name: "Monaspace Neon", family: "Monaspace Neon" },
  { id: "ibm-plex-mono", name: "IBM Plex Mono", family: "IBM Plex Mono" },
  { id: "source-code-pro", name: "Source Code Pro", family: "Source Code Pro" },
  { id: "victor-mono", name: "Victor Mono", family: "Victor Mono" },
  { id: "system", name: "System monospace", family: null },
];

export const FONT_SIZES = [12, 13, 14, 15, 16] as const;

// The fonts ship the Latin subset only; other glyphs fall back to these.
const MONO_FALLBACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// @pierre/diffs' default is 13px text on a 20px line; keep that ratio at every size.
const LINE_HEIGHT_RATIO = 20 / 13;

/**
 * CSS custom properties that apply the code font settings. Custom properties
 * inherit into @pierre/diffs' shadow DOM, so setting them on a container styles
 * every diff inside it. Only the diff code changes: `--font-mono` stays the
 * design's, because the UI uses it for labels too.
 */
export function codeFontStyle(
  s: Pick<DisplaySettings, "font" | "fontSize" | "ligatures">,
): CSSProperties {
  const font = CODE_FONTS.find((f) => f.id === s.font);
  return {
    "--diffs-font-family": font?.family ? `"${font.family}", ${MONO_FALLBACK}` : MONO_FALLBACK,
    "--diffs-font-size": `${s.fontSize}px`,
    "--diffs-line-height": `${Math.round(s.fontSize * LINE_HEIGHT_RATIO)}px`,
    // Off by default: in a review, `!==` should look like the three characters it is.
    "--diffs-font-features": s.ligatures ? "normal" : '"liga" 0, "calt" 0',
  } as CSSProperties;
}
