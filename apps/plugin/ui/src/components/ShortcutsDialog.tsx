import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import {
  SHORTCUTS,
  type Shortcut,
  type ShortcutId,
  type ShortcutsSurface,
  shortcutsForSurface,
} from "../lib/shortcuts.ts";

export type { ShortcutsSurface };

const GROUP_ORDER = ["Navigation", "Files", "Review", "General"] as const;

type Group = (typeof GROUP_ORDER)[number];

function groupShortcuts(
  ids: ReadonlySet<ShortcutId>,
): Map<Group, { id: ShortcutId; shortcut: Shortcut }[]> {
  const map = new Map<Group, { id: ShortcutId; shortcut: Shortcut }[]>();
  for (const group of GROUP_ORDER) map.set(group, []);
  for (const id of ids) {
    const shortcut = SHORTCUTS[id];
    map.get(shortcut.group)?.push({ id, shortcut });
  }
  return map;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
  surface,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: ShortcutsSurface;
}) {
  const grouped = groupShortcuts(new Set(shortcutsForSurface(surface).map(({ id }) => id)));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border bg-card p-5 shadow-lg",
            "focus:outline-none",
          )}
        >
          <DialogPrimitive.Title className="text-base font-semibold">
            Keyboard shortcuts
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Available keyboard shortcuts for the review viewer.
          </DialogPrimitive.Description>

          <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto">
            {GROUP_ORDER.map((group) => {
              const items = grouped.get(group) ?? [];
              if (items.length === 0) return null;
              return (
                <section key={group}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </h3>
                  <ul className="space-y-1">
                    {items.map(({ id, shortcut: s }) => (
                      <li
                        key={id}
                        className="flex items-center justify-between gap-3 py-0.5 text-sm"
                      >
                        <span className="text-foreground">{s.description}</span>
                        <kbd
                          className={cn(
                            "shrink-0 rounded border border-border bg-muted px-1.5 py-0.5",
                            "font-mono text-xs text-muted-foreground",
                          )}
                        >
                          {s.label}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
