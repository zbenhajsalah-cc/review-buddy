import { ReviewViewer } from "@review-buddy/viewer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { httpReviewApi } from "./http-review-api.ts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReviewViewer api={httpReviewApi} />
  </StrictMode>,
);
