import { ReviewWorkerPoolProvider } from "@review-buddy/viewer";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.tsx";

/**
 * No <StrictMode>, and the worker pool provider above <App>. Both are about
 * @pierre/diffs, which drives the diff views through imperative renderers
 * registered with one worker-pool SINGLETON.
 *
 * StrictMode's mount → cleanup → mount again leaves the pool holding the
 * renderer from the first pass, so every highlight result is delivered to an
 * instance that is no longer on screen: the diffs stay plain red/green with no
 * error anywhere. Measured in this app's dev build on a 65-file review: 65 of
 * 65 files plain with StrictMode, 2 of 65 without it (those 2 have no
 * highlightable language). StrictMode is inert in a production build, which is
 * why only dev showed it.
 *
 * The provider is above <App> because App unmounts and remounts <ReviewViewer>
 * (keyed per review) on every navigation, and the pool singleton is terminated
 * as soon as the last provider unmounts — a remount in the same commit is then
 * handed the terminated manager, whose queued highlight tasks were wiped.
 */
createRoot(document.getElementById("root")!).render(
  <ReviewWorkerPoolProvider>
    <App bridge={window.reviewBuddy} />
  </ReviewWorkerPoolProvider>,
);
