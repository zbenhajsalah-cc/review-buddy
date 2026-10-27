import { expect, test } from "bun:test";
import { ipcErrorMessage } from "./ReviewRun.tsx";

test("ipcErrorMessage drops Electron's wrapper", () => {
  expect(
    ipcErrorMessage(
      new Error("Error invoking remote method 'review:start': Error: A review is already running."),
    ),
  ).toBe("A review is already running.");
  expect(ipcErrorMessage(new Error("plain"))).toBe("plain");
  expect(ipcErrorMessage("text")).toBe("text");
});
