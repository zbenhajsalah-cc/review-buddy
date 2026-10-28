import type { ResolvedReview } from "@review-buddy/core/types";
import { useEffect, useState } from "react";
import { ChapterReview, ReviewSubmitted } from "./components/ChapterReview.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { Overview } from "./components/Overview.tsx";
import { parseReview } from "./lib/reviewSchema.ts";
import { tabTitleFor, useTabTitle } from "./lib/tabTitle.ts";
import { useView, type View } from "./lib/view.ts";
import { type ReviewApi, ReviewApiProvider, useReviewApi } from "./review-api.tsx";
import { ReviewWorkerPoolProvider } from "./workerPool.tsx";

/**
 * The whole review UI (overview + chapters + diffs) for one review. Each app
 * mounts it with its own `ReviewApi`; the viewer has no app shell and never
 * fetches by itself. When the page shows only this review: `urlHash` keeps
 * the chapter shown in the URL hash (reload, Back / Forward), and `tabTitle`
 * names the tab after the review and the chapter.
 */
export function ReviewViewer({
  api,
  urlHash = false,
  tabTitle = false,
}: {
  api: ReviewApi;
  urlHash?: boolean;
  tabTitle?: boolean;
}) {
  return (
    <ErrorBoundary>
      <ReviewWorkerPoolProvider>
        <ReviewApiProvider api={api}>
          {/* A new review remounts the screens: the view, the loaded review,
              and the per-review file flags (whose storage key is read once,
              on mount) must not carry over and be saved under the new key. */}
          <ReviewScreens key={api.reviewKey} urlHash={urlHash} tabTitle={tabTitle} />
        </ReviewApiProvider>
      </ReviewWorkerPoolProvider>
    </ErrorBoundary>
  );
}

function ReviewScreens({ urlHash, tabTitle }: { urlHash: boolean; tabTitle: boolean }) {
  const api = useReviewApi();
  const [review, setReview] = useState<ResolvedReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, navigate] = useView(urlHash);
  // Marked done (afterDone "keep"): kept here, so every chapter shows it.
  const [markedDone, setMarkedDone] = useState(false);
  // Submitted (afterDone "close"): kept here, so Back does not reopen the review.
  const [submitted, setSubmitted] = useState(false);
  // The file a chapter opens at (the overview's review focus); any other move clears it.
  const [openFile, setOpenFile] = useState<string>();
  const show = (next: View, file?: string) => {
    setOpenFile(file);
    navigate(next);
  };

  // A chapter this review does not have (a hash from elsewhere) shows the overview.
  const shown: View =
    view.mode === "chapter" && review?.chapters[view.position] ? view : { mode: "overview" };
  useTabTitle(
    tabTitle && review
      ? tabTitleFor(review.pr.title, shown, review.chapters.length, submitted)
      : undefined,
  );

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

  if (submitted) return <ReviewSubmitted />;

  // Overview and ChapterReview are mutually exclusive branches, so returning
  // from a chapter always remounts Overview. That remount is what makes
  // Overview's mount-time readViewedEntries() snapshot sufficient — no live
  // subscription. See readViewedEntries in chapterFileSet.ts.
  if (shown.mode === "chapter") {
    return (
      <ChapterReview
        review={review}
        position={shown.position}
        openFile={openFile}
        onNavigate={(position) => show({ mode: "chapter", position })}
        onExit={() => show({ mode: "overview" })}
        markedDone={markedDone}
        onMarkedDone={() => setMarkedDone(true)}
        onSubmitted={() => setSubmitted(true)}
      />
    );
  }

  return (
    <Overview
      review={review}
      onBeginReview={(position, file) => show({ mode: "chapter", position }, file)}
    />
  );
}
