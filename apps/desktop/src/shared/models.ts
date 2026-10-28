/**
 * The model and effort a review runs on (US-22), as both sides see them: the
 * effort levels, what a model string may look like, and the small rules the
 * pickers and main both need (which levels a model offers, and how a choice
 * is kept inside them). Pure functions, no SDK and no Electron: main checks
 * what the renderer sends with the same code the pickers show.
 */
import type { ClaudeModelOption, ModelChoice, ReviewEffort } from "./ipc.ts";

/** In order, least to most. */
export const REVIEW_EFFORTS: readonly ReviewEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** The value the pickers use for "no model of our own" / "no effort of our own". */
export const DEFAULT_VALUE = "";

/** `value` is anything but one of the effort levels → undefined. */
export function toReviewEffort(value: unknown): ReviewEffort | undefined {
  return REVIEW_EFFORTS.includes(value as ReviewEffort) ? (value as ReviewEffort) : undefined;
}

/**
 * What the pickers offer when Claude Code could not be asked. Aliases only:
 * they stay valid as models are replaced, and Claude Code resolves them.
 */
export const FALLBACK_MODELS: ClaudeModelOption[] = [
  {
    value: "opus",
    displayName: "Opus",
    description: "The most capable model.",
    supportsEffort: true,
  },
  { value: "sonnet", displayName: "Sonnet", description: "Balanced.", supportsEffort: true },
  { value: "haiku", displayName: "Haiku", description: "The fastest.", supportsEffort: true },
];

/**
 * A model string that is safe to pass to Claude Code: an alias ("opus",
 * "sonnet[1m]") or a model id ("claude-opus-5"). Letters, digits, dots,
 * dashes, underscores, colons and one optional "[…]" suffix, so no argument,
 * path or shell character can get through.
 */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,62}(\[[A-Za-z0-9]{1,8}\])?$/;

export function isModelValue(value: unknown): value is string {
  return typeof value === "string" && MODEL.test(value);
}

/**
 * Keeps only a model and an effort that are safe to run; anything else is
 * dropped, so the review runs on the default instead of failing. A model the
 * app has not listed is kept: this account may well have it, and Claude says
 * so better than a guess here (the runner turns "model_not_found" into a
 * message).
 */
export function parseModelChoice(value: unknown): ModelChoice {
  const v = (value ?? {}) as Record<string, unknown>;
  const choice: ModelChoice = {};
  if (isModelValue(v.model)) choice.model = v.model;
  const effort = toReviewEffort(v.effort);
  if (effort) choice.effort = effort;
  return choice;
}

/** The effort levels a model offers, in order (empty: it has none). */
export function effortsFor(models: ClaudeModelOption[], model: string | undefined): ReviewEffort[] {
  // Claude Code's default: every level (which one it picks is its own).
  if (!model) return [...REVIEW_EFFORTS];
  const found = models.find((m) => m.value === model || m.resolvedModel === model);
  // A model the list says nothing about: every level (Claude refuses what it
  // cannot do, and a hand-edited setting is not worth hiding the select for).
  if (!found) return [...REVIEW_EFFORTS];
  const levels = found.supportedEffortLevels;
  if (levels?.length) return REVIEW_EFFORTS.filter((e) => levels.includes(e));
  // Listed with no levels: it has effort only if the row says so (older
  // models in the list carry neither field).
  return found.supportsEffort ? [...REVIEW_EFFORTS] : [];
}

/**
 * The choice with an effort the model actually offers: picking a model with
 * no effort levels, or fewer, drops or lowers the effort instead of sending
 * one Claude would refuse.
 */
export function clampChoice(models: ClaudeModelOption[], choice: ModelChoice): ModelChoice {
  if (!choice.effort) return choice;
  const levels = effortsFor(models, choice.model);
  if (levels.includes(choice.effort)) return choice;
  const { effort: _dropped, ...rest } = choice;
  const wanted = REVIEW_EFFORTS.indexOf(choice.effort);
  const below = levels.filter((e) => REVIEW_EFFORTS.indexOf(e) <= wanted).at(-1);
  return below ? { ...rest, effort: below } : rest;
}

/** "opus" → "Opus" for a model in the list; anything else as it is. */
export function modelLabel(models: ClaudeModelOption[], model: string): string {
  const found = model
    ? models.find((m) => m.value === model || m.resolvedModel === model)
    : undefined;
  return found?.displayName ?? model;
}

/** "Opus · high", "Opus", "high effort", or undefined for the default. */
export function choiceLabel(
  models: ClaudeModelOption[],
  choice: ModelChoice | undefined,
): string | undefined {
  if (!choice?.model && !choice?.effort) return undefined;
  const parts: string[] = [];
  if (choice.model) parts.push(modelLabel(models, choice.model));
  if (choice.effort) parts.push(choice.model ? choice.effort : `${choice.effort} effort`);
  return parts.join(" · ");
}
