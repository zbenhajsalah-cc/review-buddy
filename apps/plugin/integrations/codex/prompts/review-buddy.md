# Review Buddy — structuring agent

Turn the current working-tree diff (or a GitHub PR / branch) into a narrative
code review — a Prologue plus risk-rated, theme-grouped Chapters — and open it
in the reviewer's browser via the `review-buddy` MCP server's `submit_review`
tool.

You provide **judgment and structure**; git provides the bytes. This is
load-bearing: you REFERENCE the diff by hunk anchors — you never reproduce diff
line content.

## Step 0 — Gather the diff

First run `git rev-parse --show-toplevel` and remember the absolute repo root —
you will pass it as `cwd` in Step 4 (the tool runs outside your shell and must
know where the repo is).

Review target: `$ARGUMENTS` (empty = the local working tree). **Remember
which**, because in Step 4 you must tell the tool via `source` so it
re-captures the *same* diff (the tool only sees your `submit_review` payload):

- **Nothing specified** → review the local working tree; `source = { "type": "worktree" }`. Run:
  - `git diff HEAD` — tracked changes, staged and unstaged (the tool captures the same, so your
    anchors line up; plain `git diff` leaves out staged changes). In a repo with no commits yet,
    run `git diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904` (git's empty tree) instead — every
    file is new.
  - `git status --short` — note any untracked files (new files the diff above may not show)
  - For each untracked file you intend to include, `git diff --no-index -- /dev/null <file>` to see it as a new-file diff.
- **A PR number or URL** → `source = { "type": "pr", "ref": "<arg>" }`. Run `gh pr diff <arg>`
  and `gh pr view <arg>` for the diff and metadata. **The `ref` is load-bearing** — the tool
  runs `gh pr diff <ref>` to get the authoritative hunks; without it the viewer is empty.
- **A base branch/ref** (e.g. reviewing a whole branch vs `main`) → `source = { "type": "branch", "ref": "<base>" }`.
  Run `git diff <base>` for the diff; the tool re-captures with the same base.

Read **every** hunk. Each hunk header is `@@ -old_start,old_count +new_start,new_count @@` — the
`old_start` / `new_start` are the anchors you will reference.

## Step 1 — Analyze

- The overall intent: the problem being solved and the fix.
- For each change: what it does functionally and why it was needed.
- Logical groupings: which files/hunks belong together because they solve the same
  sub-problem. **Group by theme/behavior, NOT by file or directory.**
- Risk per group: blast radius, likelihood of regression, null-safety / edge-case
  handling, and how central the touched code is.

## Step 2 — Prologue

- **why**: the user-facing problem or bug, in plain language.
- **what**: the resolution in 1–2 sentences.
- **key_changes**: 2–5 bullets, each a short bold `headline` + one explanatory `detail`
  (e.g. what safe default is used).
- **review_focus**: the single riskiest/subtlest area, phrased as a concrete check, plus
  the specific `file` to scrutinize.

Write for a reviewer who has NOT seen the code yet.

## Step 3 — Chapters

Ordered, most foundational/highest-risk first. For each chapter:

- **title**: an action-oriented phrase (e.g. "Guard sport selectors against null user dereference").
- **risk**: `Low` | `Medium` | `High` + a one-line `risk_reason`.
- **description**: 2–4 sentences — what it changes, the technique, and what the reviewer
  should verify. Reference relevant symbols by name.
- **files**: for each file, list the **hunk anchors** (`old_start`, `new_start` from the
  `@@` headers) that belong to this chapter. If EVERY hunk of a file belongs to this
  chapter, **omit** the `hunks` array (means "the whole file"). A file MAY appear in
  multiple chapters with different anchors.

The tool automatically sets aside generated artifacts (lockfiles, minified bundles,
source maps, snapshots, images, fonts) into a separate chapter. Don't spend chapters or
analysis on them — skip them when grouping, and don't count them in your narrative.

## Critical rules

- **Prose renders as markdown.** Every prose field (`why`, `what`, each `detail`,
  `review_focus.summary`, chapter `description` / `risk_reason`) is rendered with GFM.
  Use light inline markdown where it aids scanning — **bold**, `` `code` `` / symbol names,
  links, and short lists. Keep it readable; don't over-format.
- **Reference, don't reproduce.** Never copy `+`/`-`/context lines into your output. Emit
  anchors only; the tool attaches the authoritative lines from git.
- **Never invent changes.** Every claim must trace to a real hunk.
- **Stats are advisory.** Do not stress over exact additions/deletions — the tool recomputes
  authoritative numbers from the real diff. You may omit them.

## Step 4 — Submit

Call the **`submit_review`** tool on the `review-buddy` MCP server with
`{ cwd, source, prologue, chapters }` — `cwd` is the absolute repo root from
Step 0, and `source` is what you determined there (`worktree` / `pr` /
`branch`). For a PR, `source` is REQUIRED — omitting it makes the tool fall
back to the local working tree, and the viewer shows an empty diff.

The tool opens the review in the reviewer's browser and returns its URL
immediately. Relay the URL to the user (in case no browser window opened) and
finish — the reviewer walks through it at their own pace; no verdict comes
back to you.

If the tool returns an error (invalid payload, repo not found), fix exactly
what it names and call it again.

### If the tool returns a verdict instead of a URL (blocking mode)

When the server is registered with `--standalone=blocking`, the tool holds
the turn until the reviewer finishes and returns their verdict, with their
note and line comments. Each comment names a file and lines, like
`` `src/a.ts` lines 10-14 (new): … `` — `(new)` is a line number in the
changed version of the file, `(old)` one in the base version.

If it reports **"Reviewer requested changes"**, read the note and the comments
as review feedback, make the requested edits, then call `submit_review` again
with the same `source` and `cwd`. Acknowledge what you changed between
submissions. Re-submit at most **3 times**; if the reviewer still requests
changes, stop and ask the human directly rather than looping.

If the reviewer approved with comments, answer their questions and make the
small fixes they ask for; do not call `submit_review` again unless the user
asks.
