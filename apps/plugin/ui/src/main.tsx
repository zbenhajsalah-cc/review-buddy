import { ReviewViewer, ReviewWorkerPoolProvider } from "@review-buddy/viewer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { httpReviewApi } from "./http-review-api.ts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Keeps the @pierre/diffs worker pool alive for the page's lifetime —
        see the note in apps/desktop/src/renderer/src/main.tsx. */}
    <ReviewWorkerPoolProvider>
      <ReviewViewer api={httpReviewApi} />
    </ReviewWorkerPoolProvider>
  </StrictMode>,
);
