/**
 * Agent-facing feedback text, shared by every entry point: the Claude Code hook
 * (deny reason / `additionalContext`), standalone MCP tool results, and any
 * future runner that hands review results back to an agent.
 */

/**
 * Reviewer's request-changes verdict as a human/agent-readable message — the
 * hook's deny reason and blocking standalone's tool result share this wording.
 * Non-string summaries (malformed /api/done body) degrade to the generic form.
 */
export function requestChangesMessage(summary: unknown): string {
  const note = typeof summary === "string" ? summary.trim() : "";
  return note
    ? `Reviewer requested changes:\n\n${note}`
    : "Reviewer requested changes (no details provided) — re-examine the flagged chapters.";
}

const MAX_RESOLUTION_NOTES = 10;

/**
 * Format resolution/coverage warnings for the agent-visible feedback channel
 * (hook `additionalContext` / standalone tool-result text). Empty → undefined
 * so callers can omit the block entirely. Caps bullets so a pathological
 * review can't blow the agent's context window.
 */
export function resolutionNotesMessage(warnings: readonly string[]): string | undefined {
  if (warnings.length === 0) return undefined;
  const shown = warnings.slice(0, MAX_RESOLUTION_NOTES);
  const omitted = warnings.length - shown.length;
  const lines = [
    `${warnings.length} resolution note${warnings.length === 1 ? "" : "s"} — ` +
      `places the tool could not map this review onto the real diff:`,
    ...shown.map((w) => `- ${w}`),
  ];
  if (omitted > 0) {
    lines.push(`…and ${omitted} more omitted.`);
  }
  lines.push(
    "If you submit this diff again, correct the file paths and hunk anchors " +
      "(`old_start` / `new_start` from the `@@` headers).",
  );
  return lines.join("\n");
}
