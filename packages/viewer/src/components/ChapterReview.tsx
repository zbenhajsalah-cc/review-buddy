import type { ResolvedChapter, ResolvedReview } from "@review-buddy/core/types";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  clearReviewFileState,
  readViewedEntries,
  useCollapsedFiles,
  useViewedFiles,
} from "../lib/chapterFileSet.ts";
import { keepFileInView } from "../lib/keepFileInView.ts";
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
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // afterDone "keep": done, but the review stays open (desktop).
  const [doneHere, setDoneHere] = useState(false);
  const markedDone = parentDone || doneHere;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [roundtrip, setRoundtrip] = useState(false);
  const [requesting, setRequesting] = useState(false); // textarea open
  const [summary, setSummary] = useState("");
  // Done with files not marked viewed: how many, while the check is shown.
  const [unfinished, setUnfinished] = useState<{ viewed: number; total: number } | null>(null);
  // A preference, so a cookie: the plugin serves each review on a new port,
  // and localStorage is per port while cookies are per host.
  const [hideViewed, setHideViewed] = usePersistedState("rb.hideViewed", false, "cookie");
  const hideViewedId = useId();
  const diffScrollRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<CopyMarkdownHandle>(null);

  const matching = filter
    ? chapter.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : chapter.files;
  const files = hideViewed ? matching.filter((f) => !viewed.has(f.path)) : matching;
  const filePaths = files.map((f) => f.path);
  const { focusedPath, focusedPathRef, focus, move } = useFileFocus(filePaths);
  const prev = chapters[position - 1];
  const next = chapters[position + 1];
  const shortcutsActive = !submitted && !shortcutsOpen;

  // Verdict UI is gated by REVIEW_BUDDY_ROUNDTRIP; the server exposes it via /api/config.
  useEffect(() => {
    api
      .getConfig()
      .then((c) => setRoundtrip(c.roundtrip))
      .catch(() => {});
  }, [api]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll/filter when navigating chapters
  useEffect(() => {
    diffScrollRef.current?.scrollTo({ top: 0 });
    setFilter("");
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
    return keepFileInView(scroller, openFile);
  }, [chapterIndex, openFile]);

  // Collapse all files of the chapter (also ones the filter hides), or expand
  // all when none is open.
  const anyExpanded = chapter.files.some((f) => !collapsed.has(f.path));
  const toggleAllCollapsed = () => {
    for (const f of chapter.files) setCollapsed(f.path, anyExpanded);
  };

  useChapterShortcuts({
    shortcutsActive,
    onShowShortcuts: () => setShortcutsOpen(true),
    onCopyMarkdown: () => copyRef.current?.copy(),
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

  const finish = () => {
    setUnfinished(null);
    void submit(roundtrip ? { verdict: "approve" } : undefined);
  };
  // Done asks first while files are not marked viewed (over the whole review).
  const done = () => {
    const progress = reviewProgress(chapters, readViewedEntries(api.reviewKey));
    if (progress.viewed >= progress.total) return finish();
    setRequesting(false);
    setUnfinished(progress);
  };
  const requestChanges = () => submit({ verdict: "request_changes", summary });

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
              text={() => chapterToMarkdown(chapter)}
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
            <Button size="sm" onClick={done} disabled={submitting || markedDone}>
              {submitting ? "Submitting…" : markedDone ? "Done ✓" : "Done"}
            </Button>
          </div>
          {/* Floats over the diff pane, so asking does not move the page. */}
          {unfinished && (
            <div className="absolute top-full right-0 z-20 mt-1.5 flex w-72 flex-col gap-2 rounded-md border border-border bg-card p-2.5 text-sm shadow-md">
              <p>
                Viewed {unfinished.viewed} of {unfinished.total} file
                {unfinished.total === 1 ? "" : "s"}. Finish anyway?
              </p>
              <div className="flex justify-end gap-2">
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
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What should change?"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              <Button
                size="sm"
                variant="destructive"
                onClick={requestChanges}
                disabled={submitting}
                className="self-end"
              >
                Submit request
              </Button>
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
        </aside>

        {/* Right diff pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <DisplaySettingsBar settings={settings} update={updateSettings} />
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
