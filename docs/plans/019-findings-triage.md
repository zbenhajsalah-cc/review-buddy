# Plan 019: Findings — show them on the line, answer each one

**Status:** built, in two parts. Part 1 ("findings, read only"): steps 1–4, plus
the sidebar list, Overview counts and Markdown copy. Part 2 (the answers): steps
5–10.
**Size:** large.

## Why

In the post, AI review findings appear as inline comments, sorted by severity
and tagged **Important**, **Nit** or **Pre-existing**, and "every finding must
be answered: fix it, or resolve the thread with a reason."

Review Buddy today has no place for findings. If the dev ran `/code-review`
before `/review`, the results stay in the terminal and the reviewer reads the
diff without them.

**Scope line:** Review Buddy does not look for bugs. It accepts findings that
another tool made, shows them where they belong, and sends the reviewer's
answers back.

## What the reviewer gets

- A finding is shown **under its line** in the diff, like a line comment, with
  its own look and a severity tag.
- The chapter sidebar lists the chapter's findings. The Overview shows counts:
  "3 important · 5 nits · 1 pre-existing".
- Nits are folded by default. Pre-existing ones say clearly "not from this change".
- Each finding has two buttons: **Fix** and **Dismiss** (with a short reason).
- "Request changes" sends the **Fix** ones to the agent. Dismissed ones go too,
  with the reason, so the agent does not raise them again.
- Approving while important findings have no answer asks once: "2 important
  findings have no answer. Approve anyway?" It never blocks: blocking a merge is
  the project's policy, not ours.

## Design

### Agent contract

A new optional top-level field:

```json
"findings": [
  {
    "path": "src/cache.ts",
    "line": 42,
    "start_line": 40,
    "side": "new",
    "severity": "important",
    "title": "Cache key ignores the tenant id",
    "body": "Two tenants with the same user id share an entry. …",
    "source": "/code-review"
  }
]
```

- `severity`: `important` | `nit` | `pre_existing`.
- `side`: `new` (default) or `old`. `start_line` is optional, for a range.
- `title`: one line. `body`: Markdown, at most 1,000 characters.
- `source` (optional): the tool that found it.
- At most 50 findings.
- **No code text** in any field; the schema description says so. Path and line only.

### Skill text

- If this session has findings from `/code-review`, `/security-review` or
  another reviewer, pass them in `findings` with file and line.
- Do not search for bugs yourself in this step, and never invent a finding.
- A finding without a file and line is not a finding: leave it out.

### Resolution (`packages/core/src/resolve.ts`)

For each finding:

1. Find the file in the real diff (same lookup as chapters).
2. Find the chapter that has a resolved hunk covering the line → `chapterIndex`.
3. Line outside every hunk: attach to the first chapter with that file, with
   `outsideDiff: true`. The viewer shows it in the file header (and on the line
   after "Expand full file").
4. File not in the diff: keep it in a review-level list ("Other findings" on
   the Overview). This is normal for `pre_existing`.
5. Give each a stable id: a short hash of `path + title`. Rounds (plan 020) use it.

Result: `ResolvedReview.findings?: ResolvedFinding[]`.

### Viewer

- `FileDiffCard.tsx`: findings become `lineAnnotations`, next to comments. New
  `Finding.tsx` for the annotation body.
- `lib/findings.ts`: the answers, in localStorage per review
  (`rb.findings.<reviewKey>`), same pattern as `lib/comments.ts`.
- Sidebar list, Overview counts, keyboard: `n` / `p` jump to the next / previous
  open finding (add to `lib/shortcuts.ts`).
- `reviewMarkdown.ts`: findings and answers in the copy.

### Round-trip

- `DoneResult.findings?: { id, decision: "fix" | "dismiss", reason? }[]`;
  `parseDoneResult` checks it.
- `core/messages.ts`: `requestChangesMessage` and `approvalMessage` get a
  findings block:

  ```
  Findings to fix:
  - `src/cache.ts` line 42: Cache key ignores the tenant id
  Dismissed by the reviewer (do not raise again):
  - `src/a.ts` line 7: Unused import — "intentional, used by the codegen"
  ```

  Only location and title go back: the agent wrote the body. The block shares
  the existing 6,000-character cap; comments come first.

### Desktop

Findings are optional, so nothing breaks. The desktop agent has no bug finder
today; passing findings there is a later step.

## Steps

1. Schema, types, zod (see `README.md`, steps 1–3).
2. `resolve.ts`: the mapping above + tests for each of the 5 cases.
3. Viewer schema, fixtures with findings of each severity.
4. `Finding.tsx` annotation + `FileDiffCard` wiring + story.
5. `lib/findings.ts` (answers) + tests.
6. Sidebar list, Overview counts, shortcuts.
7. `DoneResult.findings`, `parseDoneResult`, messages + tests for the cap.
8. Approve-with-open-findings confirm.
9. Markdown copy.
10. Skill and prompt template, `pnpm gen:prompts`, contract doc, builds, `pnpm verify:ci`.

Steps 1–4 can ship first as "findings, read only". Steps 5–8 add the answers.

Part 1 notes (decided while building it):

- The sidebar list, the Overview counts and the Markdown copy are read only, so
  they shipped with part 1. The `n` / `p` shortcuts go with the answers ("open"
  findings only make sense once a finding can be answered).
- A finding outside the diff is listed under its file's header. It is not yet
  placed on its line in the "expand full file" view.
- A finding on a binary file is "outside the diff" (a binary file has no lines).
- Ids are FNV-1a (32 bits, hex) of `path + "\n" + title`: core is
  runtime-neutral and has no crypto.
- The desktop app's `submit_review` schema leaves `findings` out, like
  `verification`.

Part 2 notes (decided while building it):

- A dismissal needs a reason for an `important` finding, and not for a nit or a
  pre-existing one — the open question below, settled as proposed.
- The answers are keyed by finding id in `rb.findings.<reviewKey>`, and
  `clearReviewFileState` drops them with the viewed marks and the comments.
- The join from answer to finding happens in `POST /api/done`
  (`answeredFindings`), not in the browser: the agent is told the tool's own
  path, line and title, and the finding's body — which the agent wrote — never
  travels back. An id the review does not have is dropped, which is what a
  stale answer from an earlier round looks like.
- `answersToSend` already leaves such an answer behind, so the browser does not
  send what the server would only drop.
- The two blocks share the existing 6,000-character cap with the comments.
  Comments come first, but the answers keep up to a third of the room while
  they need it, so many long comments cannot swallow them; both blocks count
  what did not fit.
- Approving with an unanswered `important` finding reuses the check that
  already asks about unviewed files and dropped comments, rather than adding a
  second dialog.
- `n` / `p` walk the chapter's unanswered findings and wrap; with round-trip
  off they are not bound at all.
- The Overview answers the "other findings" (on files the diff does not touch):
  they belong to no chapter, so it is the only place they appear.
- The desktop app is unchanged: its round-trip is off and its `submit_review`
  has no `findings`, so its findings stay read only.

## Tests

- `resolve.test.ts`: in a hunk; outside hunks; file not in diff; file in two
  chapters; a renamed file found by its old path.
- `validate.test.ts`: the caps, the severity enum.
- `messages.test.ts`: block wording, the 6,000 cap with many findings.
- `FileDiffCard.test.tsx`: a finding and a comment on the same line both show.

## Not in this plan

- Hunting or voting on findings (the harness).
- Posting findings to GitHub as review comments.
- Blocking approval on open findings.

## Open questions

- ~~Should "Dismiss" need a reason?~~ **Settled:** needed for `important`, optional
  for the rest.
- With plan 020, a dismissed finding that comes back in the next round is
  hidden by its id. Without 020 it shows again. Accept this until 020 ships.
