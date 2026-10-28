import { ReviewViewer } from "@review-buddy/viewer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { httpReviewApi, reviewFinished } from "./http-review-api.ts";
import { guardUnfinishedReview } from "./leave-guard.ts";

guardUnfinishedReview(reviewFinished);

// One review per page: the chapter shown lives in the URL hash.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReviewViewer api={httpReviewApi} urlHash />
  </StrictMode>,
);
