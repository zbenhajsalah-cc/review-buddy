import type { FindingSeverity, ResolvedFinding } from "@review-buddy/core/types";
import { useState } from "react";
import { findingLines, SEVERITY_LABEL } from "../lib/findings.ts";
import { cn } from "../lib/utils.ts";
import { Markdown } from "./Markdown.tsx";

const LOOK: Record<FindingSeverity, { spine: string; tag: string }> = {
  important: { spine: "border-l-risk-high", tag: "bg-risk-high-bg text-risk-high" },
  nit: { spine: "border-l-border", tag: "bg-muted text-muted-foreground" },
  pre_existing: { spine: "border-l-risk-medium", tag: "bg-risk-medium-bg text-risk-medium" },
};

/** The severity tag: "Important", "Nit", "Pre-existing". */
export function SeverityTag({ severity }: { severity: FindingSeverity }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.6rem] font-medium uppercase tracking-[0.06em]",
        LOOK[severity].tag,
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/**
 * A finding from another tool (`/code-review`, …), shown under its line like
 * a comment but with its own look. Nits are folded: the title shows, the body
 * opens on a click. Read only: answering it is plan 019's second part.
 */
export function FindingCard({
  finding,
  showPath = false,
}: {
  finding: ResolvedFinding;
  /** Show the file path too (lists outside one file's diff). */
  showPath?: boolean;
}) {
  const [open, setOpen] = useState(finding.severity !== "nit");
  const body = finding.body?.trim();
  return (
    <article
      data-finding-id={finding.id}
      aria-label={`${SEVERITY_LABEL[finding.severity]} finding: ${finding.title}`}
      className={cn(
        "rounded-md border border-border border-l-[3px] bg-card px-3 py-2 shadow-xs",
        LOOK[finding.severity].spine,
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SeverityTag severity={finding.severity} />
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {showPath && `${finding.path} `}
          {findingLines(finding)}
        </span>
        {finding.source && (
          <span className="text-[0.7rem] text-muted-foreground">from {finding.source}</span>
        )}
      </header>
      <p className="mt-1 font-medium">{finding.title}</p>
      {finding.severity === "pre_existing" && (
        <p className="mt-0.5 text-xs text-risk-medium">Not from this change.</p>
      )}
      {body &&
        (open ? (
          <Markdown value={body} className="mt-1 text-muted-foreground" />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Show details
          </button>
        ))}
    </article>
  );
}
