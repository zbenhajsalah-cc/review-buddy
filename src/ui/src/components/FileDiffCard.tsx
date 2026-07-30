import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";
import { memo, useId, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { DisplaySettings, ResolvedFile } from "../../../types/review.ts";
import { fetchFileContent } from "../api.ts";
import { buildExpandedDiff, canExpand, requiredSides } from "../lib/expand.ts";
import { fileToPatch } from "../lib/patch.ts";
import { toDiffOptions } from "../settings.ts";
import { DiffStat } from "./DiffStat.tsx";

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
// per-render arrow). Do not re-wrap them in closures.
export const FileDiffCard = memo(function FileDiffCard({
  file,
  settings,
  viewed,
  collapsed,
  focused = false,
  onViewedChange,
  onSetCollapsed,
}: {
  file: ResolvedFile;
  settings: DisplaySettings;
  viewed: boolean;
  collapsed: boolean;
  focused?: boolean;
  onViewedChange: (path: string, checked: boolean) => void;
  onSetCollapsed: (path: string, value: boolean) => void;
}) {
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

  const patch = useMemo(() => fileToPatch(file), [file]);
  const options = useMemo(() => toDiffOptions(settings), [settings]);
  const expandedOptions = useMemo(() => ({ ...options, expandUnchanged: true }), [options]);

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
          ? fetchFileContent(file.old_path ?? file.path, "base").then((r) => r.content)
          : Promise.resolve(""),
        req.head ? fetchFileContent(file.path, "head").then((r) => r.content) : Promise.resolve(""),
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
        "gap-0 overflow-hidden py-0",
        viewed && "opacity-60",
        focused && "ring-2 ring-primary ring-offset-1",
      )}
    >
      {/* File header */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
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
          <span className="truncate font-mono text-sm" title={file.path}>
            {file.old_path ? `${file.old_path} → ${file.path}` : file.path}
          </span>
          <Badge
            variant="outline"
            className="shrink-0 rounded px-1.5 py-0.5 text-[0.62rem] uppercase"
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
                  <FileDiff fileDiff={expandedDiff} options={expandedOptions} />
                ) : (
                  <PatchDiff patch={patch} options={options} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
});
