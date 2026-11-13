import {
  endLines,
  type MoveMark,
  markId,
  markSameness,
  markVerb,
  otherSide,
} from "../lib/moves.ts";
import { Button } from "./ui/button.tsx";

/**
 * Under the last line of a moved block: says the lines above were moved,
 * whether they are identical, where the other end is, and jumps there. The tool found the move in
 * the real diff; the note has line numbers only, never code.
 */
export function MoveNote({ mark, onOpen }: { mark: MoveMark; onOpen?: (mark: MoveMark) => void }) {
  const here = mark.move[mark.side];
  const there = mark.move[otherSide(mark.side)];
  const sameFile = here.path === there.path;
  return (
    <aside
      data-move-id={markId(mark)}
      aria-label="Moved code"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-dashed border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span>
        <span aria-hidden>↑ </span>
        {markVerb(mark)}{" "}
        {sameFile ? (
          <>{endLines(there)} of this file</>
        ) : (
          <>
            <span className="font-mono text-foreground">{there.path}</span> ({endLines(there)})
          </>
        )}{" "}
        —{" "}
        <span className={mark.move.whitespaceChanged ? "font-medium text-risk-medium" : undefined}>
          {markSameness(mark.move)}
        </span>
      </span>
      {onOpen && (
        <Button
          variant="link"
          size="sm"
          onClick={() => onOpen(mark)}
          className="ml-auto h-auto p-0 text-xs"
        >
          {mark.side === "to" ? "Show where it was" : "Show where it is now"}
        </Button>
      )}
    </aside>
  );
}
