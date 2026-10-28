# Fonts

Self-hosted, latin-subset `woff2` only — the three faces the design uses:

| File | Family | Weights |
| --- | --- | --- |
| `inter-latin-var.woff2` | Inter (variable) | 400–700 |
| `instrument-serif-latin-400.woff2` | Instrument Serif | 400 |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono (variable) | 400–600 |

They are declared in `../theme.css`, which both app builds `@import`, so Vite
resolves the relative `url()`s and emits the files into each bundle.

**Why self-hosted rather than a Google Fonts `<link>`:** every app that shows
the viewer runs under `VIEWER_CSP` (`packages/core/src/viewer-csp.ts`), whose
`font-src`/`style-src` are `'self'`. A remote font would mean relaxing a CSP
shared by the plugin's loopback server and the desktop renderer, and the
desktop app would lose its type offline. Latin-only keeps all three under 100 kB
together.

Sourced from the Google Fonts `css2` API (the `/* latin */` block's `src`).
All three are licensed under the SIL Open Font License 1.1.
