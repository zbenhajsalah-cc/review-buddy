/**
 * The model and effort pickers (US-22). Two of them show the same component:
 * Settings, where the choice is the default for every review, and the PR
 * list, where it overrides that default for the reviews started from there.
 *
 * The model list comes from main, which asked the installed Claude Code what
 * this account may use; when it could not be asked, the list is a small
 * fallback and `fallback` says so. The effort levels follow the chosen model.
 */
import { cn, Label } from "@review-buddy/viewer/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  ClaudeBridge,
  ClaudeModelCatalog,
  ClaudeModelOption,
  ModelChoice,
} from "../../shared/ipc.ts";
import { clampChoice, DEFAULT_VALUE, effortsFor, toReviewEffort } from "../../shared/models.ts";

/** How an effort level reads in the pickers. */
export const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high",
  max: "Maximum",
};

const SELECT_CLASS =
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * The model list and the default choice, from main. The default is read at
 * once (it is just a settings read); the list is asked for by the first
 * screen that shows a picker (`ensure`), because asking it starts a `claude`
 * process. `setChoice` saves the default; `reload` asks Claude Code again.
 */
export function useModels(bridge: ClaudeBridge) {
  const [catalog, setCatalog] = useState<ClaudeModelCatalog | null>(null);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const load = useCallback(
    (refresh?: boolean) => {
      asked.current = true;
      setBusy(true);
      void bridge
        .models(refresh)
        .then(setCatalog, () => {})
        .finally(() => setBusy(false));
    },
    [bridge],
  );

  useEffect(() => {
    bridge.choice().then(setChoice, () => {});
  }, [bridge]);

  /** Saves the default; main answers with what it kept. */
  const save = useCallback(
    (next: ModelChoice) => {
      setChoice(next); // the pickers follow at once; main may clamp it
      void bridge.setChoice(next).then(setChoice, () => {});
    },
    [bridge],
  );

  return {
    models: catalog?.models ?? [],
    /** Which model Claude Code's default is, when it said so. */
    defaultModel: catalog?.defaultModel,
    fallback: catalog?.fallback ?? false,
    fallbackError: catalog?.error,
    loading: catalog === null,
    busy,
    /** Asks for the list the first time a picker is shown. */
    ensure: useCallback(() => {
      if (!asked.current) load();
    }, [load]),
    reload: () => load(true),
    choice: choice ?? {},
    setChoice: save,
  };
}

/**
 * The two selects. `defaultModelLabel` is what the first option says — in
 * Settings "Claude Code's default", in the PR list the app's default.
 */
export function ModelChoiceFields({
  models,
  value,
  onChange,
  defaultModelLabel = "Claude Code's default",
  defaultEffortLabel = "Default",
  disabled,
  className,
  labels = true,
}: {
  models: ClaudeModelOption[];
  value: ModelChoice;
  onChange: (choice: ModelChoice) => void;
  defaultModelLabel?: string;
  defaultEffortLabel?: string;
  disabled?: boolean;
  className?: string;
  /** false: the selects name themselves (aria-label only), for a tight row. */
  labels?: boolean;
}) {
  const modelId = useId();
  const effortId = useId();
  const efforts = effortsFor(models, value.model);
  // A model with no effort levels: the effort select would do nothing.
  const effortDisabled = disabled || efforts.length === 0;

  const pickModel = (model: string) => {
    // Keep the effort inside what the new model offers.
    onChange(clampChoice(models, { ...value, model: model === DEFAULT_VALUE ? undefined : model }));
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {labels ? (
          <Label htmlFor={modelId} className="font-normal text-muted-foreground">
            Model
          </Label>
        ) : null}
        <select
          id={modelId}
          aria-label="Model"
          className={SELECT_CLASS}
          disabled={disabled}
          value={value.model ?? DEFAULT_VALUE}
          onChange={(e) => pickModel(e.target.value)}
        >
          <option value={DEFAULT_VALUE}>{defaultModelLabel}</option>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
          {/* A model from the settings file that the list does not have. */}
          {value.model && !models.some((m) => m.value === value.model) ? (
            <option value={value.model}>{value.model}</option>
          ) : null}
        </select>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {labels ? (
          <Label htmlFor={effortId} className="font-normal text-muted-foreground">
            Thinking
          </Label>
        ) : null}
        <select
          id={effortId}
          aria-label="Thinking effort"
          className={SELECT_CLASS}
          disabled={effortDisabled}
          title={efforts.length === 0 ? "This model has no effort levels." : undefined}
          value={value.effort ?? DEFAULT_VALUE}
          onChange={(e) =>
            onChange({ ...value, effort: toReviewEffort(e.target.value) ?? undefined })
          }
        >
          <option value={DEFAULT_VALUE}>{defaultEffortLabel}</option>
          {efforts.map((e) => (
            <option key={e} value={e}>
              {EFFORT_LABELS[e] ?? e}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
