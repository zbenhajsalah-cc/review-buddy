import { ReviewViewer, ReviewWorkerPoolProvider } from "@review-buddy/viewer";
import { createRoot } from "react-dom/client";
import "./index.css";
import { httpReviewApi } from "./http-review-api.ts";

// No <StrictMode>, and the pool provider at the root — see the note in
// apps/desktop/src/renderer/src/main.tsx. The shipped viewer is a production
// build, where StrictMode is inert, but `pnpm dev` here would hit the same
// silently-unhighlighted diffs.
createRoot(document.getElementById("root")!).render(
  <ReviewWorkerPoolProvider>
    <ReviewViewer api={httpReviewApi} />
  </ReviewWorkerPoolProvider>,
);
