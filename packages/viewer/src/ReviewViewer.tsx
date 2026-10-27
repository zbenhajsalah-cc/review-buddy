import type { ResolvedReview } from "@review-buddy/core/types";
import { useEffect, useState } from "react";
import { ChapterReview } from "./components/ChapterReview.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { Overview } from "./components/Overview.tsx";
import { parseReview } from "./lib/reviewSchema.ts";
import { type ReviewApi, ReviewApiProvider, useReviewApi } from "./review-api.tsx";
import { ReviewWorkerPoolProvider } from "./workerPool.tsx";

type View = { mode: "overview" } | { mode: "chapter"; position: number };

/**
 * The whole review UI (overview + chapters + diffs) for one review. Each app
 * mounts it with its own `ReviewApi`; the viewer has no app shell and never
 * fetches by itself.
 */
export function ReviewViewer({ api }: { api: ReviewApi }) {
  return (
    <ErrorBoundary>
      <ReviewWorkerPoolProvider>
        <ReviewApiProvider api={api}>
          <ReviewScreens />
        </ReviewApiProvider>
      </ReviewWorkerPoolProvider>
    </ErrorBoundary>
  );
}

function ReviewScreens() {
  const api = useReviewApi();
  const [review, setReview] = useState<ResolvedReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: "overview" });

  useEffect(() => {
    // Validate at the boundary: the data comes from another process (HTTP or
    // IPC), whatever the api's type says.
    api
      .getReview()
      .then(parseReview)
      .then(setReview, (e) => setError(String(e)));
  }, [api]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <h1 className="mb-2 text-lg font-semibold">Couldn’t load the review</h1>
        <p className="font-mono text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">Loading review…</div>
    );
  }

  // Overview and ChapterReview are mutually exclusive branches, so returning
  // from a chapter always remounts Overview. That remount is what makes
  // Overview's mount-time readViewedEntries() snapshot sufficient — no live
  // subscription. See readViewedEntries in chapterFileSet.ts.
  if (view.mode === "chapter") {
    return (
      <ChapterReview
        review={review}
        position={view.position}
        onNavigate={(position) => setView({ mode: "chapter", position })}
        onExit={() => setView({ mode: "overview" })}
      />
    );
  }

  return (
    <Overview
      review={review}
      onBeginReview={(position) => setView({ mode: "chapter", position })}
    />
  );
}
