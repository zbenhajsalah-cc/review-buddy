import { expect, test } from "bun:test";
import type { RepoSummary } from "../../shared/ipc.ts";
import { arrangeRepos, matchesQuery, timeAgo } from "./RepoList.tsx";

function repo(fullName: string, description: string | null = null): RepoSummary {
  const [owner, name] = fullName.split("/") as [string, string];
  return {
    fullName,
    owner,
    name,
    private: false,
    archived: false,
    fork: false,
    description,
    pushedAt: null,
  };
}

test("matchesQuery: every word, in the name or the description, any case", () => {
  const r = repo("octo-org/Widget-API", "Billing service");
  expect(matchesQuery(r, "widget")).toBe(true);
  expect(matchesQuery(r, "octo-org/widget")).toBe(true);
  expect(matchesQuery(r, "api billing")).toBe(true);
  expect(matchesQuery(r, "api payments")).toBe(false);
});

test("arrangeRepos: recent first, not twice, both filtered", () => {
  const all = [repo("a/one"), repo("a/two"), repo("b/three")];
  const recent = [repo("A/Two"), repo("c/elsewhere")];
  expect(arrangeRepos(all, recent, "")).toEqual({
    recent,
    others: [repo("a/one"), repo("b/three")],
  });
  expect(arrangeRepos(all, recent, " a/ ")).toEqual({
    recent: [repo("A/Two")],
    others: [repo("a/one")],
  });
  expect(arrangeRepos(all, recent, "zzz")).toEqual({ recent: [], others: [] });
});

test("timeAgo", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  expect(timeAgo("2026-10-27T11:59:30Z", now)).toBe("just now");
  expect(timeAgo("2026-10-27T11:15:00Z", now)).toBe("45 minutes ago");
  expect(timeAgo("2026-10-27T09:00:00Z", now)).toBe("3 hours ago");
  expect(timeAgo("2026-10-26T10:00:00Z", now)).toBe("yesterday");
  expect(timeAgo("2026-10-13T12:00:00Z", now)).toBe("2 weeks ago");
  expect(timeAgo("2026-06-27T12:00:00Z", now)).toBe("4 months ago");
  expect(timeAgo("2023-10-27T12:00:00Z", now)).toBe("3 years ago");
  expect(timeAgo("not a date", now)).toBe("");
});
