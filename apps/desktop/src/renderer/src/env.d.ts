import type { ReviewBridge } from "../../shared/ipc.ts";

declare global {
  interface Window {
    /** Exposed by the preload script (src/preload/index.ts). */
    reviewBuddy: ReviewBridge;
  }
}
