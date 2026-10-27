import { expect, mock, test } from "bun:test";
import type { ReviewBridge } from "../../shared/ipc.ts";
import { ipcReviewApi } from "./ipc-review-api.ts";

test("every call names its review", async () => {
  const bridge = {
    getReview: mock(async () => ({}) as never),
    getFileContent: mock(async (_key: string, path: string, side: "base" | "head") => ({
      path,
      side,
      language: "typescript",
      content: "x",
    })),
    getConfig: mock(async () => ({ roundtrip: false })),
    done: mock(async () => {}),
    start: mock(async () => ({ run: 1, state: "running" as const, steps: [] })),
    stop: mock(async () => ({ run: 1, state: "failed" as const, steps: [] })),
    runStatus: mock(async () => ({ run: 0, state: "idle" as const, steps: [] })),
  } satisfies ReviewBridge;

  const api = ipcReviewApi(bridge, "octo/repo#1@abc");
  expect(api.reviewKey).toBe("octo/repo#1@abc");
  await api.getReview();
  await api.getFileContent("src/a.ts", "base");
  await api.done({ verdict: "approve" });
  expect(bridge.getReview).toHaveBeenCalledWith("octo/repo#1@abc");
  expect(bridge.getFileContent).toHaveBeenCalledWith("octo/repo#1@abc", "src/a.ts", "base");
  expect(bridge.done).toHaveBeenCalledWith("octo/repo#1@abc", { verdict: "approve" });
});
