import { useEffect, useRef } from "react";

export type ShortcutsSurface = "overview" | "chapter";

export interface Shortcut {
  /** The `KeyboardEvent.key` value(s) that trigger it. */
  keys: readonly string[];
  /** Shown in the dialog, e.g. "j" or "→". */
  label: string;
  description: string;
  group: "Navigation" | "Files" | "Review" | "General";
  /** Surfaces whose shortcut dialog lists this binding. */
  surfaces: readonly ShortcutsSurface[];
}

export const SHORTCUTS = {
  SHOW_SHORTCUTS: {
    keys: ["?"],
    label: "?",
    description: "Show keyboard shortcuts",
    group: "General",
    surfaces: ["overview", "chapter"],
  },
  NEXT_CHAPTER: {
    keys: ["ArrowRight"],
    label: "→",
    description: "Next chapter",
    group: "Navigation",
    surfaces: ["chapter"],
  },
  PREV_CHAPTER: {
    keys: ["ArrowLeft"],
    label: "←",
    description: "Previous chapter",
    group: "Navigation",
    surfaces: ["chapter"],
  },
  BACK_TO_OVERVIEW: {
    keys: ["Escape"],
    label: "Esc",
    description: "Clear file focus, or back to overview",
    group: "Navigation",
    surfaces: ["chapter"],
  },
  NEXT_FILE: {
    keys: ["j"],
    label: "j",
    description: "Next file",
    group: "Files",
    surfaces: ["chapter"],
  },
  PREV_FILE: {
    keys: ["k"],
    label: "k",
    description: "Previous file",
    group: "Files",
    surfaces: ["chapter"],
  },
  TOGGLE_COLLAPSED: {
    keys: [";"],
    label: ";",
    description: "Collapse/expand the focused file",
    group: "Files",
    surfaces: ["chapter"],
  },
  TOGGLE_ALL_COLLAPSED: {
    keys: [":"],
    label: "⇧ ;",
    description: "Collapse/expand all files",
    group: "Files",
    surfaces: ["chapter"],
  },
  TOGGLE_VIEWED: {
    keys: ["v"],
    label: "v",
    description: "Mark the focused file viewed",
    group: "Files",
    surfaces: ["chapter"],
  },
  BEGIN_REVIEW: {
    keys: ["Enter"],
    label: "↵",
    description: "Begin review (overview only)",
    group: "Review",
    surfaces: ["overview"],
  },
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** Catalog entries listed on `surface`, in catalog declaration order. */
export function shortcutsForSurface(
  surface: ShortcutsSurface,
): { id: ShortcutId; shortcut: (typeof SHORTCUTS)[ShortcutId] }[] {
  const out: { id: ShortcutId; shortcut: (typeof SHORTCUTS)[ShortcutId] }[] = [];
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    if (SHORTCUTS[id].surfaces.some((s) => s === surface)) {
      out.push({ id, shortcut: SHORTCUTS[id] });
    }
  }
  return out;
}

function isShortcutId(id: string): id is ShortcutId {
  return Object.hasOwn(SHORTCUTS, id);
}

/** True when the event target is a field the user is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest("[contenteditable]") !== null;
}

/**
 * True when Enter/Space should activate the focused control, not the page
 * shortcut — the key belongs to that control.
 */
function isNativeActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("button, a[href], summary, [role='button'], [role='link']") !== null;
}

export type ShortcutHandler = {
  handler: () => void;
  /** Per-binding gate; defaults to true. */
  enabled?: boolean;
};

/**
 * Register a single document-level keydown listener for a table of bindings
 * keyed by catalog id. Resolves each id to `SHORTCUTS[id].keys` so call sites
 * never restate keys. Ignores modifier combos and typing targets so
 * filter/verdict inputs keep their normal key behavior. Bindings are kept in
 * a ref so callers can pass an inline record (and unmemoized handlers) without
 * re-registering. Catalog ids own disjoint key sets; first match wins;
 * nothing matched ⇒ no preventDefault. Entries with `enabled: false` are skipped.
 */
export function useShortcuts(
  bindings: Partial<Record<ShortcutId, ShortcutHandler>>,
  enabled: boolean = true,
): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if ((event.key === "Enter" || event.key === " ") && isNativeActivationTarget(event.target)) {
        return;
      }
      for (const id of Object.keys(bindingsRef.current)) {
        if (!isShortcutId(id)) continue;
        const binding = bindingsRef.current[id];
        if (!binding || binding.enabled === false) continue;
        if (!SHORTCUTS[id].keys.some((k) => k === event.key)) continue;
        event.preventDefault();
        binding.handler();
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
