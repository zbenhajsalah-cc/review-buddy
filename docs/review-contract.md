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
    }
  },
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
    "url": "https://github.com/acme/app/pull/123",   // optional (phase 2)
    "ciStatus": "passing"                              // optional (phase 2)
  },
  "prologue": { /* same as agent contract */ },
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

`/api/file-content?path=&side=base|head` serves full files on demand for "expand full file" and word-level context (source C) — never inlined into `/api/review`.
