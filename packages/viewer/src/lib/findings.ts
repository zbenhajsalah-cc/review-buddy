import { describeLines } from "@review-buddy/core/messages";
import type { FindingSeverity, ResolvedFinding } from "@review-buddy/core/types";

/** Most severe first. */
export const SEVERITIES: readonly FindingSeverity[] = ["important", "nit", "pre_existing"];

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  important: "Important",
  nit: "Nit",
  pre_existing: "Pre-existing",
};

const PLURAL: Record<FindingSeverity, [string, string]> = {
  important: ["important", "important"],
  nit: ["nit", "nits"],
  pre_existing: ["pre-existing", "pre-existing"],
};

/** Severity first, then path and line. */
export function sortFindings(findings: readonly ResolvedFinding[]): ResolvedFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );
}

/** "3 important · 5 nits · 1 pre-existing" — only the counts that are not zero. */
export function findingCounts(findings: readonly ResolvedFinding[]): string {
  return SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${PLURAL[s][n === 1 ? 0 : 1]}`)
    .join(" · ");
}

/** "line 42 (new)", "lines 40-42 (new)". */
export function findingLines(f: Pick<ResolvedFinding, "side" | "line" | "start_line">): string {
  return describeLines({ side: f.side, line: f.line, startLine: f.start_line });
}

/** The findings of one chapter. */
export function chapterFindings(
  findings: readonly ResolvedFinding[] | undefined,
  chapterIndex: number,
): ResolvedFinding[] {
  return sortFindings((findings ?? []).filter((f) => f.chapterIndex === chapterIndex));
}

/** Findings on files the diff does not have ("Other findings"). */
export function otherFindings(findings: readonly ResolvedFinding[] | undefined): ResolvedFinding[] {
  return sortFindings((findings ?? []).filter((f) => f.chapterIndex === undefined));
}

/** One finding as a Markdown list item: location, severity, title, and body. */
export function findingToMarkdown(f: ResolvedFinding): string {
  const head = `- **${SEVERITY_LABEL[f.severity]}** \`${f.path}\` ${findingLines(f)}: ${f.title}`;
  const extra = [
    f.outsideDiff ? "outside the diff" : "",
    f.source ? `from ${f.source}` : "",
  ].filter(Boolean);
  const meta = extra.length > 0 ? ` (${extra.join(", ")})` : "";
  const body = f.body?.trim() ? `\n  ${f.body.trim().replace(/\n/g, "\n  ")}` : "";
  return `${head}${meta}${body}`;
}
