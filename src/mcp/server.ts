/**
 * Review Buddy MCP server — exposes the single `submit_review` tool.
 *
 * The tool's inputSchema IS packages/core/schemas/review.schema.json, so Claude Code
 * validates the agent's review (and makes the model retry on mismatch) BEFORE
 * the PreToolUse hook ever runs.
 *
 * Two operating modes (see src/mcp/standalone.ts):
 *  - Claude Code (default): the PreToolUse hook (src/cli/index.ts `open-review`)
 *    does the real work — capture diff, render UI, block for the human. By the
 *    time this handler runs, the human has already seen the review, so it just
 *    acks back to the agent (Phase 1, one-way).
 *  - Standalone (`--standalone[=blocking]` flag, for Cursor / VS Code Copilot / Codex,
 *    which have no PreToolUse equivalent): the handler itself opens the review
 *    session. See docs/HARNESSES.md.
 *
 * Registered with Claude Code as MCP server "review-buddy". As a plugin-bundled
 * server, its tool's callable name is `mcp__plugin_review-buddy_review-buddy__submit_review`
 * (a user-configured .mcp.json server would use `mcp__review-buddy__submit_review`).
 * The PreToolUse hook matcher in hooks/hooks.json covers both forms.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import reviewSchema from "@review-buddy/core/review.schema.json";
// Only the flag parser is imported eagerly — the standalone handler (and the
// whole review-session stack behind it) loads lazily, so the default Claude
// Code mode pays nothing for machinery only other harnesses use.
import { standaloneMode } from "./mode.ts";

// The JSON Schema is the single source of truth; strip JSON-Schema meta
// keywords MCP inputSchema doesn't need.
const { $schema, $id, title, ...inputSchema } = reviewSchema;
void $schema;
void $id;
void title;

const MODE = standaloneMode();

const TOOL_DESCRIPTION = [
  "Submit a structured narrative code review of the current PR / working-tree diff.",
  "Provide a Prologue (why / what / key changes / review focus) and ordered, risk-rated",
  "Chapters grouped by THEME (not by file). For each chapter reference the files and the",
  "hunk ANCHORS (old_start / new_start from the @@ headers) that belong to it — do NOT copy",
  "diff line content; the tool attaches the authoritative lines from git. Omit a file's",
  "`hunks` to mean 'the whole file belongs to this chapter'. Calling this opens the review",
  "in the reviewer's browser.",
  ...(MODE !== "off"
    ? [
        "ALWAYS set `cwd` to the absolute repository root (run `git rev-parse --show-toplevel`)",
        "so the tool captures the diff from the right repo.",
      ]
    : []),
].join(" ");

// Version comes from package.json so release.sh's bump covers this too —
// a hardcoded string here was the one version site the release script missed.
const pkgPath = join(import.meta.dir, "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };

const server = new Server(
  { name: "review-buddy", version: pkg.version ?? "0.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "submit_review", description: TOOL_DESCRIPTION, inputSchema }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "submit_review") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }
  if (MODE !== "off") {
    const { handleStandaloneSubmit } = await import("./standalone.ts");
    return handleStandaloneSubmit(req.params.arguments, MODE);
  }
  return {
    content: [
      {
        type: "text",
        text: "Review displayed to the reviewer in the browser. Awaiting human review.",
      },
    ],
  };
});

await server.connect(new StdioServerTransport());

// Standalone modes keep a viewer alive inside this long-lived process. Tie MCP
// client disconnect + termination signals to a clean shutdown so the server (and
// its port) can't outlive the client. Off (Claude Code) mode has no long-lived
// viewer — the hook owns the lifecycle — so this only applies to standalone.
if (MODE !== "off") {
  const { makeShutdown } = await import("./standalone.ts");
  const shutdown = makeShutdown();
  server.onclose = shutdown;
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

console.error(
  `[review-buddy] MCP server ready (tool: submit_review${MODE !== "off" ? `, standalone: ${MODE}` : ""}).`,
);
