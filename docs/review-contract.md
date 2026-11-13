# Review Contract

Two distinct shapes. Don't conflate them.

1. **Agent contract** — what the agent emits via `submit_review`. Narrative + grouping + hunk *anchors*. Validated by `packages/core/schemas/review.schema.json`. No diff line content.
2. **UI/server contract** — what `GET /api/review` returns to the React app. The agent JSON **merged** with the real diff (B), full-file capability (C), PR metadata, server `meta`, and tool-computed stats. Hunks here are **resolved** (real line content attached).

Types for both live in `packages/core/src/types.ts`.

---

## 1. Agent contract (`submit_review` input)

```jsonc
{
  "source": { "type": "pr", "ref": "42" },  // what to re-capture; omit ⇒ working tree
  "prologue": {
    "why": "Users on the free tier saw a blank dashboard when no sport was selected.",
    "what": "Adds null-safe sport selectors with a sensible default and redirect.",
    "key_changes": [
      { "headline": "Null-safe sport lookup", "detail": "Falls back to the first available sport instead of dereferencing undefined." }
    ],
    "review_focus": {
      "summary": "Confirm the fallback default triggers the expected onboarding redirect, not a silent empty state.",
      "file": "src/dashboard/useSport.ts"
    },
    // optional, at most 3 — most reviews omit it
    "open_questions": [
      { "question": "The task was the null check, but the diff also renames 14 files. Should the rename be its own change?",
        "context": "The PR description only mentions the blank dashboard." }
    ]
  },
  // optional — the checks the agent ran in its session (not in the desktop app)
  "verification": {
    "checks": [
      { "command": "pnpm test", "status": "passed", "summary": "214 tests passed" },
      { "command": "pnpm e2e", "status": "not_run" }
    ],
    "not_covered": "The redirect was not tried in a browser."
  },
  // optional — findings that ANOTHER tool made (not in the desktop app), at most 50
  "findings": [
    { "path": "src/dashboard/useSport.ts", "line": 14, "start_line": 13, "side": "new",
      "severity": "important", "title": "The default sport hides a logged-out user",
      "body": "With no user, `sports[0]` is returned instead of a redirect.", "source": "/code-review" }
  ],
  "chapters": [
    {
      "index": 1,
      "title": "Guard sport selectors against null user dereference",
      "risk": "High",
      "risk_reason": "Central hook used by every dashboard route.",
      "additions": 24,          // advisory — tool recomputes
      "deletions": 6,           // advisory — tool recomputes
      "description": "Wraps user.sport access in a null-safe selector and defaults to the first sport. Verify the default cannot mask an unauthenticated state.",
      "files": [
        {
          "path": "src/dashboard/useSport.ts",
          "change_type": "modified",
          "hunks": [ { "old_start": 12, "new_start": 12 }, { "old_start": 40, "new_start": 42 } ]
        },
        {
          "path": "src/dashboard/SportPicker.tsx",
          "change_type": "modified"
          // hunks omitted ⇒ the whole file belongs to this chapter
        }
      ]
    }
  ]
}
```

**Rules**
- `source` tells the hook which diff to re-capture, since it never sees `/review`'s arguments: `{ "type": "worktree" }` (default — uncommitted vs HEAD), `{ "type": "pr", "ref": "<n|url>" }` (hook runs `gh pr diff <ref>`), or `{ "type": "branch", "ref": "<base>" }` (hook runs `git diff <ref>`). **Required for PR/branch reviews** — omitting it makes the hook fall back to the local working tree and the viewer renders an empty diff.
- `hunks` entries are anchors only (`old_start`, `new_start`) — match the `@@` header numbers from the diff the agent was given.
- Omit `hunks` for a file ⇒ "all hunks of this file belong here."
- A file may appear in multiple chapters with different hunk anchors.
- Stats are advisory; never trusted for display.
- `prologue.open_questions` (optional, 0–3 items, each `{ question, context? }`) holds scope or direction questions ("should we even do this?"). The viewer shows them first, in a "Before you read the code" card; with round-trip on, "Raise with the agent" starts the request-changes note with the question. They pass through `resolveReview` untouched. Like every field, they never hold diff or file text.
- `verification` (optional) holds the checks the agent ran **in its session, after its last edit**: `checks` (0–20 items, each `{ command, status, summary? }`, `status` = `passed` | `failed` | `not_run`, `summary` at most 200 characters, never pasted output) and `not_covered` (Markdown: what those checks would miss). The agent does not run new commands for it. The viewer shows it in the **Evidence** card under "Reported by the agent", failed first, because it is not proof. It passes through `resolveReview` untouched. The desktop app's agent has no shell, so its `submit_review` schema leaves this field out.
- `findings` (optional, 0–50 items) holds findings that **another tool** made in the session (`/code-review`, `/security-review`, a CI reviewer). Each is `{ path, line, start_line?, side?, severity, title, body?, source? }`: `side` = `new` (default) | `old`; `start_line` ≤ `line`, only for a range; `severity` = `important` | `nit` | `pre_existing`; `title` one line (at most 200 characters); `body` Markdown (at most 1,000); `source` names the tool. Path and line only — never code text. The agent does not search for bugs for this field and never invents one. The desktop app's schema leaves it out (no other reviewer runs there yet).

## 2. UI/server contract (`GET /api/review` output)

```jsonc
{
  "meta": {
    "aiGenerated": true,
    "generatedBy": "claude-opus-4-8",   // server fills from the SDK/session
    "generatedAt": "2026-06-16T12:00:00Z",
    "promptVersion": "1"
  },
  "pr": {                                // source B (gh / git) — NOT from the agent
    "title": "Fix blank dashboard for users with no sport",
    "description": "<author's original PR body, markdown>",
    "author": "alice",
    "createdAt": "2026-06-15T09:00:00Z",
    "base": "main",
    "head": "fix/null-sport",
    "url": "https://github.com/acme/app/pull/123",   // optional
    "headRefOid": "7e8e705…",                          // optional: the PR's head commit
    "ciStatus": "1 failed, 12 passed",                 // optional: short summary of `checks`
    "checksIncomplete": true,                          // optional: some checks could not be read
    "checks": [                                        // optional: CI of headRefOid, failed first, never cut
      { "name": "CI / test (windows)", "status": "failed",
        "url": "https://github.com/acme/app/actions/runs/1/job/3" },
      { "name": "CI / lint", "status": "passed" }
    ]
  },
  "prologue": { /* same as agent contract */ },
  "verification": { /* same as agent contract; absent when the agent sent none */ },
  "findings": [                          // absent when the agent sent none
    { "id": "f-3fa1c2d9",                // per submission: hash of path + title, occurrence suffixes for duplicates
      "path": "src/dashboard/useSport.ts", // the diff's path (new path of a renamed file)
      "line": 14, "start_line": 13, "side": "new",
      "severity": "important", "title": "…", "body": "…", "source": "/code-review",
      "chapterIndex": 1                  // absent: the file is not in the diff
      // "outsideDiff": true             // the line is outside the hunks that chapter shows
    }
  ],
  "moves": [                             // absent when the tool found none
    { "id": "m1", "kind": "moved",       // "copied": the same removed block also went to an earlier place
      "from": { "path": "src/cart.ts", "start": 10, "lines": 31, "chapterIndex": 2 },  // old line numbers
      "to":   { "path": "src/money.ts", "start": 4, "lines": 31, "chapterIndex": 1 }   // new line numbers
      // "whitespaceChanged": true       // NOT identical: the ends match only with leading/trailing whitespace ignored
    }
  ],
  "stats": { "additions": 124, "deletions": 31, "filesChanged": 7 },  // tool-computed
  "chapters": [
    {
      "index": 1,
      "title": "Guard sport selectors against null user dereference",
      "risk": "High",
      "risk_reason": "Central hook used by every dashboard route.",
      "additions": 24,        // tool-computed (authoritative)
      "deletions": 6,
      "fileCount": 2,
      "description": "…",
      "files": [
        {
          "path": "src/dashboard/useSport.ts",
          "change_type": "modified",
          "additions": 18,
          "deletions": 4,
          "language": "typescript",            // derived from extension
          "hunks": [
            {
              "old_start": 12, "old_lines": 6,
              "new_start": 12, "new_lines": 9,
              "header": "@@ -12,6 +12,9 @@ export function useSport() {",
              "lines": [                          // RESOLVED from real git diff (B)
                "   const user = useUser();",
                "-  return user.sport;",
                "+  return user?.sport ?? sports[0];"
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**Resolution step (server-side):**
1. Run `git diff <base>...<head>` (or working-tree diff) → parse into `files[] → hunks[]` with exact headers + line content.
2. For each agent chapter file, attach the real hunks whose anchors match (`path` + `old_start`/`new_start`). Omitted `hunks` ⇒ attach all of that file's hunks.
3. Recompute `additions`/`deletions` per file, per chapter, and overall.
4. Any real hunk not claimed by any chapter ⇒ append to a synthetic `"Unsorted changes"` chapter and log it (never drop changes).
5. Attach `meta` and `pr` (B), derive `language` per file.

**Findings.** After the chapters (and the "Unsorted" and noise chapters) are built, each finding is placed: its file is matched by path EXACTLY (the head path, or a renamed file's old path) — never by basename like a chapter file, because a finding carries another tool's own path and a same-named untouched file must not be rewritten onto a changed one; it goes to the chapter whose resolved hunk shows its `line` on its `side`; else to the first chapter with the file, with `outsideDiff: true` (the viewer lists it under the file header); else, when the file is not in the diff, it has no `chapterIndex` and the Overview lists it under "Other findings". In the chapters, a finding shows under its line like a line comment, with a severity tag; nits are folded; the sidebar lists the chapter's findings; the Overview shows the counts.

**Moved code.** The tool — never the agent — looks in the real diff for blocks of lines that were removed in one place and added in another, unchanged (`core/moves.ts`: lines compared trimmed, at least 3 lines with text and 40 characters, binary and noise files left out, a block re-indented in place is not a move). Each is two line ranges, no code text; `resolveReview` gives each end the chapter whose hunk shows it. The first place a removed block went is `moved`; one more place is `copied`. A match that is not exact carries `whitespaceChanged`: trimming finds the block, but leading spaces are part of a multiline string's value and of Python or YAML structure, so the viewer says "not identical … check it" and never "only the indentation changed". The viewer puts a note under the last line of each end, with a jump to the other end (also across chapters, to the block itself). Nothing about moves is in `submit_review`. See docs/plans/022-move-detection.md.

**Rounds.** With round-trip on, the verdict also carries the paths the reviewer marked viewed (`DoneResult.viewed`), and a re-review of the same change carries `ResolvedReview.round` — the round number, the paths whose diff differs from the previous round's, the paths the agent has not touched (marked viewed again for the reviewer), the previous round's comments with whether their lines changed, and `hiddenFindings` — how many findings were left out because the reviewer dismissed them in an earlier round (their ids are kept in the round store; a finding's id is a hash of its path and title, so the same finding raised again is recognised). The server holds this between rounds in a small file per change, with a fingerprint per file and never any diff text: the reference-not-reproduce rule holds across rounds too. Nothing of it is the agent's to send — `round` is computed by the tool, and an approval ends the chain. See docs/ARCHITECTURE.md "Rounds".

**Answering a finding.** With round-trip on, each finding is answered: **Fix**, or **Dismiss** with a reason (required for an `important` one — the agent is told not to raise it again, so it is told why). The answers live in the reviewer's browser, like viewed state and line comments, and go with the verdict as `DoneResult.findings` — `{ id, decision: "fix" | "dismiss", reason? }`, the finding's id and nothing of its text. `/api/done` joins them onto the review it served (`answeredFindings`, `core/messages.ts`), so the location, severity and title the agent is told are the tool's own; an id this review does not have is dropped. Approving while an `important` finding has no answer asks once, and never blocks: that is the project's policy, not ours. See docs/DESIGN-roundtrip.md §2.

**CI checks (`pr.checks`).** Read once, when the review opens, from GitHub — never run by Review Buddy. The plugin reads `statusCheckRollup` from `gh pr view`; the desktop app reads the commit's check runs and statuses from the REST API and follows every page (at most 10 pages of 100 each). The list is never cut, so no failure is dropped and the counts in `ciStatus` are right. When a page fails, or there are more pages than that, `checksIncomplete` is `true`, `ciStatus` ends with "(incomplete)", and the viewer says the list may miss failures. `status` is `passed` | `failed` | `pending` | `skipped`; only `https` links are kept. Without a PR, without `gh`, or when GitHub refuses, the field is absent and the viewer shows no CI row. When the review is not of a PR by ref (working tree or branch), the current branch's PR CI is kept only if its head commit is the local `HEAD`, so the reviewer never sees CI of other code.

`/api/file-content?path=&side=base|head` serves full files on demand for "expand full file" and word-level context (source C) — never inlined into `/api/review`.
