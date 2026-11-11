/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import type { ResolvedFinding } from "@review-buddy/core/types";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithApi } from "../../test/render.tsx";
import { MAX_FINDING_REASON } from "../lib/findings.ts";
import { FindingCard } from "./Finding.tsx";

afterEach(cleanup);

const finding = (over: Partial<ResolvedFinding> = {}): ResolvedFinding => ({
  id: "f-1",
  path: "src/cache.ts",
  line: 42,
  side: "new",
  severity: "important",
  title: "Cache key ignores the tenant id",
  ...over,
});

const button = (name: string) => screen.getByRole("button", { name });

test("read only without onAnswer: no way to answer it", () => {
  renderWithApi(<FindingCard finding={finding()} />);
  expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
});

test("Fix answers straight away", () => {
  const onAnswer = mock();
  renderWithApi(<FindingCard finding={finding()} onAnswer={onAnswer} />);
  fireEvent.click(button("Fix"));
  expect(onAnswer).toHaveBeenCalledWith("f-1", "fix");
});

test("an important finding cannot be dismissed without a reason", () => {
  const onAnswer = mock();
  renderWithApi(<FindingCard finding={finding()} onAnswer={onAnswer} />);
  fireEvent.click(button("Dismiss"));
  const confirm = button("Dismiss");
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(confirm);
  expect(onAnswer).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Why this finding is dismissed"), {
    target: { value: "  used by the codegen  " },
  });
  fireEvent.click(button("Dismiss"));
  // The reason is trimmed where it is stored, not here.
  expect(onAnswer).toHaveBeenCalledWith("f-1", "dismiss", "  used by the codegen  ");
});

test("a nit may be dismissed with no reason, and Cancel leaves it unanswered", () => {
  const onAnswer = mock();
  renderWithApi(<FindingCard finding={finding({ severity: "nit" })} onAnswer={onAnswer} />);
  fireEvent.click(button("Dismiss"));
  fireEvent.click(button("Cancel"));
  expect(screen.queryByLabelText("Why this finding is dismissed")).toBeNull();
  expect(onAnswer).not.toHaveBeenCalled();

  fireEvent.click(button("Dismiss"));
  fireEvent.click(button("Dismiss"));
  expect(onAnswer).toHaveBeenCalledWith("f-1", "dismiss", "");
});

test("an answered finding shows the decision and its reason, and Undo takes it back", () => {
  const onClearAnswer = mock();
  renderWithApi(
    <FindingCard
      finding={finding()}
      answer={{ id: "f-1", decision: "dismiss", reason: "by design" }}
      onAnswer={mock()}
      onClearAnswer={onClearAnswer}
    />,
  );
  const card = screen.getByRole("article", {
    name: "Important finding: Cache key ignores the tenant id",
  });
  expect(card.dataset.answered).toBe("dismiss");
  expect(card.textContent).toContain("Dismissed");
  expect(card.textContent).toContain("by design");
  // Answered: the buttons are gone, the answer is what shows.
  expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
  fireEvent.click(button("Undo"));
  expect(onClearAnswer).toHaveBeenCalledWith("f-1");
});

test("the dismissal reason cannot be typed past what the server accepts", () => {
  const onAnswer = mock();
  renderWithApi(<FindingCard finding={finding({ severity: "nit" })} onAnswer={onAnswer} />);
  fireEvent.click(button("Dismiss"));
  const field = screen.getByLabelText("Why this finding is dismissed") as HTMLTextAreaElement;
  expect(field.maxLength).toBe(MAX_FINDING_REASON);

  // Near the limit the field says how much room is left.
  fireEvent.change(field, { target: { value: "r".repeat(MAX_FINDING_REASON - 10) } });
  expect(screen.getByText("10 characters left")).toBeDefined();
});
