/**
 * Unified-diff parser for `git diff` output (source B).
 *
 * Turns raw `git diff` text into files -> hunks with exact `@@` headers, line
 * numbers, and verbatim content lines. This is the authoritative diff the agent
 * REFERENCES (never reproduces) — see docs/review-contract.md.
 *
 * Deliberately hand-rolled (not jsdiff's parsePatch) so we capture git-specific
 * metadata the contract needs: change type (added/deleted/modified/renamed),
 * rename paths, binary flag, and the full header line incl. its section suffix.
 */
import type { ChangeType } from "./types.ts";

export interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Full verbatim header, e.g. "@@ -12,6 +12,9 @@ export function useSport() {" */
  header: string;
  /** Verbatim unified lines: " ctx", "+add", "-del", and "\ No newline..." markers. */
  lines: string[];
  additions: number;
  deletions: number;
  /** Internal: which chapter claimed this hunk during resolution (-1 = unclaimed). */
  claimedBy: number;
}

export interface ParsedFile {
  /**
   * Canonical path: the head/new path, or the old path for deletions. Always a
   * fully-decoded on-disk path — no git C-quoting, no `a/`/`b/` prefix, and no
   * `---`/`+++` tab terminator (see unquotePath / stripPrefix / headerPath).
   */
  path: string;
  /** Present for renames (the pre-rename path). */
  oldPath?: string;
  changeType: ChangeType;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: ParsedHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Strip a leading `a/` or `b/` prefix git adds to diff paths. */
function stripPrefix(p: string): string {
  if (p === "/dev/null") return p;
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

/** git quotes paths containing special chars in C-style; unquote them. */
function unquotePath(p: string): string {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    try {
      return JSON.parse(p) as string;
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}

/**
 * Extract the path from a `---`/`+++` header body (the text after "--- ").
 * git appends a TAB — then an optional timestamp — as a field terminator
 * when the filename contains a space (e.g. `+++ b/with space.ts\t`). Strip
 * that terminator BEFORE unquoting: a C-quoted name encodes an interior tab
 * as the two literal chars `\t` (not a real 0x09), so cutting at the first
 * real tab removes only git's separator and never truncates an escaped name.
 */
function headerPath(seg: string): string {
  const tab = seg.indexOf("\t");
  const raw = tab === -1 ? seg : seg.slice(0, tab);
  return unquotePath(stripPrefix(raw));
}

function finalizeFile(file: ParsedFile): void {
  file.additions = file.hunks.reduce((n, h) => n + h.additions, 0);
  file.deletions = file.hunks.reduce((n, h) => n + h.deletions, 0);
}

/**
 * Parse the full output of `git diff` into structured files.
 * Tolerant of: 1-line hunks (`@@ -1 +1 @@`), new/deleted/renamed files,
 * binary files, and `\ No newline at end of file` markers.
 */
export function parseDiff(raw: string): ParsedFile[] {
  const lines = raw.split("\n");
  const files: ParsedFile[] = [];

  let file: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;

  const closeHunk = () => {
    if (file && hunk) file.hunks.push(hunk);
    hunk = null;
  };
  const closeFile = () => {
    closeHunk();
    if (file) {
      finalizeFile(file);
      files.push(file);
    }
    file = null;
  };

  for (const line of lines) {
    // New file section.
    if (line.startsWith("diff --git ")) {
      closeFile();
      file = {
        path: "",
        changeType: "modified",
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      // Best-effort path from the header itself. Authoritative for binary /
      // no-hunk files (which carry no ---/+++ lines); overridden by +++ below
      // when present. Greedy split tolerates simple paths; quoted/space paths
      // fall back to the ---/+++ lines.
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m) file.path = unquotePath(m[2]!);
      continue;
    }

    if (!file) continue; // preamble / noise before the first file

    // Inside a hunk body: collect content lines until a non-body line appears.
    if (hunk) {
      const c = line[0];
      if (c === " " || c === "+" || c === "-" || c === "\\") {
        hunk.lines.push(line);
        if (c === "+") hunk.additions++;
        else if (c === "-") hunk.deletions++;
        continue;
      }
      // Anything else ends the current hunk; fall through to re-handle `line`.
      closeHunk();
    }

    // File-level metadata lines.
    if (line.startsWith("new file mode")) {
      file.changeType = "added";
    } else if (line.startsWith("deleted file mode")) {
      file.changeType = "deleted";
    } else if (line.startsWith("rename from ")) {
      file.changeType = "renamed";
      file.oldPath = unquotePath(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      file.changeType = "renamed";
      file.path = unquotePath(line.slice("rename to ".length));
    } else if (line.startsWith("copy to ")) {
      file.path = unquotePath(line.slice("copy to ".length));
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      file.binary = true;
    } else if (line.startsWith("--- ")) {
      const p = headerPath(line.slice(4));
      if (p !== "/dev/null" && !file.oldPath) file.oldPath = p;
    } else if (line.startsWith("+++ ")) {
      const p = headerPath(line.slice(4));
      if (p !== "/dev/null") file.path = p;
    } else {
      const m = HUNK_HEADER.exec(line);
      if (m) {
        hunk = {
          oldStart: Number(m[1]),
          oldLines: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newLines: m[4] === undefined ? 1 : Number(m[4]),
          header: line,
          lines: [],
          additions: 0,
          deletions: 0,
          claimedBy: -1,
        };
      }
    }
  }

  closeFile();

  // Fallbacks for files with no +++/--- (e.g. pure renames, mode-only changes):
  // recover the canonical path from oldPath so resolution can still match them.
  for (const f of files) {
    if (!f.path && f.oldPath) f.path = f.oldPath;
  }

  return files;
}

/** Map a file extension to a highlight language id. */
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  graphql: "graphql",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  lua: "lua",
  r: "r",
};

export function languageOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "text";
  return EXT_LANG[base.slice(dot + 1).toLowerCase()] ?? "text";
}
