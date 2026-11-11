# Plan 017: "Before you read the code" — direction questions

**Status:** built. **Size:** small.

## Why

The post says the most useful human question is often "should we even do
this?", and that it must come **early**, not as a blocking comment on finished
work. Today the Prologue explains the change but never asks if the change is
the right one. The reviewer reads all chapters before they can object to the
approach.

## What the reviewer gets

A small card at the top of the Overview, above "Key changes", titled **Before
you read the code**. It lists up to 3 questions, for example:

- "This adds a second cache layer. `docs/ARCHITECTURE.md` says there should be one. Is that decision still valid?"
- "The task was a null check, but the diff also renames 14 files. Should the rename be its own change?"

Each question has a **Raise with the agent** button. It puts the question into
the "Request changes" note, so the reviewer can stop the review in one click.

With no questions, the card is not shown.

## Design

### Agent contract

A new optional field in the prologue:

```json
"open_questions": [
  { "question": "…", "context": "…" }
]
```

- `question`: one sentence, Markdown.
- `context` (optional): why the agent asks, with a file or doc name as evidence.
- At most 3 items.

### Skill text

Add to Step 2 of `SKILL.md`:

- Add a question only when you saw one of these: the diff is clearly larger
  than its stated goal; a simpler way exists and you can name it; the change
  goes against a decision written in the repo (`CLAUDE.md`, a doc, a comment).
- Give the evidence in `context`.
- Most reviews have **no** questions. Do not invent one to fill the field.

### Viewer

- `Overview.tsx`: the new card, only when `open_questions` is not empty.
- "Raise with the agent": opens the existing request-changes dialog with the
  question as the start of the note. Hidden when round-trip is off.
- `reviewMarkdown.ts`: include the questions in the copied Markdown.

### Server

No change. The field passes through `resolveReview` untouched.

## Steps

1. Schema, types, zod, viewer schema, fixtures (see `README.md`, steps 1–6).
2. Overview card + story + test (shown with questions, absent without).
3. "Raise with the agent" → request-changes note; test that the note is filled.
4. Markdown copy + test.
5. Skill and prompt template, `pnpm gen:prompts`.
6. Contract doc, builds, `pnpm verify:ci`.

## Tests

- `validate.test.ts`: accepts 0–3 questions, rejects 4, rejects an empty `question`.
- `Overview.test.tsx`: card shown / not shown; button hidden with round-trip off.
- `reviewMarkdown.test.ts`: questions appear in the copy.

## Not in this plan

- Answers typed in the viewer per question. The request-changes note is enough.

## Open question (decided)

- Should the desktop prompt (`{{#desktop}}`) also ask for questions? **Yes,
  same text** (Step 2 is shared by every prompt). The desktop has no agent to
  "raise" to (round-trip is off there), so the button is hidden and the
  questions go into the copied Markdown. Adding them to the GitHub review
  summary is left for later: today that text is the reviewer's own summary.
