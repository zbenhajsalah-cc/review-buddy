import { expect, test } from "bun:test";
import type { ClaudeCodeStatus } from "../../shared/ipc.ts";
import { claudeBlocked, claudeTitle } from "./ClaudeCodeSettings.tsx";

const base = { minVersion: "2.1.296", chosen: false, checkedAt: "2026-10-27T12:00:00.000Z" };
const ok: ClaudeCodeStatus = { ...base, state: "ok", path: "/bin/claude", version: "2.1.311" };

test("claudeBlocked: nothing while ok or not checked yet, else main's message", () => {
  expect(claudeBlocked(null)).toBeUndefined();
  expect(claudeBlocked(ok)).toBeUndefined();
  expect(
    claudeBlocked({ ...base, state: "too-old", version: "2.1.200", message: "Update it." }),
  ).toBe("Update it.");
  expect(claudeBlocked({ ...base, state: "broken" })).toBe("Claude Code cannot run. See Settings.");
});

test("claudeTitle names each state", () => {
  expect(claudeTitle(ok)).toBe("Claude Code 2.1.311");
  expect(claudeTitle({ ...base, state: "missing" })).toBe("Claude Code not found");
  expect(claudeTitle({ ...base, state: "missing", chosen: true })).toBe(
    "The chosen Claude Code is gone",
  );
  expect(claudeTitle({ ...base, state: "too-old", version: "2.1.200" })).toBe(
    "Claude Code 2.1.200 is too old",
  );
  expect(claudeTitle({ ...base, state: "broken" })).toBe("Claude Code does not answer");
});
