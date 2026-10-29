import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { describeLines, type LineComment, type LineRange } from "../lib/comments.ts";
import { Markdown } from "./Markdown.tsx";
import { Button } from "./ui/button.tsx";

/**
 * What shows under one diff line: its comments, and maybe the form for a new
 * one. @pierre/diffs places it through a slot in the diff's shadow DOM, so it
 * would inherit the code's font and `white-space: pre`; the root resets them.
 */
export function CommentThread({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-w-3xl flex-col gap-2 px-3 py-2 font-sans text-sm leading-normal whitespace-normal text-foreground">
      {children}
    </div>
  );
}

export function CommentCard({
  comment,
  onEdit,
  onDelete,
}: {
  comment: LineComment;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <article className="rounded-md border border-border bg-card px-3 py-2 shadow-xs">
      <header className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {describeLines(comment)}
        </span>
        <div className="flex items-center gap-1">
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">Delete this comment?</span>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
              <Button size="xs" variant="destructive" onClick={() => onDelete(comment.id)}>
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onEdit(comment.id)}
                className="text-muted-foreground"
              >
                Edit
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setConfirming(true)}
                className="text-muted-foreground"
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </header>
      <Markdown value={comment.body} className="mt-1" />
    </article>
  );
}

/** A new comment, or an edit. ⌘/Ctrl+Enter saves, Esc cancels. */
export function CommentForm({
  range,
  value,
  onChange,
  onSave,
  onCancel,
  saveLabel,
  autoFocus = false,
}: {
  range: LineRange;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const canSave = value.trim() !== "";
  useEffect(() => {
    // The form opens under the line just clicked: no need to scroll to it.
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <form
      className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2 shadow-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave();
      }}
    >
      <label htmlFor={id} className="font-mono text-[0.7rem] text-muted-foreground">
        Comment on {describeLines(range)}
      </label>
      <textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSave) onSave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={3}
        placeholder="Leave a comment (Markdown)"
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          {saveLabel}
        </Button>
      </div>
    </form>
  );
}
