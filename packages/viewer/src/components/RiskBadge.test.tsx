/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { RiskBadge } from "./RiskBadge.tsx";

afterEach(cleanup);

test("renders the risk label", () => {
  render(<RiskBadge risk="High" />);
  expect(screen.getByText("High")).toBeDefined();
});
