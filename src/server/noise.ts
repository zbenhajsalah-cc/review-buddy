/**
 * Heuristic for generated / binary artifacts that should not dilute the
 * "Unsorted changes" bucket. Basename + extension only — no directory rules
 * (this repo commits `src/ui/dist` on purpose).
 */

export const NOISE_FILENAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  "gemfile.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "go.sum",
  "flake.lock",
  ".ds_store",
  "thumbs.db",
]);

export const NOISE_EXTENSIONS: readonly string[] = [
  ".min.js",
  ".min.css",
  ".map",
  ".snap",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".pdf",
];

export function isNoiseFile(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (NOISE_FILENAMES.has(basename)) return true;
  return NOISE_EXTENSIONS.some((ext) => basename.endsWith(ext));
}
