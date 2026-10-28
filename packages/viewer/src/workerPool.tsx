import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from "@pierre/diffs/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
// Separate hashed asset (not ?worker&inline) so workers load from same-origin URLs
// compatible with the viewer CSP (default-src 'self'; blob:/data: workers blocked).
// @ts-expect-error Vite ?worker virtual module (no ambient types in this package)
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { type ReactNode, useState } from "react";
import { diffThemes, granularityToLineDiffType, readDisplaySettings } from "./settings.ts";

const poolOptions: WorkerPoolOptions = {
  poolSize: Math.min(Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1), 3),
  totalASTLRUCacheSize: 100,
  workerFactory: () => new DiffsWorker() as Worker,
};

const LANGS: WorkerInitializationRenderOptions["langs"] = [
  "typescript",
  "tsx",
  "javascript",
  "json",
  "css",
  "html",
  "python",
  "go",
  "rust",
  "sh",
  "yaml",
  "markdown",
];

/**
 * Start the pool on the reviewer's saved theme + granularity. The theme must
 * match toDiffOptions': while the pool is working, @pierre/diffs highlights
 * with the POOL's render options, not the card's (left unset, the pool fell
 * back to pierre-dark/pierre-light while the main-thread fallback used the
 * cards' theme). useDisplaySettings keeps the pool in step after that.
 */
function initialHighlighterOptions(): WorkerInitializationRenderOptions {
  const settings = readDisplaySettings();
  return {
    preferredHighlighter: "shiki-js",
    theme: diffThemes(settings),
    lineDiffType: granularityToLineDiffType(settings.granularity),
    langs: LANGS,
  };
}

export function ReviewWorkerPoolProvider({ children }: { children: ReactNode }) {
  // The provider reads its options once, on first render.
  const [highlighterOptions] = useState(initialHighlighterOptions);
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  );
}
