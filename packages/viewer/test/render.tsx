import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { type ReviewApi, ReviewApiProvider } from "../src/review-api.tsx";
import { fakeReviewApi } from "../src/stories/fixtures.ts";

/** render() inside a ReviewApiProvider (a fake in-memory api by default). */
export function renderWithApi(
  ui: ReactElement,
  api: ReviewApi = fakeReviewApi(),
  options?: Omit<RenderOptions, "wrapper">,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReviewApiProvider api={api}>{children}</ReviewApiProvider>
  );
  return render(ui, { wrapper, ...options });
}
