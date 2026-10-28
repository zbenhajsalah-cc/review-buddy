import { ReviewViewer, ReviewWorkerPoolProvider } from "@review-buddy/viewer";
import { createRoot } from "react-dom/client";
import "./index.css";
import { httpReviewApi, reviewFinished } from "./http-review-api.ts";
import { guardUnfinishedReview } from "./leave-guard.ts";

guardUnfinishedReview(reviewFinished);

// No <StrictMode>, and the pool provider at the root — see the note in
// apps/desktop/src/renderer/src/main.tsx. The shipped viewer is a production
// build, where StrictMode is inert, but `pnpm dev` here would hit the same
// silently-unhighlighted diffs. One review per page: the chapter shown lives
// in the URL hash, and the tab is named after the review and the chapter.
createRoot(document.getElementById("root")!).render(
  <ReviewWorkerPoolProvider>
    <ReviewViewer api={httpReviewApi} urlHash tabTitle />
  </ReviewWorkerPoolProvider>,
);
