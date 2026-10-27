import { ReviewViewer } from "@review-buddy/viewer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { FIXTURE_REVIEW_KEY } from "../../shared/ipc.ts";
import { ipcReviewApi } from "./ipc-review-api.ts";

const api = ipcReviewApi(window.reviewBuddy, FIXTURE_REVIEW_KEY);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReviewViewer api={api} />
  </StrictMode>,
);
