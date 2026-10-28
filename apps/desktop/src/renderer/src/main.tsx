import { ReviewWorkerPoolProvider } from "@review-buddy/viewer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Above <App> on purpose. App unmounts and remounts <ReviewViewer>
        (keyed per review) on every navigation, and @pierre/diffs terminates
        its worker-pool SINGLETON as soon as the last provider unmounts — a
        remount in the same commit can be handed the terminated manager, since
        it captured the singleton during render. Keeping one provider mounted
        for the app's lifetime keeps the pool alive across navigation. */}
    <ReviewWorkerPoolProvider>
      <App bridge={window.reviewBuddy} />
    </ReviewWorkerPoolProvider>
  </StrictMode>,
);
