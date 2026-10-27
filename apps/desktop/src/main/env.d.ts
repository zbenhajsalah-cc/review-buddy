/** Vite's `?raw` imports: the file's text, bundled into main. */
declare module "*?raw" {
  const content: string;
  export default content;
}

/** The Agent SDK's Claude Code version, set at build time (electron.vite.config.ts). */
declare const __CLAUDE_CODE_MIN_VERSION__: string;
