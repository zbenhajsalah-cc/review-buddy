import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ReviewWorkerPoolProvider } from "./workerPool.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ReviewWorkerPoolProvider>
        <App />
      </ReviewWorkerPoolProvider>
    </ErrorBoundary>
  </StrictMode>,
);
