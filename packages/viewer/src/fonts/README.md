# Fonts

Self-hosted, latin-subset `woff2` only. The three faces the design uses:

| File | Family | Weights |
| --- | --- | --- |
| `inter-latin-var.woff2` | Inter (variable) | 400–700 |
| `instrument-serif-latin-400.woff2` | Instrument Serif | 400 |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono (variable) | 400–600 |

And the other code fonts a reviewer can pick in the diff viewer's
**Theme & font** popover (`CODE_FONTS` in `../appearance.ts`). Each is
downloaded only when picked; italics are a separate file where the font has
them (otherwise the browser slants the upright face):

| Files | Family | Weights |
| --- | --- | --- |
| `fira-code-latin-var.woff2` | Fira Code (variable, no italic) | 300–700 |
| `cascadia-code-latin-var{,-italic}.woff2` | Cascadia Code (variable) | 200–700 |
| `geist-mono-latin-var{,-italic}.woff2` | Geist Mono (variable) | 100–900 |
| `monaspace-neon-latin-400{,-italic}.woff2` | Monaspace Neon | 400 |
| `ibm-plex-mono-latin-400{,-italic}.woff2` | IBM Plex Mono | 400 |
| `source-code-pro-latin-var{,-italic}.woff2` | Source Code Pro (variable) | 200–900 |
| `victor-mono-latin-var{,-italic}.woff2` | Victor Mono (variable) | 100–700 |

They are declared in `../theme.css`, which both app builds `@import`, so Vite
resolves the relative `url()`s and emits the files into each bundle.

**Why self-hosted rather than a Google Fonts `<link>`:** every app that shows
the viewer runs under `VIEWER_CSP` (`packages/core/src/viewer-csp.ts`), whose
`font-src`/`style-src` are `'self'`. A remote font would mean relaxing a CSP
shared by the plugin's loopback server and the desktop renderer, and the
desktop app would lose its type offline. Latin-only keeps the three design
faces under 100 kB together, and the picker's fonts about 410 kB.

The design faces were sourced from the Google Fonts `css2` API (the
`/* latin */` block's `src`); the picker's fonts from Fontsource 5.3
(`@fontsource-variable/*` and `@fontsource/*`, the `latin` files). All are
licensed under the SIL Open Font License 1.1 — copyright notices and the
license text are in `OFL.txt`.
