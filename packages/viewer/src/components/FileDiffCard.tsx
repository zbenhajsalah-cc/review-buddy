import type { DiffLineAnnotation, FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";
import type { DisplaySettings, ResolvedFile } from "@review-buddy/core/types";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type CommentSide,
  chapterDiffSpans,
  fullDiffSpans,
  type LineComment,
  type LineRange,
  positionKey,
  rangeFromSelection,
  toAnnotationSide,
} from "../lib/comments.ts";
import { buildExpandedDiff, canExpand, requiredSides } from "../lib/expand.ts";
import { fileToPatch } from "../lib/patch.ts";
import { cn } from "../lib/utils.ts";
import { useReviewApi } from "../review-api.tsx";
import { toDiffOptions } from "../settings.ts";
import { DiffStat } from "./DiffStat.tsx";
import { CommentCard, CommentForm, CommentThread } from "./LineComments.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card, CardContent } from "./ui/card.tsx";
import { Label } from "./ui/label.tsx";
import { Switch } from "./ui/switch.tsx";

type Draft = { range: LineRange; text: string };

const NO_COMMENTS: readonly LineComment[] = [];

/** The annotation for a positionKey ("new:12"); its metadata is the key. */
function annotationAt(key: string): DiffLineAnnotation<string> {
  const [side, line] = key.split(":");
  return {
    side: toAnnotationSide(side as CommentSide),
    lineNumber: Number(line),
    metadata: key,
  };
}

const CHANGE_LABEL: Record<ResolvedFile["change_type"], string> = {
  added: "added",
  deleted: "deleted",
  modified: "modified",
  renamed: "renamed",
};

// Memoized on purpose: ChapterReview mounts one card per file and re-renders on
// every filter keystroke / viewed toggle. Without memo, one keystroke re-renders
// every card (and re-queues worker highlights). memo only works while its props
// stay referentially stable — in particular `onViewedChange` and `onSetCollapsed`
// must be passed as stable callbacks (they take the path so the parent can hand
// over `handleViewedChange` / `setCollapsed` directly rather than allocating a
// per-render arrow). Do not re-wrap them in closures. The same goes for the
// comment callbacks.
export const FileDiffCard = memo(function FileDiffCard({
  file,
  settings,
  viewed,
  collapsed,
  focused = false,
  comments = NO_COMMENTS,
  onViewedChange,
  onSetCollapsed,
  onAddComment,
  onEditComment,
  onDeleteComment,
}: {
  file: ResolvedFile;
  settings: DisplaySettings;
  viewed: boolean;
  collapsed: boolean;
  focused?: boolean;
  /** This file's comments in this chapter. */
  comments?: readonly LineComment[];
  onViewedChange: (path: string, checked: boolean) => void;
  onSetCollapsed: (path: string, value: boolean) => void;
  onAddComment: (path: string, range: LineRange, body: string) => void;
  onEditComment: (id: string, body: string) => void;
  onDeleteComment: (id: string) => void;
}) {
  const api = useReviewApi();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState<FileDiffMetadata | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandNotice, setExpandNotice] = useState<string | null>(null);
  const viewedId = useId();
  // Once mounted, hide — don't unmount — on collapse (unmount re-queues worker
  // highlights on re-expand). Initial-collapsed cards stay unmounted until first expand.
  const bodyMounted = useRef(!collapsed);
  if (!collapsed) bodyMounted.current = true;

  // Line comments. The open forms and their text live here, not in the forms:
  // @pierre/diffs keys the annotation slots by index, so a form remounts when
  // a comment is added above it.
  const [selection, setSelection] = useState<SelectedLineRange | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); // by positionKey
  const [edits, setEdits] = useState<Record<string, string>>({}); // by comment id
  // The form just opened: it takes the focus once.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    if (focusKey !== null) setFocusKey(null);
  }, [focusKey]);

  // The gutter "+" reports its lines, then selects them. The form names its
  // lines, and a selection would pin the "+" to them: the reviewer could not
  // open a comment on another line. So that selection is dropped.
  const dropSelection = useRef(false);
  // The diff shown, to order a range across sides: the chapter's hunks, or in
  // the full-file view the whole file's changes (also the ones other chapters
  // show). A ref, so the diff options stay the same.
  const spans = useMemo(
    () => (expanded && expandedDiff ? fullDiffSpans(expandedDiff) : chapterDiffSpans(file.hunks)),
    [expanded, expandedDiff, file.hunks],
  );
  const spansRef = useRef(spans);
  spansRef.current = spans;
  const openDraft = useCallback((picked: SelectedLineRange) => {
    const range = rangeFromSelection(picked, spansRef.current);
    const key = positionKey(range);
    setDrafts((prev) => ({ ...prev, [key]: { range, text: prev[key]?.text ?? "" } }));
    setSelection(null);
    dropSelection.current = true;
    setFocusKey(`draft:${key}`);
  }, []);
  const onLineSelected = useCallback((range: SelectedLineRange | null) => {
    setSelection(dropSelection.current ? null : range);
    dropSelection.current = false;
  }, []);
  const closeDraft = (key: string) => setDrafts(({ [key]: _, ...rest }) => rest);
  const closeEdit = (id: string) => setEdits(({ [id]: _, ...rest }) => rest);

  const patch = useMemo(() => fileToPatch(file), [file]);
  const options = useMemo(
    () => ({
      ...toDiffOptions<string>(settings),
      // The gutter "+" opens a comment on its line, or on the lines dragged
      // over; line numbers select lines (shift-click: a range) for it.
      enableGutterUtility: true,
      enableLineSelection: true,
      onGutterUtilityClick: openDraft,
      onLineSelectionStart: setSelection,
      onLineSelectionChange: setSelection,
      onLineSelected,
    }),
    [settings, openDraft, onLineSelected],
  );
  const expandedOptions = useMemo(() => ({ ...options, expandUnchanged: true }), [options]);

  const commentsAt = useMemo(() => {
    const at = new Map<string, LineComment[]>();
    for (const c of comments) {
      const key = positionKey(c);
      at.set(key, [...(at.get(key) ?? []), c]);
    }
    return at;
  }, [comments]);
  // A new annotation array makes @pierre/diffs render the whole file again, so
  // it changes only when the lines with something under them change — not
  // when a comment is edited or a form typed in.
  const positions = [...new Set([...commentsAt.keys(), ...Object.keys(drafts)])].sort().join(" ");
  const lineAnnotations = useMemo(
    () => (positions === "" ? [] : positions.split(" ").map(annotationAt)),
    [positions],
  );

  const renderAnnotation = ({ metadata: key }: DiffLineAnnotation<string>) => {
    const draft = drafts[key];
    return (
      // Keyed by line, so a slot that moves to another line gets a new thread.
      <CommentThread key={key}>
        {commentsAt.get(key)?.map((c) => {
          const edit = edits[c.id];
          return (
            <div key={c.id} data-comment-id={c.id}>
              {edit === undefined ? (
                <CommentCard
                  comment={c}
                  onEdit={() => {
                    setEdits((prev) => ({ ...prev, [c.id]: c.body }));
                    setFocusKey(`edit:${c.id}`);
                  }}
                  onDelete={() => {
                    onDeleteComment(c.id);
                    closeEdit(c.id);
                  }}
                />
              ) : (
                <CommentForm
                  range={c}
                  value={edit}
                  onChange={(text) => setEdits((prev) => ({ ...prev, [c.id]: text }))}
                  onSave={() => {
                    onEditComment(c.id, edit.trim());
                    closeEdit(c.id);
                  }}
                  onCancel={() => closeEdit(c.id)}
                  saveLabel="Save"
                  autoFocus={focusKey === `edit:${c.id}`}
                />
              )}
            </div>
          );
        })}
        {draft && (
          <CommentForm
            range={draft.range}
            value={draft.text}
            onChange={(text) => setDrafts((prev) => ({ ...prev, [key]: { ...draft, text } }))}
            onSave={() => {
              onAddComment(file.path, draft.range, draft.text.trim());
              closeDraft(key);
            }}
            onCancel={() => closeDraft(key)}
            saveLabel="Comment"
            autoFocus={focusKey === `draft:${key}`}
          />
        )}
      </CommentThread>
    );
  };

  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(file.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const toggleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (expandedDiff) {
      setExpanded(true);
      return;
    }
    setExpandNotice(null);
    setExpandLoading(true);
    try {
      const req = requiredSides(file.change_type);
      // A required side that 200s with content === "" is handled below by
      // canExpand (the plan-008 "unavailable" contract). A required side that
      // REJECTS (non-2xx / network — e.g. a rename whose old_path isn't
      // allowlisted) propagates to the catch and surfaces the error string,
      // per plan 015 Step 3. Either way we never render an empty file as content.
      const [base, head] = await Promise.all([
        req.base
          ? api.getFileContent(file.old_path ?? file.path, "base").then((r) => r.content)
          : Promise.resolve(""),
        req.head
          ? api.getFileContent(file.path, "head").then((r) => r.content)
          : Promise.resolve(""),
      ]);
      if (!canExpand(file, base, head)) {
        setExpandNotice("Full file unavailable (not on disk for this review).");
        return;
      }
      setExpandedDiff(buildExpandedDiff(file, base, head));
      setExpanded(true);
    } catch (e) {
      setExpandNotice(`Full file unavailable — ${String(e)}`);
    } finally {
      setExpandLoading(false);
    }
  };

  return (
    <Card
      data-focused={focused || undefined}
      className={cn(
        // overflow-clip, not -hidden: hidden makes the card a scroll container,
        // and the sticky header would stick inside it (that is, never).
        "gap-0 overflow-clip py-0",
        viewed && "opacity-60",
        focused && "ring-2 ring-primary ring-offset-1",
      )}
    >
      {/* File header: stays at the top of the diff pane while the file scrolls
          under it, so a long file keeps its name and controls in view. */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-secondary px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onSetCollapsed(file.path, !collapsed)}
            className="shrink-0 font-mono text-xs text-muted-foreground"
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand file" : "Collapse file"}
          >
            {collapsed ? "▸" : "▾"}
          </Button>
          <span className="truncate font-mono text-[0.78rem]" title={file.path}>
            {file.old_path ? `${file.old_path} → ${file.path}` : file.path}
          </span>
          <Badge
            variant="outline"
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.06em]"
          >
            {CHANGE_LABEL[file.change_type]}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <DiffStat additions={file.additions} deletions={file.deletions} />
          <Button variant="ghost" size="xs" onClick={copyName} className="text-muted-foreground">
            {copied ? "copied!" : "copy path"}
          </Button>
          {!file.binary && (
            <Button
              variant="ghost"
              size="xs"
              onClick={toggleExpand}
              disabled={expandLoading}
              className="text-muted-foreground"
            >
              {expandLoading ? "expanding…" : expanded ? "collapse to diff" : "expand"}
            </Button>
          )}
          <div className="flex items-center gap-1">
            <Switch
              id={viewedId}
              size="sm"
              checked={viewed}
              onCheckedChange={(checked) => onViewedChange(file.path, checked)}
            />
            <Label
              htmlFor={viewedId}
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              viewed
            </Label>
          </div>
        </div>
      </header>

      {bodyMounted.current && (
        <div hidden={collapsed}>
          {file.binary ? (
            <CardContent className="p-4 text-sm text-muted-foreground">
              Binary file — content not shown.
            </CardContent>
          ) : (
            <>
              {expandNotice && (
                <p className="px-3 py-2 text-xs text-muted-foreground">{expandNotice}</p>
              )}
              <div className="overflow-x-auto text-[13px]">
                {expanded && expandedDiff ? (
                  <FileDiff
                    fileDiff={expandedDiff}
                    options={expandedOptions}
                    lineAnnotations={lineAnnotations}
                    renderAnnotation={renderAnnotation}
                    selectedLines={selection}
                  />
                ) : (
                  <PatchDiff
                    patch={patch}
                    options={options}
                    lineAnnotations={lineAnnotations}
                    renderAnnotation={renderAnnotation}
                    selectedLines={selection}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
});
