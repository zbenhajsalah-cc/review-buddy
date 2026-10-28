import type { ResolvedReview } from "@review-buddy/core/types";
import { useMemo, useRef, useState } from "react";
import { readViewedEntries } from "../lib/chapterFileSet.ts";
import { progressByChapter } from "../lib/progress.ts";
import { reviewToMarkdown } from "../lib/reviewMarkdown.ts";
import { useShortcuts } from "../lib/shortcuts.ts";
import { cn } from "../lib/utils.ts";
import { useReviewApi } from "../review-api.tsx";
import { CopyMarkdownButton, type CopyMarkdownHandle } from "./CopyMarkdownButton.tsx";
import { DiffStat } from "./DiffStat.tsx";
import { Markdown } from "./Markdown.tsx";
import { RiskBadge } from "./RiskBadge.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";

type Tab = "prologue" | "description";

export function Overview({
  review,
  onBeginReview,
}: {
  review: ResolvedReview;
  /** `file`: open the chapter at that file (the review focus). */
  onBeginReview: (position: number, file?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("prologue");
  const { pr, meta, prologue, stats, chapters, warnings } = review;
  const [warningsOpen, setWarningsOpen] = useState(warnings.length <= 3);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { reviewKey } = useReviewApi();
  const [viewedEntries] = useState(() => readViewedEntries(reviewKey));
  const copyRef = useRef<CopyMarkdownHandle>(null);

  const chapterProgress = useMemo(
    () => progressByChapter(chapters, viewedEntries),
    [chapters, viewedEntries],
  );
  const completedCount = chapterProgress.filter((p) => p.complete).length;
  // Once the reviewer has viewed a file, "Begin review" continues at the first
  // chapter that is not complete (-1: nothing viewed yet, or all complete).
  const resumeAt = chapterProgress.some((p) => p.viewedCount > 0)
    ? chapters.findIndex((ch, i) => ch.fileCount > 0 && !chapterProgress[i]?.complete)
    : -1;
  const startAt = Math.max(resumeAt, 0);
  const focusPath = focusFilePath(prologue.review_focus.file);
  const focusAt = chapters.findIndex((ch) => ch.files.some((f) => f.path === focusPath));

  useShortcuts({
    SHOW_SHORTCUTS: {
      handler: () => setShortcutsOpen(true),
      enabled: !shortcutsOpen,
    },
    BEGIN_REVIEW: {
      handler: () => {
        if (chapters.length > 0) onBeginReview(startAt);
      },
      enabled: !shortcutsOpen && chapters.length > 0,
    },
    COPY_MARKDOWN: {
      handler: () => copyRef.current?.copy(),
      enabled: !shortcutsOpen,
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* PR header */}
      <header className="mb-7">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-serif text-[2.6rem] font-normal leading-[1.08] tracking-[-0.015em]">
            {pr.title || "Untitled review"}
          </h1>
          <div className="flex shrink-0 items-center gap-0.5">
            <CopyMarkdownButton
              ref={copyRef}
              text={() => reviewToMarkdown(review)}
              aria-label="Copy review as Markdown"
              title="Copy review as Markdown (c)"
              label="copy"
              variant="ghost"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShortcutsOpen(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              className="shrink-0 text-muted-foreground"
            >
              ?
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.82rem] text-muted-foreground">
          <span>{pr.author || "unknown"}</span>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs">
            {pr.base} ← {pr.head}
          </span>
          <span aria-hidden>·</span>
          <DiffStat additions={stats.additions} deletions={stats.deletions} />
          <span aria-hidden>·</span>
          <span>
            {stats.filesChanged} file{stats.filesChanged === 1 ? "" : "s"}
          </span>
          {meta.aiGenerated && (
            <Badge
              variant="outline"
              className="rounded-full px-2 py-0.5 text-[0.68rem] font-semibold"
              title={`Prompt v${meta.promptVersion} · ${new Date(meta.generatedAt).toLocaleString()}`}
            >
              ✦ AI-generated · {meta.generatedBy}
            </Badge>
          )}
        </div>
      </header>

      {warnings.length > 0 && (
        <div className="mb-6 rounded-xl border border-rb-focus-border border-l-[3px] border-l-risk-medium bg-rb-focus-bg p-3 text-rb-focus-fg">
          <button
            type="button"
            onClick={() => setWarningsOpen((o) => !o)}
            aria-expanded={warningsOpen}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-sm font-medium">
              ⚠ {warnings.length} resolution note{warnings.length === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-muted-foreground">
              {warningsOpen ? "▾ Hide" : "▸ Show"}
            </span>
          </button>
          {warningsOpen && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        <TabButton active={tab === "prologue"} onClick={() => setTab("prologue")}>
          AI Prologue
        </TabButton>
        <TabButton active={tab === "description"} onClick={() => setTab("description")}>
          Description
        </TabButton>
      </div>

      {tab === "prologue" ? (
        <section className="space-y-5">
          <Block heading="Why">
            <Markdown value={prologue.why} />
          </Block>
          <Block heading="What">
            <Markdown value={prologue.what} />
          </Block>
          <Block heading="Key changes">
            <ul className="space-y-1.5">
              {prologue.key_changes.map((k) => (
                <li key={k.headline} className="leading-relaxed">
                  <span className="font-semibold">{k.headline}</span>
                  <span className="text-muted-foreground">
                    {" — "}
                    <Markdown value={k.detail} variant="inline" className="inline" />
                  </span>
                </li>
              ))}
            </ul>
          </Block>
          {/* The one thing to read first: the warm counterweight to the
              otherwise pine-and-grey page, with a pine spine. */}
          <div className="rounded-xl border border-rb-focus-border border-l-[3px] border-l-primary bg-rb-focus-bg px-4 py-3.5">
            <h3 className="mb-1.5 font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-rb-focus-label">
              Review focus
            </h3>
            <p className="text-[0.95rem] leading-relaxed text-rb-focus-fg">
              <Markdown value={prologue.review_focus.summary} variant="inline" className="inline" />{" "}
              {focusAt >= 0 ? (
                <button
                  type="button"
                  onClick={() => onBeginReview(focusAt, focusPath)}
                  title={`Open in chapter ${chapters[focusAt]?.index}`}
                  className="mt-1.5 block text-left font-mono text-xs text-rb-focus-fg/80 underline decoration-rb-focus-fg/30 underline-offset-2 hover:decoration-current"
                >
                  {prologue.review_focus.file} →
                </button>
              ) : (
                <code className="mt-1.5 block font-mono text-xs text-rb-focus-fg/80">
                  {prologue.review_focus.file}
                </code>
              )}
            </p>
          </div>
        </section>
      ) : (
        <section>
          {pr.description ? (
            <Markdown value={pr.description} className="text-sm" />
          ) : (
            <p className="text-muted-foreground">No PR description available.</p>
          )}
        </section>
      )}

      {/* Chapter list */}
      <h2 className="mt-10 mb-3 flex items-center gap-3 font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        <span>
          {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
          {completedCount > 0 && ` · ${completedCount} of ${chapters.length} complete`}
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </h2>
      <ol className="space-y-3">
        {chapters.map((ch, i) => {
          const { viewedCount, complete } = chapterProgress[i] ?? {
            viewedCount: 0,
            complete: false,
          };
          return (
            <li key={ch.index}>
              <button
                type="button"
                onClick={() => onBeginReview(i)}
                className="w-full rounded-xl border border-border bg-card p-4 pb-3.5 text-left transition hover:border-primary/40 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {/* The chapter numeral is the editorial anchor: serif, in
                        the accent, dimmed once the chapter is complete. */}
                    <span
                      className={cn(
                        "font-serif text-2xl leading-none",
                        complete ? "text-muted-foreground" : "text-primary",
                      )}
                    >
                      {String(ch.index).padStart(2, "0")}
                    </span>
                    <RiskBadge risk={ch.risk} />
                    {complete && <span aria-hidden>✓</span>}
                  </div>
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <DiffStat additions={ch.additions} deletions={ch.deletions} />
                    <span className="text-xs text-muted-foreground">
                      {ch.fileCount} file{ch.fileCount === 1 ? "" : "s"}
                    </span>
                    {viewedCount > 0 && ch.fileCount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {viewedCount}/{ch.fileCount} viewed
                      </span>
                    )}
                  </div>
                </div>
                {/* A span, not a heading: the card is a <button>, whose content
                    model is phrasing only. */}
                <span
                  className={cn(
                    "mt-2.5 block font-serif text-[1.4rem] font-normal leading-tight tracking-[-0.01em]",
                    complete && "text-muted-foreground",
                  )}
                >
                  {ch.title}
                </span>
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                  <Markdown value={ch.description} variant="inline" className="inline" />
                </p>
                {viewedCount > 0 && ch.fileCount > 0 && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={ch.fileCount}
                    aria-valuenow={viewedCount}
                    aria-label={`${ch.title}: ${viewedCount} of ${ch.fileCount} files viewed`}
                    className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(viewedCount / ch.fileCount) * 100}%` }}
                    />
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <Button
        onClick={() => onBeginReview(startAt)}
        disabled={chapters.length === 0}
        size="lg"
        className="mt-8"
      >
        {resumeAt >= 0 ? `Continue with chapter ${chapters[resumeAt]?.index} →` : "Begin review →"}
      </Button>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} surface="overview" />
    </div>
  );
}

/**
 * The review focus as a diff path: the agent may write `./a.ts` or `a.ts:42`
 * (a line) for a file the diff calls `a.ts`.
 */
export function focusFilePath(file: string): string {
  return file
    .trim()
    .replace(/^\.\//, "")
    .replace(/:\d+(?:-\d+)?$/, "");
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.08em] transition",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {heading}
      </h3>
      <div className="text-[0.98rem] leading-[1.6]">{children}</div>
    </div>
  );
}
