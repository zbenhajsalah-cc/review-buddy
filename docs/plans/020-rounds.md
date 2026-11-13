# Plan 020: Rounds — re-review only what changed

**Status:** shipped, in two parts. **Part 1 (steps 1–5):** the state that
survives a new port — `core/rounds.ts`, the round store, `ResolvedReview.round`,
`DoneResult.viewed`, and the viewed marks seeded on a re-review. **Part 2 (steps
6–10):** what the round looks like to the reviewer, and no repeats of a
dismissed finding. **Size:** large.

## Why

The post found that review loops waste the most time: one PR went through more
than fifty rounds. Their fixes were a round cap, **re-review of only the new
diff** after the first passes, and **no repeats**.

Review Buddy has the cap (3 re-submits, in the skill). It does not have the rest:

- After "Request changes", the agent re-submits and the reviewer sees the
  **whole** review again, with nothing to say what is new.
- Viewed marks are lost. Each submission starts a server on a new port, so the
  browser gives it a new localStorage (`docs/build-plan.md` lists this gap).
- The reviewer's own comments from the last round are gone, so they cannot
  check if each one was handled.

## What the reviewer gets

On the second submission of the same change:

- A **Round 2** badge in the header.
- Files that did not change since the last round are **already marked viewed**.
- Changed files have a "Changed since round 1" mark. A filter in the file list,
  **Only changed since last round**, is on by default.
- Chapter cards on the Overview say "2 of 7 files changed since last round".
- A **Previous round** list in the sidebar shows the last round's comments, read
  only. Each one says "lines changed since" or "lines not changed".
- After round 3, a banner: "This is round 4. Consider talking to the author
  about the approach instead of another round."

Words matter here: we say "lines changed", not "fixed". Review Buddy can see
that lines changed; only the reviewer can say the comment was handled.

## Design

### Where the state lives

localStorage cannot work across rounds (new port = new origin). So the
**server** keeps a small file per change:

- Folder: `~/.review-buddy/rounds/` (override: `REVIEW_BUDDY_STATE_DIR`).
- File name: SHA-256 of `repo root + source.type + source.ref`.
- Mode `0600`. Removed on approval. Files older than 14 days are removed when a
  session opens.

Content:

```json
{
  "round": 1,
  "files": { "src/a.ts": "<hash of the file's diff>" },
  "viewed": ["src/a.ts"],
  "comments": [ { "path": "…", "side": "new", "line": 12, "body": "…" } ],
  "dismissedFindings": ["<legacy per-submission finding id>"],
  "findingMemory": [
    { "key": "<path, title, side, code fingerprint>", "dismissed": true, "ambiguous": false }
  ]
}
```

- `files` holds **hashes only**, never diff text. No source code goes to this file.
- `viewed` is by path, not by chapter: the agent may group chapters in another
  way next round. A file counts as viewed when it was viewed in every chapter
  that showed it.
- `comments` is the reviewer's own text.

### Core (`packages/core/src/rounds.ts`, runtime-neutral)

Pure functions, no file access:

- `fileFingerprints(parsedDiff)` → `{ path: hash }`.
- `compareRounds(previous, current)` → for each path: `unchanged` | `changed` | `new`.
- `commentStatus(comment, previous, current)` → `lines_changed` | `lines_unchanged`.
  First version works per file (the file's hash differs or not). Per hunk is a later step.

Hashing in runtime-neutral code: a small FNV-1a string hash in core is enough
(this is change detection, not security).

### Plugin server

- New `apps/plugin/src/server/round-store.ts`: read, write, delete, clean up old files.
- `session.ts`: load the previous round, compare, and add to the review:

  ```ts
  ResolvedReview.round?: {
    number: number;
    changedPaths: string[];
    viewedPaths: string[];      // unchanged files viewed last round
    previousComments: (ReviewComment & { status: "lines_changed" | "lines_unchanged" })[];
  }
  ```

- `POST /api/done`: `DoneResult` gets `viewed?: string[]` (paths). On
  `request_changes` the server writes the file; on `approve` it deletes it.
- A failure to read or write the store must never stop a review: log to stderr
  and go on as round 1.

### Viewer

- `ReviewViewer.tsx`: when `round.viewedPaths` is there and this review has no
  stored viewed state yet, seed it.
- `ChapterReview.tsx`: the "changed" mark, the filter, the "Previous round" list.
- `Overview.tsx`: the round badge, per-chapter changed counts, the banner after round 3.
- Chapter index of an old comment may not exist now: the list shows comments by
  path and line, and a click goes to the first chapter that has the file.

### Findings (plan 019)

Finding ids distinguish occurrences only within one submission: same-path,
same-title findings get suffixes based on their order. They cannot identify a
dismissal across rounds. `findingMemory` instead records path, title, side and
a hash of the exact source-B lines under each finding, including undismissed
occurrences. The server suppresses only a unique match to a remembered dismissal.
Reordering, removing another finding or inserting lines before it leaves that
match intact. Indistinguishable duplicates remain visible, even if one later
disappears; edited ranges and ranges not fully present in the diff also remain
visible. The memory survives rounds where a finding is absent. Legacy state
with only `dismissedFindings` cannot safely suppress anything until a reviewer
dismisses the finding again; it still carries viewed marks and comments.

### Other modes

- Round-trip off, or standalone detached: no verdict, so no rounds. `round` is absent.
- Standalone blocking: same as the hook.
- Desktop: it keeps reviews per PR head already and has no agent loop. Out of
  scope; `round` stays absent.

## Steps

1. ~~`core/rounds.ts` + tests (fingerprints, compare, comment status).~~ Shipped.
2. ~~`round-store.ts` + tests in a temp folder (write, read, bad JSON, cleanup, mode).~~ Shipped.
3. ~~`session.ts` wiring + `ResolvedReview.round` + viewer schema + fixtures.~~ Shipped.
4. ~~`DoneResult.viewed`, `parseDoneResult`, write/delete on done + `http.test.ts`.~~ Shipped.
5. ~~Viewer: seed viewed state; test with `fakeReviewApi`.~~ Shipped.
6. ~~Viewer: badge, changed marks, filter, Overview counts.~~ Shipped.
7. ~~Viewer: "Previous round" list.~~ Shipped.
8. ~~Round banner after round 3.~~ Shipped.
9. ~~Findings: drop dismissed ids (only if 019 has shipped).~~ Shipped.
10. ~~Docs (`ARCHITECTURE.md`, `build-plan.md`: close the "persist viewed state"
    item), builds, `pnpm verify:ci`, `pnpm smoke:plugin`.~~ Shipped.

Steps 1–5 alone fix the lost viewed marks and can ship first — and did.

### What part 1 settled

- The server records the round through an **`onDone` callback** on the HTTP
  context, not by reaching for the filesystem from the request handler: the
  server module stays transport-only, and a state folder it cannot write to
  logs one line instead of costing the reviewer their verdict.
- There is **no `POST /api/file-viewed`**: `DoneResult.viewed` carries the
  paths with the verdict, which is enough for rounds, as the plan expected.
- `nextRoundState` unions the dismissed ids across rounds, so step 9's "no
  repeats" has its data already — only `resolveReview` has to read it.
- The fingerprints are per **file**, not per hunk, so `commentStatus` is per
  file too. A comment on a file no longer in the diff counts as
  `lines_changed`: what it pointed at is gone as well.
- A fingerprint has to include git's **`index` line** (now kept on
  `ParsedFile`): a binary file's bytes are not in the diff, so hunks alone
  hash two different images alike and the reviewer keeps a stale viewed mark.
  Where a diff carries neither content nor an index line — a pure mode change
  — there is nothing to compare, so the file is fingerprinted `UNCOMPARABLE`:
  a value that never equals anything, itself included, so the file stays in
  the comparison and reads as changed every round. Leaving it out of the map
  instead would drop it from `changedPaths` too, which part 2 reads.
- `/api/done` accepts **one** verdict and refuses later ones with 409. Before
  the round store that only dropped a second tab's result silently; now it
  would rewrite or clear what the first verdict stored.
- The round store is keyed by the repository's **top level**, not the cwd the
  hook was handed, or a re-review from a subdirectory would start over.

### What part 2 settled

- The "Previous round" list is in every chapter's sidebar and shows **all** of
  the last round's comments, not only the ones on this chapter's files: the
  chapter numbers are last round's, and the agent may have regrouped. A click
  opens the file in this chapter when it has it, else in the first chapter
  that does (`firstChapterWith`). A comment on a file that is gone from the
  diff says "file gone" and cannot be opened.
- The Overview carries a **round summary** instead of a second list: how many
  files changed, what became of the comments ("1 on lines that changed since,
  1 on lines that did not change"), how many dismissed findings are left out,
  and the banner from round 4 on (`MANY_ROUNDS`: the skill caps re-submits at
  3, so round 4 is the last one the agent sends).
- **Only changed since last round** is on by default and is plain component
  state, not a cookie: it means something only inside one chain of rounds.
  Like "Hide viewed files", it never hides the file a link or the sidebar just
  opened. A chapter with no changed file says so and offers "Show all files".
- **No repeats** happens in the plugin (`applyRound` in `session.ts`), not in
  `resolveReview`: the dismissed ids live in the round store, which core does
  not read. `round.hiddenFindings` tells the reviewer how many were left out.
- The open question about **worktree** keys is answered as proposed: a
  worktree diff that shares no path with the stored round starts at round 1
  (`sharesAnyPath`); an approval already deleted the state. PR and branch
  reviews keep their chain whatever their paths.

## Tests

- Round 2 with one changed file: that file is not viewed, the others are.
- A file viewed in one of its two chapters only is **not** carried over.
- Changing the base or PR ref starts at round 1 (other key).
- Store folder not writable: review opens as round 1, one line on stderr.
- Approve deletes the file.

## Not in this plan

- A diff **between rounds** (round 1 version vs round 2 version of a file). It
  needs the old bytes on disk. The "changed" mark plus the normal diff is the
  first version.
- The server-side `POST /api/file-viewed` from the old Phase 2 list. Saving at
  Done is enough for rounds. A browser reload inside a round still uses localStorage.

## Open questions

- ~~Worktree reviews have no ref, so every worktree review of one repo shares one
  key.~~ Answered in part 2: a worktree diff with no path in common with the last
  round starts at round 1, and an approval always ends the chain.
- Should the reviewer be able to say "start again from round 1"? Proposed: a
  small "Reset rounds" action in the round badge menu. Not built: it needs a new
  endpoint, and turning off the "Only changed" filter already shows everything.
  Left for when someone asks for it.
