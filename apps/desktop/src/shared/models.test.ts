import { describe, expect, test } from "bun:test";
import type { ClaudeModelOption } from "./ipc.ts";
import {
  choiceLabel,
  clampChoice,
  effortsFor,
  FALLBACK_MODELS,
  isModelValue,
  modelLabel,
  parseModelChoice,
} from "./models.ts";

const MODELS: ClaudeModelOption[] = [
  {
    value: "opus",
    displayName: "Opus",
    resolvedModel: "claude-opus-5",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  { value: "haiku", displayName: "Haiku", supportsEffort: false },
  // An older model, listed with neither field (as Claude Code lists them).
  { value: "claude-haiku-4-5", displayName: "Haiku 4.5" },
];

describe("isModelValue", () => {
  test("takes aliases and model ids", () => {
    expect(isModelValue("opus")).toBe(true);
    expect(isModelValue("claude-opus-5")).toBe(true);
    expect(isModelValue("sonnet[1m]")).toBe(true);
  });

  test("refuses anything that is not a model name", () => {
    for (const value of [
      "",
      " opus",
      "--dangerously-skip-permissions",
      "opus; rm -rf /",
      "../../etc/passwd",
      "a".repeat(80),
      42,
      null,
      {},
    ]) {
      expect(isModelValue(value)).toBe(false);
    }
  });
});

describe("parseModelChoice", () => {
  test("keeps a model and an effort", () => {
    expect(parseModelChoice({ model: "opus", effort: "high" })).toEqual({
      model: "opus",
      effort: "high",
    });
  });

  test("drops anything else, including other fields of the payload", () => {
    expect(parseModelChoice({ model: "opus; ls", effort: "turbo", fresh: true })).toEqual({});
    expect(parseModelChoice(undefined)).toEqual({});
    expect(parseModelChoice("opus")).toEqual({});
  });

  test("keeps a model the app has not listed (Claude says whether it exists)", () => {
    expect(parseModelChoice({ model: "claude-something-new" })).toEqual({
      model: "claude-something-new",
    });
  });
});

describe("effortsFor", () => {
  test("only what the model offers", () => {
    expect(effortsFor(MODELS, "sonnet")).toEqual(["low", "medium", "high"]);
    expect(effortsFor(MODELS, "haiku")).toEqual([]);
  });

  test("a full id matches its alias row", () => {
    expect(effortsFor(MODELS, "claude-opus-5")).toHaveLength(5);
  });

  test("a listed model with neither field has none", () => {
    expect(effortsFor(MODELS, "claude-haiku-4-5")).toEqual([]);
  });

  test("the default, or an unlisted model: every level", () => {
    expect(effortsFor(MODELS, undefined)).toHaveLength(5);
    expect(effortsFor(MODELS, "claude-something-new")).toHaveLength(5);
  });
});

describe("clampChoice", () => {
  test("keeps an effort the model has", () => {
    expect(clampChoice(MODELS, { model: "sonnet", effort: "high" })).toEqual({
      model: "sonnet",
      effort: "high",
    });
  });

  test("lowers one it does not have to the nearest below", () => {
    expect(clampChoice(MODELS, { model: "sonnet", effort: "max" })).toEqual({
      model: "sonnet",
      effort: "high",
    });
  });

  test("drops the effort for a model with no levels", () => {
    expect(clampChoice(MODELS, { model: "haiku", effort: "high" })).toEqual({ model: "haiku" });
  });

  test("leaves a choice with no effort alone", () => {
    expect(clampChoice(MODELS, { model: "haiku" })).toEqual({ model: "haiku" });
    expect(clampChoice(MODELS, {})).toEqual({});
  });
});

describe("labels", () => {
  test("a model reads by its display name, a full id by its alias row's", () => {
    expect(modelLabel(MODELS, "opus")).toBe("Opus");
    expect(modelLabel(MODELS, "claude-opus-5")).toBe("Opus");
    expect(modelLabel(MODELS, "claude-something-new")).toBe("claude-something-new");
  });

  test("the choice reads as the model and the effort", () => {
    expect(choiceLabel(MODELS, { model: "opus", effort: "max" })).toBe("Opus · max");
    expect(choiceLabel(MODELS, { model: "opus" })).toBe("Opus");
    expect(choiceLabel(MODELS, { effort: "high" })).toBe("high effort");
    expect(choiceLabel(MODELS, {})).toBeUndefined();
    expect(choiceLabel(MODELS, undefined)).toBeUndefined();
  });
});

test("the fallback models all offer the effort levels", () => {
  for (const model of FALLBACK_MODELS) {
    expect(effortsFor(FALLBACK_MODELS, model.value)).toHaveLength(5);
  }
});
