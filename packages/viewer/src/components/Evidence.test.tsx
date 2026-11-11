import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { fakeResolvedReview, fakeReviewWithEvidence } from "../stories/fixtures.ts";
import { Evidence } from "./Evidence.tsx";

afterEach(cleanup);

const ciOnly = { ...fakeReviewWithEvidence, verification: undefined };
const agentOnly = { ...fakeReviewWithEvidence, pr: fakeResolvedReview.pr };

test("no evidence → one muted line", () => {
  render(<Evidence review={fakeResolvedReview} />);
  const card = screen.getByRole("region", { name: "Evidence" });
  expect(card.textContent).toContain("No checks were reported for this change.");
  expect(screen.queryByText("Reported by the agent")).toBeNull();
  expect(screen.queryByText("CI (GitHub)")).toBeNull();
});

test("CI only: failed and pending by name, passed as a count, a link to all checks", () => {
  render(<Evidence review={ciOnly} />);
  expect(screen.getByText("CI (GitHub)")).toBeTruthy();
  expect(screen.getByText("7e8e705")).toBeTruthy();
  const items = [...screen.getByRole("region").querySelectorAll("li")].map((li) => li.textContent);
  expect(items[0]).toContain("CI / test (windows)");
  expect(items[0]).toContain("Failed");
  expect(items[1]).toContain("CI / e2e");
  expect(items[2]).toContain("12 passed");
  expect(items).toHaveLength(3);
  const failed = screen.getByRole("link", { name: "CI / test (windows)" });
  expect(failed.getAttribute("href")).toBe(
    "https://github.com/octocat/hello-world/actions/runs/1/job/3",
  );
  expect(screen.getByRole("link", { name: "All checks ↗" }).getAttribute("href")).toBe(
    "https://github.com/octocat/hello-world/pull/42/checks",
  );
  expect(screen.queryByText("Reported by the agent")).toBeNull();
});

test("agent only: labelled as reported, failed first, not_run shown honestly", () => {
  render(<Evidence review={agentOnly} />);
  expect(screen.getByText("Reported by the agent")).toBeTruthy();
  expect(screen.queryByText("CI (GitHub)")).toBeNull();
  const commands = [...screen.getByRole("region").querySelectorAll("li code")].map(
    (c) => c.textContent,
  );
  expect(commands).toEqual([
    "pnpm test:viewer",
    "pnpm test:core",
    "pnpm typecheck",
    "pnpm smoke:plugin",
  ]);
  expect(screen.getByText("1 snapshot differs")).toBeTruthy();
  expect(screen.getByText("not run")).toBeTruthy();
  expect(screen.getByRole("region").textContent).toContain(
    "Not covered: The Windows path handling was not run on Windows.",
  );
});

test("both: CI first, then the agent's checks", () => {
  render(<Evidence review={fakeReviewWithEvidence} />);
  const text = screen.getByRole("region").textContent ?? "";
  expect(text.indexOf("CI (GitHub)")).toBeGreaterThan(-1);
  expect(text.indexOf("CI (GitHub)")).toBeLessThan(text.indexOf("Reported by the agent"));
});

test("a check link that is not https is shown as plain text", () => {
  const review = {
    ...ciOnly,
    pr: {
      ...ciOnly.pr,
      checks: [{ name: "evil", status: "failed" as const, url: "javascript:alert(1)" }],
    },
  };
  render(<Evidence review={review} />);
  expect(screen.queryByRole("link", { name: "evil" })).toBeNull();
  expect(screen.getByText("evil")).toBeTruthy();
});

test("only not_covered still counts as evidence", () => {
  const review = { ...fakeResolvedReview, verification: { not_covered: "I ran nothing." } };
  render(<Evidence review={review} />);
  const card = screen.getByRole("region", { name: "Evidence" });
  expect(card.textContent).not.toContain("No checks were reported");
  expect(card.textContent).toContain("I ran nothing.");
});

test("incomplete CI says the list may miss failures", () => {
  const review = { ...ciOnly, pr: { ...ciOnly.pr, checksIncomplete: true } };
  render(<Evidence review={review} />);
  expect(screen.getByRole("region").textContent).toContain(
    "Some checks could not be read, so this list may miss failures.",
  );
});

test("complete CI has no such note", () => {
  render(<Evidence review={ciOnly} />);
  expect(screen.getByRole("region").textContent).not.toContain("could not be read");
});
