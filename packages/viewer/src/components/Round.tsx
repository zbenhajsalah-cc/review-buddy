import type { RoundInfo } from "@review-buddy/core/types";
import { MANY_ROUNDS } from "../lib/rounds.ts";
import { Badge } from "./ui/badge.tsx";

/** "Round 2": this is a re-review of a change the reviewer asked to fix. */
export function RoundBadge({ round }: { round: number }) {
  return (
    <Badge
      variant="outline"
      className="rounded-full border-primary/40 px-2 py-0.5 text-[0.68rem] font-semibold text-primary"
      title={`Re-review: you asked for changes ${round - 1} time${round === 2 ? "" : "s"} already`}
    >
      Round {round}
    </Badge>
  );
}

/**
 * The Overview's line about this round: what changed since the last one, what
 * became of the reviewer's comments, and — after many rounds — a nudge to
 * talk about the approach instead of asking for another round.
 *
 * Words matter: "lines changed", never "fixed". The tool can see that lines
 * changed; only the reviewer can say a comment was handled.
 */
export function RoundSummary({ round }: { round: RoundInfo }) {
  const last = round.number - 1;
  const changed = round.changedPaths.length;
  const comments = round.previousComments.length;
  const linesChanged = round.previousComments.filter((c) => c.status === "lines_changed").length;
  const hidden = round.hiddenFindings ?? 0;
  return (
    <section
      aria-labelledby="rb-round"
      className="mb-6 rounded-xl border border-border border-l-[3px] border-l-primary bg-card px-4 py-3.5"
    >
      <h2
        id="rb-round"
        className="mb-1.5 font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-muted-foreground"
      >
        Round {round.number}
      </h2>
      <p className="text-sm">
        {changed === 0
          ? `No file changed since round ${last}.`
          : `${changed} file${changed === 1 ? "" : "s"} changed since round ${last}.`}{" "}
        {round.viewedPaths.length > 0 &&
          `The ${round.viewedPaths.length === 1 ? "file" : `${round.viewedPaths.length} files`} you viewed and the agent did not touch ${round.viewedPaths.length === 1 ? "is" : "are"} still marked viewed.`}
      </p>
      {comments > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          Your {comments === 1 ? "comment" : `${comments} comments`} from round {last}:{" "}
          {linesChanged > 0 && `${linesChanged} on lines that changed since`}
          {linesChanged > 0 && linesChanged < comments && ", "}
          {linesChanged < comments && `${comments - linesChanged} on lines that did not change`}.{" "}
          They are listed in each chapter's sidebar.
        </p>
      )}
      {hidden > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {hidden === 1
            ? "1 finding you dismissed in an earlier round is not shown again."
            : `${hidden} findings you dismissed in an earlier round are not shown again.`}
        </p>
      )}
      {round.number >= MANY_ROUNDS && (
        <p
          role="note"
          className="mt-2.5 rounded-md border border-rb-focus-border bg-rb-focus-bg px-3 py-2 text-sm text-rb-focus-fg"
        >
          This is round {round.number}. Consider talking to the author about the approach instead of
          another round.
        </p>
      )}
    </section>
  );
}
