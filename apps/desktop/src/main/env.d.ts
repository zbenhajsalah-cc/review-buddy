/** Vite's `?raw` imports: the file's text, bundled into main. */
declare module "*?raw" {
  const content: string;
  export default content;
}

/** Vite's `?asset` imports: the file is copied into out/, the path points at it. */
declare module "*?asset" {
  const path: string;
  export default path;
}

/** The Agent SDK's Claude Code version, set at build time (electron.vite.config.ts). */
declare const __CLAUDE_CODE_MIN_VERSION__: string;
