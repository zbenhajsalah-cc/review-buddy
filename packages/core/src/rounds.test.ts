import { expect, test } from "bun:test";
import type { ParsedFile } from "./diff.ts";
import {
  commentStatus,
  compareRounds,
  fileFingerprints,
  findingIdentities,
  nextRoundState,
  parseRoundState,
  type RoundState,
  rememberFindings,
  roundInfo,
  sharesAnyPath,
  UNCOMPARABLE,
  withoutDismissed,
} from "./rounds.ts";
import type { ResolvedFinding, ReviewComment } from "./types.ts";

const file = (over: Partial<ParsedFile> = {}): ParsedFile => ({
  path: "src/a.ts",
  changeType: "modified",
  binary: false,
  additions: 1,
  deletions: 0,
  hunks: [
    {
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      header: "@@ -1,2 +1,3 @@",
      lines: [" ctx", "+added"],
      additions: 1,
      deletions: 0,
      claimedBy: -1,
    },
  ],
  ...over,
});

test("fileFingerprints: one hash per path, and no diff text in it", () => {
  const prints = fileFingerprints([file(), file({ path: "src/b.ts" })]);
  expect(Object.keys(prints)).toEqual(["src/a.ts", "src/b.ts"]);
  for (const hash of Object.values(prints)) expect(hash).toMatch(/^[0-9a-f]{8}$/);
  // Same content, same hash — the path is not part of it, the diff is.
  expect(prints["src/a.ts"]).toBe(prints["src/b.ts"]);
  expect(JSON.stringify(prints)).not.toContain("added");
});

test("fileFingerprints: a changed line, a changed anchor and a changed type all show", () => {
  const base = fileFingerprints([file()])["src/a.ts"];
  const lines = fileFingerprints([
    file({ hunks: [{ ...file().hunks[0]!, lines: [" ctx", "+other"] }] }),
  ])["src/a.ts"];
  const header = fileFingerprints([
    file({ hunks: [{ ...file().hunks[0]!, header: "@@ -9,2 +9,3 @@" }] }),
  ])["src/a.ts"];
  const added = fileFingerprints([file({ changeType: "added" })])["src/a.ts"];
  expect(new Set([base, lines, header, added]).size).toBe(4);
});

test("compareRounds: unchanged, changed, new — and gone files are simply absent", () => {
  expect(
    compareRounds(
      { "src/a.ts": "aaaa", "src/b.ts": "bbbb", "src/gone.ts": "cccc" },
      { "src/a.ts": "aaaa", "src/b.ts": "dddd", "src/new.ts": "eeee" },
    ),
  ).toEqual({ "src/a.ts": "unchanged", "src/b.ts": "changed", "src/new.ts": "new" });
  // No previous round: everything is new.
  expect(compareRounds(undefined, { "src/a.ts": "aaaa" })).toEqual({ "src/a.ts": "new" });
});

test("commentStatus: only an untouched file counts as lines_unchanged", () => {
  const changes = { "src/a.ts": "unchanged", "src/b.ts": "changed" } as const;
  expect(commentStatus({ path: "src/a.ts" }, changes)).toBe("lines_unchanged");
  expect(commentStatus({ path: "src/b.ts" }, changes)).toBe("lines_changed");
  // A file no longer in the diff: what the comment pointed at is gone too.
  expect(commentStatus({ path: "src/gone.ts" }, changes)).toBe("lines_changed");
});

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  chapterIndex: 0,
  path: "src/a.ts",
  side: "new",
  line: 12,
  body: "Why?",
  ...over,
});

const stored = (over: Partial<RoundState> = {}): RoundState => ({
  round: 1,
  files: { "src/a.ts": "aaaa", "src/b.ts": "bbbb" },
  viewed: ["src/a.ts", "src/b.ts"],
  comments: [comment(), comment({ path: "src/b.ts", line: 3 })],
  dismissedFindings: ["f1"],
  ...over,
});

const binary = (over: Partial<ParsedFile> = {}): ParsedFile => ({
  path: "assets/logo.png",
  changeType: "modified",
  binary: true,
  additions: 0,
  deletions: 0,
  hunks: [],
  index: "aaaaaaa..bbbbbbb 100644",
  ...over,
});

test("fileFingerprints: a binary file's new bytes show, through git's index line", () => {
  // A binary diff carries no content, so the index line is the only thing that
  // tells the two versions apart. Without it the reviewer would keep a viewed
  // mark on an image that changed.
  const before = fileFingerprints([binary()])["assets/logo.png"];
  const after = fileFingerprints([binary({ index: "aaaaaaa..ccccccc 100644" })])["assets/logo.png"];
  expect(before).toBeDefined();
  expect(after).not.toBe(before);
  expect(
    roundInfo(stored({ files: { "assets/logo.png": before! }, viewed: ["assets/logo.png"] }), {
      "assets/logo.png": after!,
    }),
  ).toMatchObject({ changedPaths: ["assets/logo.png"], viewedPaths: [] });
});

test("fileFingerprints: a mode-only change is uncomparable, so it reads as changed", () => {
  // git emits no index line for a pure mode change and no hunks either, so
  // there is nothing in the diff to tell the two versions apart.
  const prints = fileFingerprints([binary({ path: "run.sh", binary: false, index: undefined })]);
  expect(prints).toEqual({ "run.sh": UNCOMPARABLE });

  // It is in the diff, so it is listed as changed — and it never keeps a
  // viewed mark, not even when both rounds are equally uncomparable.
  const info = roundInfo(
    stored({ files: { "run.sh": UNCOMPARABLE }, viewed: ["run.sh"], comments: [] }),
    prints,
  );
  expect(info?.changedPaths).toEqual(["run.sh"]);
  expect(info?.viewedPaths).toEqual([]);
  expect(commentStatus({ path: "run.sh" }, compareRounds(prints, prints))).toBe("lines_changed");
});

test("fileFingerprints: a text file is identified by its hunks, index line or not", () => {
  const withIndex = fileFingerprints([file({ index: "111..222 100644" })])["src/a.ts"];
  const without = fileFingerprints([file()])["src/a.ts"];
  expect(withIndex).toBeDefined();
  expect(without).toBeDefined();
  expect(withIndex).not.toBe(without);
});

test("roundInfo: no previous round → no rounds at all", () => {
  expect(roundInfo(undefined, { "src/a.ts": "aaaa" })).toBeUndefined();
});

test("roundInfo: round 2 carries over the viewed mark of the untouched file only", () => {
  const info = roundInfo(stored(), { "src/a.ts": "aaaa", "src/b.ts": "zzzz" });
  expect(info).toEqual({
    number: 2,
    changedPaths: ["src/b.ts"],
    viewedPaths: ["src/a.ts"],
    previousComments: [
      { ...comment(), status: "lines_unchanged" },
      { ...comment({ path: "src/b.ts", line: 3 }), status: "lines_changed" },
    ],
  });
});

test("roundInfo: a new file is changed work, and the round number keeps climbing", () => {
  const info = roundInfo(stored({ round: 3 }), {
    "src/a.ts": "aaaa",
    "src/b.ts": "bbbb",
    "src/c.ts": "cccc",
  });
  expect(info?.number).toBe(4);
  expect(info?.changedPaths).toEqual(["src/c.ts"]);
  expect(info?.viewedPaths).toEqual(["src/a.ts", "src/b.ts"]);
});

test("nextRoundState: numbers the round that just happened and keeps dismissals", () => {
  const current = { "src/a.ts": "aaaa", "src/b.ts": "zzzz" };
  const previous = stored();
  const info = roundInfo(previous, current);
  const next = nextRoundState(
    info,
    current,
    { viewed: ["src/a.ts", "src/a.ts"], comments: [comment({ body: "again" })], dismissed: ["f2"] },
    previous,
  );
  expect(next.round).toBe(2);
  expect(next.files).toEqual(current);
  expect(next.viewed).toEqual(["src/a.ts"]); // deduplicated
  expect(next.comments).toEqual([comment({ body: "again" })]);
  expect(next.dismissedFindings).toEqual(["f1", "f2"]); // round 1's dismissal stands
});

test("nextRoundState: a first round with nothing sent is still a round 1 to build on", () => {
  expect(nextRoundState(undefined, { "src/a.ts": "aaaa" }, {})).toEqual({
    round: 1,
    files: { "src/a.ts": "aaaa" },
    viewed: [],
    comments: [],
    dismissedFindings: [],
  });
});

test("parseRoundState: a state it wrote itself comes back whole", () => {
  const state = stored({ round: 2 });
  expect(parseRoundState(JSON.parse(JSON.stringify(state)))).toEqual(state);
});

test("parseRoundState: anything malformed is no round at all", () => {
  expect(parseRoundState(undefined)).toBeUndefined();
  expect(parseRoundState("{}")).toBeUndefined();
  expect(parseRoundState({ files: {} })).toBeUndefined(); // no round number
  expect(parseRoundState({ round: 0, files: {} })).toBeUndefined();
  expect(parseRoundState({ round: 1 })).toBeUndefined(); // no files
});

test("parseRoundState: junk inside a well-formed state is dropped, not kept", () => {
  expect(
    parseRoundState({
      round: 2.7,
      files: { "src/a.ts": "aaaa", "src/b.ts": 42 },
      viewed: ["src/a.ts", 7, null],
      comments: [comment(), { path: "src/a.ts" }, "nope"],
      dismissedFindings: "f1",
      somethingElse: "ignored",
    }),
  ).toEqual({
    round: 2,
    files: { "src/a.ts": "aaaa" },
    viewed: ["src/a.ts"],
    comments: [comment()],
    dismissedFindings: [],
  });
});

test("sharesAnyPath: one path in common is the same change; none is another", () => {
  const previous: RoundState = {
    round: 1,
    files: { "src/a.ts": "1", "src/b.ts": "2" },
    viewed: [],
    comments: [],
    dismissedFindings: [],
  };
  expect(sharesAnyPath(previous, { "src/b.ts": "9", "src/c.ts": "3" })).toBe(true);
  expect(sharesAnyPath(previous, { "docs/x.md": "4" })).toBe(false);
  expect(sharesAnyPath(previous, {})).toBe(false);
});

test("withoutDismissed: matches code identities, not occurrence ids", () => {
  const finding = (id: string): ResolvedFinding => ({
    id,
    path: "src/a.ts",
    line: 1,
    side: "new",
    severity: "nit",
    title: id,
  });
  const all = [finding("f-1"), finding("f-2"), finding("f-3")];
  const identities = findingIdentities(all, [file()]);
  const memory = rememberFindings(identities, ["f-2", "f-9"]);
  expect(withoutDismissed(all, identities, memory)).toEqual({
    findings: [finding("f-1"), finding("f-3")],
    hidden: 1,
  });
  expect(withoutDismissed(all, identities, [])).toEqual({ findings: all, hidden: 0 });
  expect(withoutDismissed(undefined, [], memory)).toEqual({ findings: [], hidden: 0 });
});

const findingFile = (lines: string[]): ParsedFile =>
  file({
    hunks: [
      {
        ...file().hunks[0]!,
        newStart: 1,
        newLines: lines.length,
        lines: lines.map((l) => `+${l}`),
      },
    ],
  });
const occurrences = (lines: number[]): ResolvedFinding[] =>
  lines.map((line, i) => ({
    id: i === 0 ? "f-same" : `f-same-${i + 1}`,
    path: "src/a.ts",
    title: "Missing error handling",
    severity: "important",
    side: "new",
    line,
  }));

for (const dismissed of [1, 2]) {
  for (const survivor of [1, 2]) {
    test(`dismissed occurrence ${dismissed}, only occurrence ${survivor} survives`, () => {
      const files = [findingFile(["firstOperation();", "secondOperation();"])];
      const before = occurrences([1, 2]);
      const memory = rememberFindings(findingIdentities(before, files), [
        before[dismissed - 1]!.id,
      ]);
      const after = occurrences([survivor]);
      expect(withoutDismissed(after, findingIdentities(after, files), memory)).toEqual({
        findings: survivor === dismissed ? [] : after,
        hidden: survivor === dismissed ? 1 : 0,
      });
    });
  }

  test(`reordering duplicates preserves dismissal of occurrence ${dismissed}`, () => {
    const files = [findingFile(["firstOperation();", "secondOperation();"])];
    const before = occurrences([1, 2]);
    const memory = rememberFindings(findingIdentities(before, files), [before[dismissed - 1]!.id]);
    const after = occurrences([2, 1]);
    expect(
      withoutDismissed(after, findingIdentities(after, files), memory).findings.map((f) => f.line),
    ).toEqual([dismissed === 1 ? 2 : 1]);
  });
}

test("code identities survive inserted lines and an absent intermediate round", () => {
  const before = occurrences([1, 2]);
  const files = [findingFile(["firstOperation();", "secondOperation();"])];
  const first = nextRoundState(
    undefined,
    {},
    {
      identities: findingIdentities(before, files),
      dismissed: [before[1]!.id],
    },
  );
  const gap = nextRoundState(undefined, {}, {}, parseRoundState(JSON.parse(JSON.stringify(first))));
  const shifted = occurrences([4]);
  const shiftedFiles = [
    findingFile(["inserted();", "another();", "firstOperation();", "secondOperation();"]),
  ];
  expect(
    withoutDismissed(shifted, findingIdentities(shifted, shiftedFiles), gap.findingMemory!),
  ).toEqual({ findings: [], hidden: 1 });
  expect(JSON.stringify(first)).not.toContain("secondOperation");
});

test("indistinguishable occurrences stay visible even after one disappears", () => {
  const files = [findingFile(["sameOperation();", "sameOperation();"])];
  for (const dismissed of [0, 1]) {
    const before = occurrences([1, 2]);
    const memory = rememberFindings(findingIdentities(before, files), [before[dismissed]!.id]);
    const after = occurrences([2]);
    expect(withoutDismissed(after, findingIdentities(after, files), memory)).toEqual({
      findings: after,
      hidden: 0,
    });
  }
  // A new ambiguity also prevents hiding either current occurrence.
  const single = occurrences([1]);
  const memory = rememberFindings(findingIdentities(single, files), [single[0]!.id]);
  const both = occurrences([1, 2]);
  expect(withoutDismissed(both, findingIdentities(both, files), memory)).toEqual({
    findings: both,
    hidden: 0,
  });
});

test("edited, missing or partially available code cannot inherit a dismissal", () => {
  const before = occurrences([1]);
  const files = [findingFile(["oldOperation();"])];
  const memory = rememberFindings(findingIdentities(before, files), [before[0]!.id]);
  for (const changedFiles of [[], [findingFile(["newOperation();"])]]) {
    expect(withoutDismissed(before, findingIdentities(before, changedFiles), memory)).toEqual({
      findings: before,
      hidden: 0,
    });
  }
  const range = [{ ...before[0]!, start_line: 1, line: 2 }];
  expect(findingIdentities(range, files)).toEqual([]);
  // Old versions saved only ids; those cannot establish occurrence identity.
  expect(
    withoutDismissed(before, findingIdentities(before, files), stored().findingMemory ?? []),
  ).toEqual({ findings: before, hidden: 0 });
});

test("code identities distinguish sides and fingerprint entire ranges", () => {
  const files = [
    file({ hunks: [{ ...file().hunks[0]!, lines: [" ctx", "-old", "+added", "+last"] }] }),
  ];
  const findings = [
    { ...occurrences([2])[0]!, side: "old" as const },
    occurrences([2])[0]!,
    { ...occurrences([3])[0]!, start_line: 2 },
  ];
  const identities = findingIdentities(findings, files);
  expect(identities).toHaveLength(3);
  expect(new Set(identities.map((f) => f.key)).size).toBe(3);
  expect(JSON.stringify(identities)).not.toContain("added");
});

test("parseRoundState: invalid finding memory cannot enable suppression", () => {
  const parsed = parseRoundState({
    ...stored(),
    findingMemory: [
      { key: "good", dismissed: true, ambiguous: false, ignored: "drop" },
      { key: "missing-ambiguity", dismissed: true },
      { key: "wrong-flag", dismissed: "true", ambiguous: false },
      null,
    ],
  });
  expect(parsed?.findingMemory).toEqual([{ key: "good", dismissed: true, ambiguous: false }]);
});
