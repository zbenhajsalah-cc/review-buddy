import type {
  FindingAnswer,
  FindingDecision,
  FindingSeverity,
  ResolvedFinding,
} from "@review-buddy/core/types";
import { useState } from "react";
import {
  DECISION_LABEL,
  findingLines,
  MAX_FINDING_REASON,
  SEVERITY_LABEL,
} from "../lib/findings.ts";
import { cn } from "../lib/utils.ts";
import { Markdown } from "./Markdown.tsx";
import { Button } from "./ui/button.tsx";

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
 * An important finding must not be waved away silently: the agent is told not
 * to raise it again, so it is told why.
 */
const needsReason = (severity: FindingSeverity) => severity === "important";

/** The answer the reviewer gave, and the way back to no answer. */
function Answered({ answer, onClear }: { answer: FindingAnswer; onClear?: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-1.5 text-xs">
      <span
        className={cn(
          "font-medium",
          answer.decision === "fix" ? "text-risk-high" : "text-muted-foreground",
        )}
      >
        {DECISION_LABEL[answer.decision]}
      </span>
      {answer.reason && <span className="min-w-0 text-muted-foreground">— {answer.reason}</span>}
      {onClear && (
        <Button variant="link" size="sm" onClick={onClear} className="ml-auto h-auto p-0 text-xs">
          Undo
        </Button>
      )}
    </div>
  );
}

/** Fix / Dismiss, and the reason a dismissal carries. */
function AnswerForm({
  finding,
  onAnswer,
}: {
  finding: ResolvedFinding;
  onAnswer: (id: string, decision: FindingDecision, reason?: string) => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const reasonRequired = needsReason(finding.severity);
  const canDismiss = !reasonRequired || reason.trim().length > 0;

  if (!dismissing) {
    return (
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAnswer(finding.id, "fix")}
          title="Send this to the agent to fix"
        >
          Fix
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDismissing(true)}
          title="Answer it with a reason instead"
          className="text-muted-foreground"
        >
          Dismiss
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-1.5">
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the reviewer just asked for this field
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          reasonRequired
            ? "Why not? (the agent is told not to raise it again)"
            : "Why not? (optional)"
        }
        rows={2}
        // The reason the agent is given is cut far shorter than this; the limit
        // is here so a long one cannot be typed and then refused by the server
        // when the whole review is submitted.
        maxLength={MAX_FINDING_REASON}
        aria-label="Why this finding is dismissed"
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        {reason.length > MAX_FINDING_REASON - 200 && (
          <span className="mr-auto text-xs text-muted-foreground">
            {MAX_FINDING_REASON - reason.length} characters left
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDismissing(false);
            setReason("");
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canDismiss}
          title={canDismiss ? undefined : "An important finding needs a reason"}
          onClick={() => onAnswer(finding.id, "dismiss", reason)}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/**
 * A finding from another tool (`/code-review`, …), shown under its line like
 * a comment but with its own look. Nits are folded: the title shows, the body
 * opens on a click.
 *
 * With `onAnswer` it can be answered — Fix, or Dismiss with a reason — and the
 * answer goes to the agent with the verdict. Without it the card is read only
 * (round-trip off: nothing could carry the answer back).
 */
export function FindingCard({
  finding,
  showPath = false,
  answer,
  onAnswer,
  onClearAnswer,
}: {
  finding: ResolvedFinding;
  /** Show the file path too (lists outside one file's diff). */
  showPath?: boolean;
  /** The reviewer's answer, when they gave one. */
  answer?: FindingAnswer;
  /** Omit ⇒ read only. */
  onAnswer?: (id: string, decision: FindingDecision, reason?: string) => void;
  onClearAnswer?: (id: string) => void;
}) {
  const [open, setOpen] = useState(finding.severity !== "nit");
  const body = finding.body?.trim();
  return (
    <article
      data-finding-id={finding.id}
      data-answered={answer ? answer.decision : undefined}
      aria-label={`${SEVERITY_LABEL[finding.severity]} finding: ${finding.title}`}
      className={cn(
        "rounded-md border border-border border-l-[3px] bg-card px-3 py-2 shadow-xs",
        LOOK[finding.severity].spine,
        answer && "opacity-80",
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
      {answer ? (
        <Answered
          answer={answer}
          onClear={onClearAnswer ? () => onClearAnswer(finding.id) : undefined}
        />
      ) : (
        onAnswer && <AnswerForm finding={finding} onAnswer={onAnswer} />
      )}
    </article>
  );
}
