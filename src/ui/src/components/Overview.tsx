import type { ResolvedReview } from "@review-buddy/core/types";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readViewedEntries } from "../lib/chapterFileSet.ts";
import { chapterPathSet } from "../lib/chapterPathSet.ts";
import { reviewToMarkdown } from "../lib/reviewMarkdown.ts";
import { useShortcuts } from "../lib/shortcuts.ts";
import { CopyMarkdownButton, type CopyMarkdownHandle } from "./CopyMarkdownButton.tsx";
import { DiffStat } from "./DiffStat.tsx";
import { Markdown } from "./Markdown.tsx";
import { RiskBadge } from "./RiskBadge.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";

type Tab = "prologue" | "description";

export function Overview({
  review,
  onBeginReview,
}: {
  review: ResolvedReview;
  onBeginReview: (position: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("prologue");
  const { pr, meta, prologue, stats, chapters, warnings } = review;
  const [warningsOpen, setWarningsOpen] = useState(warnings.length <= 3);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [viewedEntries] = useState(readViewedEntries);
  const copyRef = useRef<CopyMarkdownHandle>(null);

  const chapterProgress = useMemo(
    () =>
      chapters.map((ch) => {
        // Intersect with chapter files so stale entries for removed paths don't inflate the count.
        const viewed = chapterPathSet(viewedEntries, ch.index);
        const viewedCount = ch.files.filter((f) => viewed.has(f.path)).length;
        return {
          viewedCount,
          complete: ch.fileCount > 0 && viewedCount === ch.fileCount,
        };
      }),
    [chapters, viewedEntries],
  );
  const completedCount = chapterProgress.filter((p) => p.complete).length;

  useShortcuts({
    SHOW_SHORTCUTS: {
      handler: () => setShortcutsOpen(true),
      enabled: !shortcutsOpen,
    },
    BEGIN_REVIEW: {
      handler: () => {
        if (chapters.length > 0) onBeginReview(0);
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
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{pr.title || "Untitled review"}</h1>
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
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
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
        <div className="mb-6 rounded-lg border border-border border-l-[3px] border-l-risk-medium p-3">
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
          <Block heading="Review focus">
            <p>
              <Markdown value={prologue.review_focus.summary} variant="inline" className="inline" />{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {prologue.review_focus.file}
              </code>
            </p>
          </Block>
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
      <h2 className="mt-10 mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
        {completedCount > 0 && ` · ${completedCount} of ${chapters.length} complete`}
      </h2>
      <ol className="space-y-2.5">
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
                className="w-full rounded-xl border border-border bg-card p-4 text-left transition hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(ch.index).padStart(2, "0")}
                    </span>
                    <RiskBadge risk={ch.risk} />
                    {complete && <span aria-hidden>✓</span>}
                    <span className={cn("font-medium", complete && "text-muted-foreground")}>
                      {ch.title}
                    </span>
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
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
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
        onClick={() => onBeginReview(0)}
        disabled={chapters.length === 0}
        size="lg"
        className="mt-8"
      >
        Begin review →
      </Button>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} surface="overview" />
    </div>
  );
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
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <div className="text-[0.95rem] leading-relaxed">{children}</div>
    </div>
  );
}
