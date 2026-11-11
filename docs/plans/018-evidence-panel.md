# Plan 018: Evidence panel

**Status:** built. **Size:** small to medium.

## Why

The post says the human's job is "reading the evidence: test output, commands
run and their results", and: "If you can't say what the checks would miss, ask
for a real review rather than a quick approval."

Today the viewer shows the diff and the story, but not one fact about what was
checked. The reviewer cannot tell a change that passed 400 tests from one that
was never run.

Review Buddy does **not** run checks. It shows two things that already exist:

1. What the agent ran in its session (reported by the agent).
2. The PR's CI status (read from GitHub — authoritative).

## What the reviewer gets

An **Evidence** card on the Overview:

```
Evidence
  CI (GitHub)            ✓ 12 passed   ✗ 1 failed: test (windows)  ↗
  Reported by the agent
    ✓ pnpm test:core        214 tests passed
    ✓ pnpm typecheck
    – pnpm smoke:plugin     not run
  Not covered: the Windows path handling was not run on Windows.
```

- Failed checks come first.
- The agent's part has the label **Reported by the agent**, so nobody reads it as proof.
- With no evidence at all, the card shows one muted line: "No checks were
  reported for this change." That line is useful: it tells the reviewer to look harder.

## Design

### Agent contract

A new optional top-level field:

```json
"verification": {
  "checks": [
    { "command": "pnpm test:core", "status": "passed", "summary": "214 tests passed" }
  ],
  "not_covered": "…"
}
```

- `status`: `passed` | `failed` | `not_run`.
- `summary` (optional): one short line. Never pasted output.
- `checks`: at most 20.
- `not_covered` (optional): what these checks would miss, Markdown.

### Skill text

- Report only commands **you ran in this session** after the last edit. Do not
  run new ones for this field; that is the project's job.
- Use `not_run` for a check the project has and you skipped. Be honest.
- If you ran nothing, omit `checks` and say so in `not_covered`.

### CI status (source B)

`capturePr` in `packages/core/src/node/git.ts` already calls `gh pr view --json …`.

- Add `statusCheckRollup` to the fields.
- New `PrMetadata.checks?: { name, status, url? }[]`, `status` = `passed` |
  `failed` | `pending` | `skipped`.
- Fill the existing `PrMetadata.ciStatus` with a short summary.
- No PR, or no `gh`: the field stays undefined and the CI row is not shown.

Desktop: `GitHubApiSource` fills the same field from the check-runs API. This
can be a second step.

### Viewer

- New `Evidence.tsx` card in the Overview, after the review focus.
- `reviewMarkdown.ts`: an "Evidence" section in the copy (commands and status only).

## Steps

1. Schema, types, zod, viewer schema, fixtures for `verification`.
2. `capturePr`: `statusCheckRollup` → `PrMetadata.checks`; tests in `git.test.ts`
   with a fake `gh` (the file already has this pattern).
3. `Evidence.tsx` + story + tests (CI only, agent only, both, none).
4. Markdown copy + test.
5. Skill and prompt template, `pnpm gen:prompts`.
6. Desktop: `GitHubApiSource` checks (may be a separate PR).
7. Contract doc, builds, `pnpm verify:ci`.

## Tests

- `validate.test.ts`: status values, the 20 cap, long `summary` is rejected (max 200 characters).
- `git.test.ts`: rollup parsed; missing rollup gives undefined.
- `Evidence.test.tsx`: order (failed first), the label, the empty line.

## Not in this plan

- Running commands from the hook. It would be slow, need trust in project
  scripts, and it is the harness's job.
- "How it was tested" and "How to revert" fields. They belong in the PR
  template, and the PR description is already shown on the Overview.

## Decided

- CI status is read once, when the review opens. No refresh button in the
  first version.
- The card sits after the Prologue/Description tabs (so both tabs show it),
  before the chapter list.
- CI lists failed and pending checks by name; passed and skipped are counts.
  A link opens all of the PR's checks on GitHub.
- Working tree or branch review: the current branch's PR CI is shown only when
  the PR's head commit is the local `HEAD`. Otherwise it is CI of other code.
- Desktop: built in the same PR. CI is read on the first `pr()` call from the
  check-runs and statuses APIs, every page (at most 10 pages of 100). A page
  that fails, or more pages than that, marks the CI "incomplete" in the card,
  so a part is never shown as the whole. A token without the checks
  permission only hides the row (or marks it incomplete when statuses exist). The desktop agent has no shell, so its `submit_review`
  schema leaves `verification` out.
