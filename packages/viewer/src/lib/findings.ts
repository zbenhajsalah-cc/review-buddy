/**
 * Findings from other tools (`/code-review`, …) as the viewer uses them: how
 * they are labelled, ordered and counted, and — plan 019 part 2 — the
 * reviewer's answer to each one.
 *
 * An answer is kept in this browser per review (`ReviewApi.reviewKey`), like
 * viewed state and line comments, and cleared when the review is submitted.
 * With round-trip on it goes to the agent with the verdict
 * (`DoneResult.findings`): the finding's id and the decision, never its text.
 */
import { describeLines, FINDING_SEVERITIES } from "@review-buddy/core/messages";
import {
  type FindingAnswer,
  type FindingDecision,
  type FindingSeverity,
  MAX_FINDING_REASON,
  type ResolvedFinding,
} from "@review-buddy/core/types";
import { useCallback, useMemo } from "react";
import { useReviewApi } from "../review-api.tsx";
import { reviewStorageKey } from "./chapterFileSet.ts";
import { parseStored, usePersistedState } from "./usePersistedState.ts";

export type { FindingAnswer, FindingDecision };
export { MAX_FINDING_REASON };

/** Most severe first — the one order, shared with the agent-facing text. */
export const SEVERITIES = FINDING_SEVERITIES;

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

/** What the reviewer decided, for a heading or a list item. */
export const DECISION_LABEL: Record<FindingDecision, string> = {
  fix: "To fix",
  dismiss: "Dismissed",
};

/**
 * One finding as a Markdown list item: location, severity, title, body, and
 * the reviewer's answer when it has one.
 */
export function findingToMarkdown(f: ResolvedFinding, answer?: FindingAnswer): string {
  const head = `- **${SEVERITY_LABEL[f.severity]}** \`${f.path}\` ${findingLines(f)}: ${f.title}`;
  const extra = [
    f.outsideDiff ? "outside the diff" : "",
    f.source ? `from ${f.source}` : "",
  ].filter(Boolean);
  const meta = extra.length > 0 ? ` (${extra.join(", ")})` : "";
  const body = f.body?.trim() ? `\n  ${f.body.trim().replace(/\n/g, "\n  ")}` : "";
  const reason = answer?.reason?.trim();
  const decision = answer
    ? `\n  → ${DECISION_LABEL[answer.decision]}${reason ? `: ${reason.replace(/\n/g, " ")}` : ""}`
    : "";
  return `${head}${meta}${body}${decision}`;
}

/* ------------------------------------------------------------------ */
/* The reviewer's answers                                              */
/* ------------------------------------------------------------------ */

const answersKey = (reviewKey: string) => reviewStorageKey("findings", reviewKey);

/** Storage is the reviewer's browser: drop entries this version can't use. */
function isAnswer(v: unknown): v is FindingAnswer {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    (a.decision === "fix" || a.decision === "dismiss") &&
    (a.reason === undefined || typeof a.reason === "string")
  );
}

/** This review's answers, read once (the Overview, the Done check). */
export function readFindingAnswers(reviewKey: string): FindingAnswer[] {
  try {
    return parseStored<unknown[]>(localStorage.getItem(answersKey(reviewKey)), []).filter(isAnswer);
  } catch {
    return [];
  }
}

/**
 * This review's answers, with stable callbacks. The array keeps its identity
 * until an answer changes, so `FileDiffCard`'s memo survives a filter
 * keystroke — pass it and the callbacks straight through.
 */
export function useFindingAnswers(): {
  answers: readonly FindingAnswer[];
  /** Answer a finding, replacing any earlier answer to it. */
  answer: (id: string, decision: FindingDecision, reason?: string) => void;
  /** Take the answer back ("Undo"). */
  clearAnswer: (id: string) => void;
} {
  const [stored, setStored] = usePersistedState<unknown[]>(
    answersKey(useReviewApi().reviewKey),
    [],
    "local",
  );
  const answers = useMemo(() => stored.filter(isAnswer), [stored]);
  const answer = useCallback(
    (id: string, decision: FindingDecision, reason?: string) => {
      // Cut as well as trimmed: the server refuses a longer reason, and a
      // whole review must not fail to submit over one that slipped in (an
      // older entry in this browser's storage, say).
      const trimmed = reason?.trim().slice(0, MAX_FINDING_REASON);
      const next: FindingAnswer = { id, decision, ...(trimmed ? { reason: trimmed } : {}) };
      setStored((prev) => [...prev.filter((a) => !(isAnswer(a) && a.id === id)), next]);
    },
    [setStored],
  );
  const clearAnswer = useCallback(
    (id: string) => setStored((prev) => prev.filter((a) => !(isAnswer(a) && a.id === id))),
    [setStored],
  );
  return { answers, answer, clearAnswer };
}

/** The answers by finding id. */
export function answersById(answers: readonly FindingAnswer[]): ReadonlyMap<string, FindingAnswer> {
  return new Map(answers.map((a) => [a.id, a]));
}

/** The findings with no answer yet, most severe first. */
export function openFindings(
  findings: readonly ResolvedFinding[] | undefined,
  answers: readonly FindingAnswer[],
): ResolvedFinding[] {
  const answered = new Set(answers.map((a) => a.id));
  return sortFindings((findings ?? []).filter((f) => !answered.has(f.id)));
}

/**
 * The answers that still belong to this review, for the agent. A stale answer
 * (its finding is gone from a re-submitted review) is left behind rather than
 * sent for the server to drop.
 */
export function answersToSend(
  findings: readonly ResolvedFinding[] | undefined,
  answers: readonly FindingAnswer[],
): FindingAnswer[] {
  const ids = new Set((findings ?? []).map((f) => f.id));
  return answers
    .filter((a) => ids.has(a.id))
    .map((a) =>
      a.reason && a.reason.length > MAX_FINDING_REASON
        ? { ...a, reason: a.reason.slice(0, MAX_FINDING_REASON) }
        : a,
    );
}
