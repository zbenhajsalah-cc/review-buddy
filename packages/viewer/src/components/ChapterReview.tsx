import type { ResolvedChapter, ResolvedFinding, ResolvedReview } from "@review-buddy/core/types";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { codeFontStyle } from "../appearance.ts";
import {
  clearReviewFileState,
  readViewedEntries,
  useCollapsedFiles,
  useViewedFiles,
} from "../lib/chapterFileSet.ts";
import {
  commentsToMarkdown,
  describeLines,
  type LineComment,
  type LineRange,
  sortComments,
  toReviewComments,
  useComments,
} from "../lib/comments.ts";
import {
  answersById,
  answersToSend,
  chapterFindings,
  DECISION_LABEL,
  findingLines,
  openFindings,
  useFindingAnswers,
} from "../lib/findings.ts";
import { keepFileInView, keepInView } from "../lib/keepFileInView.ts";
import { reviewProgress } from "../lib/progress.ts";
import { chapterToMarkdown } from "../lib/reviewMarkdown.ts";
import { useChapterShortcuts } from "../lib/useChapterShortcuts.ts";
import { useFileFocus } from "../lib/useFileFocus.ts";
import { usePersistedState } from "../lib/usePersistedState.ts";
import { cn } from "../lib/utils.ts";
import { type DoneResult, useReviewApi } from "../review-api.tsx";
import { useDisplaySettings } from "../settings.ts";
import { CopyMarkdownButton, type CopyMarkdownHandle } from "./CopyMarkdownButton.tsx";
import { DiffStat } from "./DiffStat.tsx";
import { DisplaySettingsBar } from "./DisplaySettingsBar.tsx";
import { FileDiffCard } from "./FileDiffCard.tsx";
import { SeverityTag } from "./Finding.tsx";
import { Markdown } from "./Markdown.tsx";
import { RiskBadge } from "./RiskBadge.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { Button } from "./ui/button.tsx";
import { Label } from "./ui/label.tsx";
import { Switch } from "./ui/switch.tsx";

export function ChapterReview({
  review,
  position,
  openFile,
  requestNote,
  onNavigate,
  onExit,
  markedDone,
  onMarkedDone,
  onSubmitted,
}: {
  review: ResolvedReview;
  position: number;
  /** Focus this file and scroll to it when the chapter opens (if it has it). */
  openFile?: string;
  /**
   * Open the request-changes note with this text (an open question the
   * reviewer raised from the overview). Shown only with round-trip on.
   */
  requestNote?: string;
  onNavigate: (position: number) => void;
  onExit: () => void;
  /**
   * afterDone "keep": the review was marked done. Kept by the parent, so it
   * outlives this chapter (back to the overview, another chapter).
   */
  markedDone?: boolean;
  onMarkedDone?: () => void;
  /** afterDone "close": the review was submitted; the parent may keep it. */
  onSubmitted?: () => void;
}) {
  const chapter = review.chapters[position];
  if (!chapter) {
    return <div className="p-10">No chapters to review.</div>;
  }
  return (
    <ChapterReviewBody
      review={review}
      position={position}
      openFile={openFile}
      requestNote={requestNote}
      onNavigate={onNavigate}
      onExit={onExit}
      chapter={chapter}
      markedDone={markedDone}
      onMarkedDone={onMarkedDone}
      onSubmitted={onSubmitted}
    />
  );
}

/** The plugin's end: the review was submitted and the agent goes on. */
export function ReviewSubmitted() {
  return (
    <div className="grid h-full place-items-center text-muted-foreground">
      Review submitted — you can close this tab.
    </div>
  );
}

function ChapterReviewBody({
  review,
  position,
  openFile,
  requestNote,
  onNavigate,
  onExit,
  chapter,
  markedDone: parentDone = false,
  onMarkedDone,
  onSubmitted,
}: {
  review: ResolvedReview;
  position: number;
  openFile?: string;
  requestNote?: string;
  onNavigate: (position: number) => void;
  onExit: () => void;
  chapter: ResolvedChapter;
  markedDone?: boolean;
  onMarkedDone?: () => void;
  onSubmitted?: () => void;
}) {
  const [settings, updateSettings] = useDisplaySettings();
  const chapters = review.chapters;
  const chapterIndex = chapter.index;
  const [viewed, setViewed] = useViewedFiles(chapterIndex);
  const [collapsed, setCollapsed] = useCollapsedFiles(chapterIndex);
  // Product rule: marking a file viewed collapses it (and unmarking expands it) —
  // kept here, not in the card, so the card stays pure presentation.
  const handleViewedChange = useCallback(
    (path: string, checked: boolean) => {
      setViewed(path, checked);
      setCollapsed(path, checked);
    },
    [setViewed, setCollapsed],
  );
  const api = useReviewApi();
  const [filter, setFilter] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Like the shortcuts dialog, the theme & font popover pauses shortcuts while
  // open, so keys pressed in it don't also act on files or chapters.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // afterDone "keep": done, but the review stays open (desktop).
  const [doneHere, setDoneHere] = useState(false);
  const markedDone = parentDone || doneHere;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [roundtrip, setRoundtrip] = useState(false);
  const [requesting, setRequesting] = useState(false); // textarea open
  const [summary, setSummary] = useState("");
  // Done with files not marked viewed, or with comments it would drop: the
  // counts, while the check is shown.
  const [unfinished, setUnfinished] = useState<{
    viewed: number;
    total: number;
    comments: number;
    /** Important findings, anywhere in the review, with no answer. */
    important: number;
  } | null>(null);
  // A preference, so a cookie: the plugin serves each review on a new port,
  // and localStorage is per port while cookies are per host.
  const [hideViewed, setHideViewed] = usePersistedState("rb.hideViewed", false, "cookie");
  const hideViewedId = useId();
  const {
    comments: allComments,
    add: addComment,
    edit: editComment,
    remove: removeComment,
  } = useComments();
  const chapterComments = useMemo(
    () => sortComments(allComments.filter((c) => c.chapterIndex === chapterIndex)),
    [allComments, chapterIndex],
  );
  const findings = useMemo(
    () => chapterFindings(review.findings, chapterIndex),
    [review.findings, chapterIndex],
  );
  const { answers, answer: answerFinding, clearAnswer } = useFindingAnswers();
  const answerOf = useMemo(() => answersById(answers), [answers]);
  // The chapter's findings with no answer, in the order they are listed: what
  // n / p walk through, and what Done asks about.
  const openHere = useMemo(() => openFindings(findings, answers), [findings, answers]);
  const findingsByPath = useMemo(() => {
    const byPath = new Map<string, ResolvedFinding[]>();
    for (const f of findings) byPath.set(f.path, [...(byPath.get(f.path) ?? []), f]);
    return byPath;
  }, [findings]);
  const commentsByPath = useMemo(() => {
    const byPath = new Map<string, LineComment[]>();
    for (const c of chapterComments) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);
    return byPath;
  }, [chapterComments]);
  const handleAddComment = useCallback(
    (path: string, range: LineRange, body: string) =>
      addComment({ ...range, chapterIndex, path, body }),
    [addComment, chapterIndex],
  );
  // A comment or finding opened from the sidebar list: its file, the selector
  // of its card, and the finding's id when it is one — `n` / `p` step from it,
  // and two findings' ids can share a prefix (`f-1234`, `f-1234-2`), so the
  // selector is no way to tell which one is open. A new object each time, so
  // opening the same one again scrolls to it again.
  const [opened, setOpened] = useState<{
    path: string;
    selector: string;
    findingId?: string;
  } | null>(null);
  const diffScrollRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<CopyMarkdownHandle>(null);

  const matching = filter
    ? chapter.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : chapter.files;
  // The file the focus link opened stays shown, viewed or not; so does the
  // file of the comment or finding opened from the list.
  const files = hideViewed
    ? matching.filter((f) => !viewed.has(f.path) || f.path === openFile || f.path === opened?.path)
    : matching;
  const filePaths = files.map((f) => f.path);
  const { focusedPath, focusedPathRef, focus, move } = useFileFocus(
    filePaths,
    chapter.files.map((f) => f.path),
  );
  const prev = chapters[position - 1];
  const next = chapters[position + 1];
  const shortcutsActive = !submitted && !shortcutsOpen && !appearanceOpen;
  const { font, fontSize, ligatures } = settings;
  const fontStyle = useMemo(
    () => codeFontStyle({ font, fontSize, ligatures }),
    [font, fontSize, ligatures],
  );

  // Round-trip (the verdict UI, and comments sent to the agent) comes from the app's config.
  useEffect(() => {
    api
      .getConfig()
      .then((c) => setRoundtrip(c.roundtrip))
      .catch(() => {});
  }, [api]);

  // A question raised from the overview starts the request-changes note, with
  // the caret after it once the note is shown (round-trip config is async).
  const focusNote = useRef(false);
  useEffect(() => {
    if (!requestNote) return;
    setUnfinished(null);
    setSummary(requestNote);
    setRequesting(true);
    focusNote.current = true;
  }, [requestNote]);
  const noteRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el || !focusNote.current) return;
    focusNote.current = false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll/filter when navigating chapters
  useEffect(() => {
    diffScrollRef.current?.scrollTo({ top: 0 });
    setFilter("");
    setOpened(null);
  }, [chapterIndex]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset focus when chapter or filter changes
  useEffect(() => {
    focus(null);
  }, [chapterIndex, filter]);

  const scrollToFile = (path: string) => {
    document
      .querySelector(`[data-file-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the chapter or the file to open changes
  useEffect(() => {
    const scroller = diffScrollRef.current;
    if (!openFile || !scroller || !chapter.files.some((f) => f.path === openFile)) return;
    focus(openFile);
    setCollapsed(openFile, false); // also when viewed: the link is there to show its diff
    return keepFileInView(scroller, openFile);
  }, [chapterIndex, openFile]);

  const openItem = (path: string, selector: string, findingId?: string) => {
    if (!matching.some((f) => f.path === path)) setFilter("");
    setOpened({ path, selector, findingId });
  };
  const openComment = (comment: LineComment) =>
    openItem(comment.path, `[data-comment-id="${CSS.escape(comment.id)}"]`);
  const openFinding = (finding: ResolvedFinding) =>
    openItem(finding.path, `[data-finding-id="${CSS.escape(finding.id)}"]`, finding.id);
  // After the filter reset above (its effect clears the focus), so the
  // comment's file keeps it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when an item is opened from the list
  useEffect(() => {
    const scroller = diffScrollRef.current;
    if (!opened || !scroller) return;
    focus(opened.path);
    setCollapsed(opened.path, false);
    return keepInView(scroller, opened.selector, "center");
  }, [opened]);

  // Collapse all files of the chapter (also ones the filter hides), or expand
  // all when none is open.
  const anyExpanded = chapter.files.some((f) => !collapsed.has(f.path));
  const toggleAllCollapsed = () => {
    for (const f of chapter.files) setCollapsed(f.path, anyExpanded);
  };

  // n / p: the next (or previous) finding with no answer, from the one last
  // opened. Only with round-trip, where "unanswered" means anything.
  const stepFinding = (delta: 1 | -1) => {
    if (openHere.length === 0) return;
    const at = openHere.findIndex((f) => f.id === opened?.findingId);
    const next = at === -1 ? (delta === 1 ? 0 : openHere.length - 1) : at + delta;
    const target = openHere[(next + openHere.length) % openHere.length];
    if (target) openFinding(target);
  };

  useChapterShortcuts({
    shortcutsActive,
    onShowShortcuts: () => setShortcutsOpen(true),
    onCopyMarkdown: () => copyRef.current?.copy(),
    hasOpenFindings: roundtrip && openHere.length > 0,
    onNextFinding: () => stepFinding(1),
    onPrevFinding: () => stepFinding(-1),
    hasNext: !!next,
    hasPrev: !!prev,
    onNextChapter: () => onNavigate(position + 1),
    onPrevChapter: () => onNavigate(position - 1),
    onExit,
    focusedPathRef,
    focus,
    move,
    scrollToFile,
    isCollapsed: (path) => collapsed.has(path),
    setCollapsed,
    onToggleAllCollapsed: toggleAllCollapsed,
    isViewed: (path) => viewed.has(path),
    onViewedChange: handleViewedChange,
  });

  const submit = async (result: DoneResult = {}) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.done(result);
      if (api.afterDone === "keep") {
        setDoneHere(true);
        onMarkedDone?.();
      } else {
        clearReviewFileState(api.reviewKey);
        setSubmitted(true);
        onSubmitted?.();
      }
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // With round-trip on, the comments and the answers to the findings go to the
  // agent with the verdict.
  const sentFeedback = () => {
    const sendable = answersToSend(review.findings, answers);
    return {
      ...(allComments.length > 0 ? { comments: toReviewComments(allComments) } : {}),
      ...(sendable.length > 0 ? { findings: sendable } : {}),
    };
  };
  const finish = () => {
    setUnfinished(null);
    void submit(roundtrip ? { verdict: "approve", ...sentFeedback() } : undefined);
  };
  // Done asks first while files are not marked viewed (over the whole review),
  // while an important finding has no answer, and when it would drop comments:
  // without round-trip, the plugin's Done ends the review and clears them
  // without sending them. It only asks — blocking a merge is the project's
  // policy, not ours.
  const done = () => {
    const progress = reviewProgress(chapters, readViewedEntries(api.reviewKey));
    const comments = api.afterDone === "keep" || roundtrip ? 0 : allComments.length;
    const important = roundtrip
      ? openFindings(review.findings, answers).filter((f) => f.severity === "important").length
      : 0;
    if (progress.viewed >= progress.total && comments === 0 && important === 0) return finish();
    setRequesting(false);
    setUnfinished({ ...progress, comments, important });
  };
  const requestChanges = () => submit({ verdict: "request_changes", summary, ...sentFeedback() });

  if (submitted) return <ReviewSubmitted />;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={onExit} className="text-muted-foreground">
          ← Overview
        </Button>
        <div className="flex items-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            onClick={() => prev && onNavigate(position - 1)}
            disabled={!prev}
            title="←"
          >
            ← Prev
          </Button>
          <span className="font-mono text-xs text-muted-foreground">
            Chapter {position + 1} of {chapters.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => next && onNavigate(position + 1)}
            disabled={!next}
            title="→"
          >
            Next →
          </Button>
        </div>
        <div className="relative flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <CopyMarkdownButton
              ref={copyRef}
              text={() => chapterToMarkdown(chapter, 2, chapterComments, findings, answers)}
              aria-label="Copy chapter as Markdown"
              title="Copy chapter as Markdown (c)"
              label="copy"
              variant="ghost"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShortcutsOpen(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
            >
              ?
            </Button>
            {roundtrip && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUnfinished(null);
                  setRequesting((v) => !v);
                }}
                disabled={submitting}
                className="text-[var(--color-risk-high)]"
              >
                Request changes
              </Button>
            )}
            <Button
              size="sm"
              onClick={done}
              disabled={submitting || markedDone}
              title={
                !roundtrip
                  ? undefined
                  : allComments.length > 0 || answers.length > 0
                    ? "Approve, and send your comments and answers to the agent"
                    : "Approve"
              }
            >
              {submitting ? "Submitting…" : markedDone ? "Done ✓" : "Done"}
            </Button>
          </div>
          {/* Floats over the diff pane, so asking does not move the page. */}
          {unfinished && (
            <div className="absolute top-full right-0 z-20 mt-1.5 flex w-72 flex-col gap-2 rounded-md border border-border bg-card p-2.5 text-sm shadow-md">
              <p>
                {unfinished.viewed < unfinished.total &&
                  `Viewed ${unfinished.viewed} of ${unfinished.total} file${unfinished.total === 1 ? "" : "s"}. `}
                {unfinished.important === 1 && "1 important finding has no answer. "}
                {unfinished.important > 1 &&
                  `${unfinished.important} important findings have no answer. `}
                {unfinished.comments === 1 && "Done does not send your comment, and clears it. "}
                {unfinished.comments > 1 &&
                  `Done does not send your ${unfinished.comments} comments, and clears them. `}
                Finish anyway?
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                {unfinished.comments > 0 && (
                  <CopyMarkdownButton
                    text={() => commentsToMarkdown(allComments)}
                    aria-label="Copy all comments as Markdown"
                    label={unfinished.comments === 1 ? "Copy comment" : "Copy comments"}
                    variant="outline"
                    size="sm"
                    className="mr-auto"
                  />
                )}
                <Button size="sm" variant="ghost" onClick={() => setUnfinished(null)}>
                  Keep reviewing
                </Button>
                <Button size="sm" onClick={finish} disabled={submitting}>
                  Finish anyway
                </Button>
              </div>
            </div>
          )}
          {roundtrip && requesting && (
            <div className="flex w-72 flex-col gap-1">
              <textarea
                ref={noteRef}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What should change?"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {allComments.length === 1 && "Your comment goes too."}
                  {allComments.length > 1 && `Your ${allComments.length} comments go too.`}
                  {answers.length > 0 &&
                    `${allComments.length > 0 ? " " : ""}Your answers to ${answers.length} finding${answers.length === 1 ? "" : "s"} go too.`}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={requestChanges}
                  disabled={submitting}
                >
                  Submit request
                </Button>
              </div>
            </div>
          )}
          {submitError && <p className="text-xs text-[var(--color-risk-high)]">{submitError}</p>}
        </div>
      </header>

      {/* Split pane */}
      <div className="flex min-h-0 flex-1">
        {/* Left context panel */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-card px-5 py-5">
          {/* The chapter spine: an oversized serif numeral beside the title,
              so a chapter reads as a chapter and not as a filter result. The
              "Chapter N of M" counter stays in the top bar, where it was. */}
          <div className="flex items-start gap-3">
            <span aria-hidden className="font-serif text-5xl leading-[0.85] text-muted-foreground">
              {chapter.index}
            </span>
            <h1 className="font-serif text-[1.65rem] font-normal leading-tight tracking-[-0.01em]">
              {chapter.title}
            </h1>
          </div>
          <div className="mt-3.5 mb-2 flex items-center gap-2">
            <RiskBadge risk={chapter.risk} />
            <DiffStat additions={chapter.additions} deletions={chapter.deletions} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Risk: </span>
            <Markdown value={chapter.risk_reason} variant="inline" className="inline" />
          </p>
          <div className="mt-3 text-sm">
            <Markdown value={chapter.description} />
          </div>

          <div className="mt-6 mb-2 flex items-center justify-between gap-2">
            <h2 className="font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
              {chapter.files.length} file{chapter.files.length === 1 ? "" : "s"}
            </h2>
            <Button
              variant="ghost"
              size="xs"
              onClick={toggleAllCollapsed}
              title="Collapse or expand all files (⇧ ;)"
              className="text-muted-foreground"
            >
              {anyExpanded ? "Collapse all" : "Expand all"}
            </Button>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs"
          />
          <div className="mb-2 flex items-center gap-1.5 px-0.5">
            <Switch
              id={hideViewedId}
              size="sm"
              checked={hideViewed}
              onCheckedChange={setHideViewed}
            />
            <Label
              htmlFor={hideViewedId}
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Hide viewed files
            </Label>
          </div>
          <ul className="space-y-0.5">
            {files.map((f) => {
              const slash = f.path.lastIndexOf("/");
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => {
                      focus(f.path);
                      scrollToFile(f.path);
                    }}
                    title={f.path}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-background"
                  >
                    {/* The name first, then its folder (cut first when space
                        runs out): two index.ts files must not look the same. */}
                    <span
                      className={cn(
                        "flex min-w-0 items-baseline gap-1.5 font-mono",
                        viewed.has(f.path) && "opacity-50",
                      )}
                    >
                      <span className="max-w-full shrink-0 truncate">
                        {viewed.has(f.path) ? "✓ " : ""}
                        {f.path.slice(slash + 1)}
                      </span>
                      {slash > 0 && (
                        <span className="min-w-0 truncate text-[0.68rem] text-muted-foreground">
                          {f.path.slice(0, slash)}
                        </span>
                      )}
                    </span>
                    <DiffStat additions={f.additions} deletions={f.deletions} />
                  </button>
                </li>
              );
            })}
          </ul>

          {findings.length > 0 && (
            <>
              <h2 className="mt-6 mb-2 font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                {findings.length} finding{findings.length === 1 ? "" : "s"}
                {roundtrip && openHere.length > 0 && ` · ${openHere.length} unanswered`}
              </h2>
              <ul className="space-y-0.5">
                {findings.map((f) => {
                  const given = answerOf.get(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => openFinding(f)}
                        title={`${f.path}, ${findingLines(f)}: ${f.title}`}
                        className="w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-background"
                      >
                        <span className="flex items-center gap-1.5">
                          <SeverityTag severity={f.severity} />
                          <span className="truncate font-mono">
                            {f.path.slice(f.path.lastIndexOf("/") + 1)}:{f.line}
                          </span>
                          {given && (
                            <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground">
                              {DECISION_LABEL[given.decision]}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-muted-foreground">
                          {f.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {chapterComments.length > 0 && (
            <>
              <h2 className="mt-6 mb-2 font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                {chapterComments.length} comment{chapterComments.length === 1 ? "" : "s"}
              </h2>
              <ul className="space-y-0.5">
                {chapterComments.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openComment(c)}
                      title={`${c.path}, ${describeLines(c)}`}
                      className="w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-background"
                    >
                      <span className="block truncate font-mono">
                        {c.path.slice(c.path.lastIndexOf("/") + 1)}:{c.line}
                      </span>
                      <span className="block truncate text-muted-foreground">{c.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        {/* Right diff pane */}
        <div className="flex min-w-0 flex-1 flex-col" style={fontStyle}>
          <DisplaySettingsBar
            settings={settings}
            update={updateSettings}
            appearanceOpen={appearanceOpen}
            onAppearanceOpenChange={setAppearanceOpen}
          />
          {/* Padding on the inner list, not the scroller: a sticky file header
              sticks inside the scroller's padding, so diff lines would show
              in the gap above it. */}
          <div ref={diffScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex w-full flex-col gap-4 p-4">
              {files.map((f) => (
                <div key={f.path} data-file-path={f.path}>
                  <FileDiffCard
                    file={f}
                    settings={settings}
                    viewed={viewed.has(f.path)}
                    collapsed={collapsed.has(f.path)}
                    focused={focusedPath === f.path}
                    // Stable refs (useCallback in chapterFileSet / handleViewedChange)
                    // — pass them directly rather than re-wrapping in per-render
                    // arrow closures, which is what keeps FileDiffCard's memo alive.
                    // The card supplies the path.
                    onViewedChange={handleViewedChange}
                    onSetCollapsed={setCollapsed}
                    comments={commentsByPath.get(f.path)}
                    findings={findingsByPath.get(f.path)}
                    answers={answers}
                    onAddComment={handleAddComment}
                    onEditComment={editComment}
                    onDeleteComment={removeComment}
                    // Answering a finding sends it to the agent, so it needs
                    // round-trip; without it the cards stay read only.
                    onAnswerFinding={roundtrip ? answerFinding : undefined}
                    onClearFindingAnswer={roundtrip ? clearAnswer : undefined}
                  />
                </div>
              ))}
              {files.length === 0 &&
                (matching.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    No files match “{filter}”.
                  </p>
                ) : (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    All {matching.length} file{matching.length === 1 ? " is" : "s are"} viewed.{" "}
                    <Button
                      variant="link"
                      onClick={() => setHideViewed(false)}
                      className="h-auto p-0"
                    >
                      Show them
                    </Button>
                  </p>
                ))}
            </div>
          </div>
        </div>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} surface="chapter" />
    </div>
  );
}
