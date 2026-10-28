/**
 * The agent's tools for one PR review (US-12), as an in-process MCP server:
 *
 *   get_pr_diff    the PR's metadata and unified diff, in parts
 *   read_file      a changed file's full text, at the head or the base
 *   submit_review  validate → resolve the review, and answer with the
 *                  resolution notes so the agent can fix its anchors
 *
 * Read-only: the runner gives the agent these three tools and nothing else
 * (no shell, no file writes). The diff the agent reads and the diff
 * resolveReview parses are the same string, passed in once.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { parseDiff } from "@review-buddy/core/diff";
import { resolutionNotesMessage } from "@review-buddy/core/messages";
import { buildMeta } from "@review-buddy/core/meta";
import { resolveReview } from "@review-buddy/core/resolve";
import reviewSchema from "@review-buddy/core/review.schema.json" with { type: "json" };
import type { AgentReview, PrMetadata, ResolvedReview } from "@review-buddy/core/types";
import { validateAgentReview } from "@review-buddy/core/validate";
import { z } from "zod";
import type { ReviewPhase } from "../../shared/ipc.ts";

export const SERVER_NAME = "review-buddy";
export const TOOL_NAMES = ["get_pr_diff", "read_file", "submit_review"] as const;
/** The names the agent calls them by: the only tools it is allowed. */
export const ALLOWED_TOOLS = TOOL_NAMES.map((name) => `mcp__${SERVER_NAME}__${name}`);

/** The desktop prompt allows the first submission plus 2 fixes. */
export const MAX_SUBMISSIONS = 3;
/**
 * Most characters in one tool answer. Claude Code cuts MCP tool output at about
 * 25k tokens; 40k characters of code stay well under that.
 */
export const MAX_PART_CHARS = 40_000;
/**
 * Longest line read_file shows; the rest is cut with a note. Long lines are
 * minified or generated code, where the start is enough to judge it, and one
 * such line must not fill (or overflow) a whole answer.
 */
export const MAX_LINE_CHARS = 2_000;

/**
 * The shared submit_review JSON schema without `cwd` and `source`: the app
 * already knows the PR, and the desktop prompt says not to pass them.
 */
export function desktopReviewSchema() {
  const { $schema: _s, $id: _i, title: _t, ...schema } = reviewSchema;
  const { cwd: _c, source: _src, ...properties } = schema.properties;
  return { ...schema, properties };
}

/** The same schema as zod, which is what the SDK's `tool()` takes. */
function submitReviewShape(): z.ZodRawShape {
  const schema = z.fromJSONSchema(desktopReviewSchema() as z.core.JSONSchema.JSONSchema);
  if (!(schema instanceof z.ZodObject)) throw new Error("review schema is not an object");
  return schema.shape;
}

/**
 * Splits a diff into parts of at most `max` characters that join back to the
 * exact diff. Parts start at a file (`diff --git`) when they can; a file
 * larger than `max` is split at its hunks, then at lines.
 */
export function splitDiff(diff: string, max = MAX_PART_CHARS): string[] {
  const pieces: string[] = [];
  for (const file of splitBefore(diff, /^diff --git /m)) {
    if (file.length <= max) {
      pieces.push(file);
      continue;
    }
    for (const hunk of splitBefore(file, /^@@ /m)) {
      if (hunk.length <= max) pieces.push(hunk);
      else pieces.push(...packLines(hunk, max));
    }
  }
  const parts: string[] = [];
  for (const piece of pieces) {
    const last = parts.length - 1;
    if (last >= 0 && parts[last]!.length + piece.length <= max) parts[last] += piece;
    else parts.push(piece);
  }
  return parts.length ? parts : [""];
}

/** Splits `text` before every line matching `start` (a /m regex for line starts). */
function splitBefore(text: string, start: RegExp): string[] {
  const at = [...text.matchAll(new RegExp(start.source, "gm"))].map((m) => m.index);
  if (at[0] !== 0) at.unshift(0);
  return at.map((from, i) => text.slice(from, at[i + 1] ?? text.length)).filter(Boolean);
}

/** Lines packed into chunks of at most `max` characters (a longer line is cut). */
function packLines(text: string, max: number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const line of text.split(/(?<=\n)/)) {
    for (let i = 0; i < line.length; i += max) {
      const bit = line.slice(i, i + max);
      if (chunk.length + bit.length > max) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk += bit;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function cutLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  return `${line.slice(0, MAX_LINE_CHARS)} … [line cut: ${line.length - MAX_LINE_CHARS} more characters]`;
}

export interface ReviewToolsInput {
  /** `owner/repo#123`, for messages. */
  label: string;
  pr: PrMetadata;
  /** The PR diff: read by the agent AND resolved against. */
  diff: string;
  /** Full file text (source C); "" = unavailable; throws for paths not in the PR. */
  fileContent(path: string, side: "base" | "head"): Promise<string>;
  /** The model name for the review's meta. */
  generatedBy(): string;
  /** A short line for the app's progress view, with the phase it belongs to. */
  onProgress?(progress: ReviewProgress): void;
}

/** One progress event: a short line, and the phase it belongs to. */
export interface ReviewProgress {
  phase: ReviewPhase;
  step: string;
  /** Set once, when Claude says which model it is running (US-22). */
  model?: string;
}

export interface Submission {
  review: ResolvedReview;
  warnings: string[];
  /** 1 for the first resolved submission. */
  number: number;
}

export interface ReviewTools {
  server: ReturnType<typeof createSdkMcpServer>;
  /** The last review that passed validation and resolution, if any. */
  latest(): Submission | undefined;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const err = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export function createReviewTools(input: ReviewToolsInput): ReviewTools {
  const { label, pr, diff } = input;
  const parts = splitDiff(diff);
  const paths = new Set(parseDiff(diff).map((f) => f.path));
  const progress = input.onProgress ?? (() => {});
  let latest: Submission | undefined;

  const getPrDiff = tool(
    "get_pr_diff",
    "The pull request's metadata (title, description, author, base, head) and its unified " +
      "diff: the exact diff your hunk anchors are resolved against. A large diff comes in " +
      "parts; call again with the `part` number the answer names until you have read them all.",
    { part: z.number().int().min(1).optional().describe("Which part (default 1).") },
    async ({ part = 1 }) => {
      if (part > parts.length) return err(`There are only ${parts.length} part(s).`);
      progress({
        phase: "reading",
        step:
          parts.length > 1
            ? `Reading the diff (part ${part} of ${parts.length})`
            : "Reading the diff",
      });
      const lines: string[] = [];
      if (part === 1) {
        lines.push(
          `Pull request ${label}: ${pr.title}`,
          `Author: @${pr.author} · base \`${pr.base}\` ← head \`${pr.head}\`${pr.url ? ` · ${pr.url}` : ""}`,
          "",
          "Description:",
          pr.description.trim() || "(none)",
          "",
        );
      }
      lines.push(
        parts.length > 1
          ? `Diff, part ${part} of ${parts.length}.${part < parts.length ? ` Call get_pr_diff with part ${part + 1} next.` : " This is the last part."}`
          : "Diff:",
        "",
        parts[part - 1]!,
      );
      return ok(lines.join("\n"));
    },
    { annotations: { readOnlyHint: true } },
  );

  const readFile = tool(
    "read_file",
    "The full text of a file this PR changes, with line numbers: at the PR head (default) or " +
      "at the base (before the PR). Only files in the diff can be read. Long files come in " +
      "windows; pass `start_line` to read further.",
    {
      path: z.string().describe("The file's path as in the diff (the new path for a rename)."),
      side: z.enum(["head", "base"]).optional().describe("Default head."),
      start_line: z.number().int().min(1).optional().describe("First line to show (default 1)."),
    },
    async ({ path, side = "head", start_line = 1 }) => {
      if (!paths.has(path)) {
        return err(`${path} is not a file in this PR's diff; read_file reads only those.`);
      }
      progress({
        phase: "reading",
        step: `Reading ${path}${side === "base" ? " (before the PR)" : ""}`,
      });
      let text: string;
      try {
        text = await input.fileContent(path, side);
      } catch (e) {
        return err(`Could not read ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!text) {
        return ok(
          `${path} has no text at the ${side}: it is binary, does not exist on that side ` +
            "(added or deleted in this PR), or is too large.",
        );
      }
      const all = text.split("\n");
      if (all.at(-1) === "") all.pop();
      if (start_line > all.length) return err(`${path} has only ${all.length} lines.`);
      const shown: string[] = [];
      let size = 0;
      let n = start_line;
      for (; n <= all.length; n++) {
        const line = `${n}\t${cutLine(all[n - 1]!)}`;
        if (size + line.length > MAX_PART_CHARS && shown.length > 0) break;
        shown.push(line);
        size += line.length + 1;
      }
      const end = n - 1;
      const head =
        start_line === 1 && end === all.length
          ? `${path} (${side}), ${all.length} lines:`
          : `${path} (${side}), lines ${start_line}–${end} of ${all.length}.` +
            (end < all.length ? ` Call read_file with start_line ${end + 1} for more.` : "");
      return ok([head, "", ...shown].join("\n"));
    },
    { annotations: { readOnlyHint: true } },
  );

  let resolved = 0;
  const submitReview = tool(
    "submit_review",
    "Submit the narrative review: a Prologue and ordered, risk-rated Chapters grouped by " +
      "theme. Reference hunks by their anchors (old_start / new_start from the @@ headers); " +
      "never copy diff lines. Answers with resolution notes when anchors or paths do not " +
      "match the diff.",
    submitReviewShape(),
    async (args) => {
      if (resolved >= MAX_SUBMISSIONS) {
        return err(
          `The app already has ${MAX_SUBMISSIONS} submissions and shows the last one. Stop now.`,
        );
      }
      const invalid = validateAgentReview(args);
      if (invalid) return err(`Invalid review payload — fix and resubmit: ${invalid}`);
      resolved++;
      progress({ phase: "checking", step: "Checking the chapters against the diff" });
      const { review, warnings } = resolveReview(
        args as unknown as AgentReview,
        diff,
        buildMeta({ generatedBy: input.generatedBy() }),
        pr,
      );
      latest = { review, warnings, number: resolved };
      progress({
        phase: "checking",
        step: warnings.length
          ? `Review submitted with ${warnings.length} resolution note(s)`
          : "Review submitted",
      });
      const notes = resolutionNotesMessage(warnings);
      if (!notes) {
        return ok(
          "Review accepted: every anchor matched the diff. The reviewer reads it in the app now; " +
            "finish with one short sentence.",
        );
      }
      const left = MAX_SUBMISSIONS - resolved;
      return ok(
        `Review received (submission ${resolved} of at most ${MAX_SUBMISSIONS}). The app shows ` +
          `your last submission and its notes.\n\n${notes}\n\n` +
          (left > 0
            ? `You may call submit_review again with the fixes (${left} more time(s)).`
            : "That was the last submission: stop now."),
      );
    },
  );

  const server = createSdkMcpServer({
    name: SERVER_NAME,
    tools: [getPrDiff, readFile, submitReview],
    // There is no tool-search tool to find deferred tools: always load these.
    alwaysLoad: true,
  });
  return { server, latest: () => latest };
}
