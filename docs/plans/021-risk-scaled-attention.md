# Plan 021: Attention scaled by risk

**Status:** proposed. **Size:** medium.

## Why

The post's main idea is that human attention should follow risk: "the change
sets the tier, not the author", and "anything owners list as sensitive and any
CI workflow file always needs a person."

Review Buddy already has a risk level per chapter, but it uses it only as a
colored badge:

- The level comes from the agent alone. An agent can call a change to a CI
  workflow "Low".
- Every chapter asks for the same effort. The "Done" warning counts all
  unviewed files, so a reviewer who skips 40 low-risk files gets the same
  warning as one who skipped the auth change.

**Scope line:** Review Buddy decides what to **show first and what to warn
about**. It does not decide who must approve; that is branch protection.

## What the reviewer gets

- A file on a sensitive path has a **Sensitive** badge in its header and in the
  file list. Its chapter is shown as **High**, with the reason: "Raised to High:
  contains `.github/workflows/ci.yml`".
- Low-risk chapters have a **Skim** mark on the Overview. In the chapter view
  their files start collapsed (one click on "Expand all" opens them). A display
  setting turns this off.
- The Overview's progress line splits by risk: "High 2/3 · Medium 5/5 · Low 0/12".
- The "Done" question changes:
  - Unviewed files in High or Medium chapters: asks as today, and lists them.
  - Only Low files unviewed: no question.

## Design

### Where the list of sensitive paths comes from

The **project** owns the list; Review Buddy reads it.

- File: `.review-buddy/sensitive-paths` in the repo. One pattern per line,
  gitignore style (`*`, `**`, `?`, a trailing `/` for a folder, `#` comments).
- Built-in defaults, always on: `.github/workflows/**`.
- The file is read from the **base** side of the diff when there is one (PR and
  branch reviews). A change cannot remove its own guard this way. Worktree
  reviews read `HEAD`.

Why not `CODEOWNERS`: many repos have a `* @team` line, which would make every
file sensitive. See open questions.

### Core

- New `packages/core/src/sensitive.ts`: `parsePatterns(text)` and
  `isSensitive(path, patterns)`. A small matcher written here (no new
  dependency; core must stay runtime-neutral and the plugin bundle small).
- `ReviewDataSource` gets an optional `sensitivePatterns?(): Promise<string>`
  (the raw file text, "" when missing). `LocalGitSource` reads it with
  `git show <base>:.review-buddy/sensitive-paths`.
- `resolveReview` takes the patterns as a new optional argument and sets:
  - `ResolvedFile.sensitive?: true`
  - `ResolvedChapter.risk = "High"` and `ResolvedChapter.risk_raised?: string`
    when a file in it is sensitive and the agent's level was lower. The agent's
    `risk_reason` is kept and shown under it.
- A sensitive file that lands in "Unsorted changes" makes that chapter High too.
  Noise files are checked first: a sensitive pattern wins over the noise rule,
  so such a file is never set aside in the noise chapter.

### Viewer

- `RiskBadge.tsx`: the "raised" form with the reason in a tooltip.
- `FileDiffCard.tsx` and the file list: the Sensitive badge.
- `Overview.tsx`: Skim mark, progress by risk (`lib/progress.ts` gets a `byRisk` result).
- `ChapterReview.tsx`: Low chapters open with files collapsed, when the new
  display setting `collapseLowRisk` (default on) is set. A file the reviewer
  opened stays open (existing collapsed state wins once it exists).
- Done confirm: only Medium and High count.
- `reviewMarkdown.ts`: mark sensitive files in the file inventory.

### Desktop

`GitHubApiSource.sensitivePatterns()` reads the file from the base commit with
the contents API. Without it, the built-in defaults still apply. Can be a
second step.

## Steps

1. `core/sensitive.ts` + tests for the matcher (each pattern form, comments, empty file).
2. `ReviewDataSource.sensitivePatterns` + `LocalGitSource` + tests with `test-repo.ts`.
3. `resolveReview`: `sensitive`, raised risk, noise order + tests.
4. Types, viewer schema, fixtures (a raised chapter, a sensitive file).
5. Badges (file, chapter) + stories.
6. `progress.ts` by risk + Overview + tests.
7. Collapse Low chapters + the display setting + tests.
8. Done confirm by risk + tests.
9. Markdown copy.
10. Desktop source (may be a separate PR).
11. Docs: `README.md` (how to add the file), `ARCHITECTURE.md`; builds; `pnpm verify:ci`.

Steps 1–5 (sensitive paths) and 6–8 (skim low risk) are independent and can
ship in either order.

## Tests

- A PR that deletes `.review-buddy/sensitive-paths`: the base version still applies.
- Agent says Low, file is `.github/workflows/x.yml`: chapter is High with the reason.
- Agent says High already: no `risk_raised`.
- A sensitive `.svg` is not moved to the noise chapter.
- Done with only Low files unviewed: no question. With one Medium file: question lists it.

## Not in this plan

- Approval rules (zero, one or two people). The project's branch protection.
- A review-level tier ("this PR is Medium"). The chapter levels are enough to
  guide attention; a single number would look like a merge decision.
- Asking the agent to list sensitive paths. The point is that this part does
  not trust the agent.

## Open questions

- `CODEOWNERS` as a second source. Proposed: not in the first version. Later,
  maybe: use only its lines that are not a catch-all `*`.
- Should "Skim" also change the order of chapters? Proposed: no. The agent's
  order tells the story; changing it would break the narrative.
