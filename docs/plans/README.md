# Plans: review enhancements (017–021)

These five plans come from reading Anthropic's post
[How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/)
and asking what Review Buddy should take from it.

**Status:** 017 and 018 are built. The other three are proposed.

## The rule that decides what we build

Review Buddy owns the **human's attention**: what to show, in what order, and how
the reviewer's answer goes back to the agent.

The project's own harness owns everything that makes the code or the review
**correct**: finding bugs, running tests, project rules, merge policy.

So Review Buddy **shows and collects**. It does not hunt bugs and it does not
run checks. If it did, it would be a second, weaker copy of `/code-review`, and
it would stop working the same way in Cursor, Copilot and Codex.

## The plans

| Plan | What | Size | Needs |
|---|---|---|---|
| [017](./017-direction-questions.md) | "Before you read the code": scope and direction questions, shown first | Small | — |
| [018](./018-evidence-panel.md) | Evidence panel: checks the agent ran, plus CI status from GitHub | Small–medium | — |
| [019](./019-findings-triage.md) | Show findings from other tools on the diff line; the reviewer answers each one | Large | — |
| [020](./020-rounds.md) | Rounds: after "Request changes", show what changed and keep viewed marks | Large | — (019 uses its store for "no repeats") |
| [021](./021-risk-scaled-attention.md) | Attention scaled by risk: sensitive paths, skim low-risk chapters | Medium | — |

Suggested order: 017 → 018 → 019 → 020 → 021. The first two are small and teach
the full path of a schema change. Each plan can ship alone.

## What we decided NOT to build

These came up in the same review and belong to the project's harness:

- **Bug hunting and checking of findings** — `/code-review`, a subagent, or a CI reviewer.
- **Running tests, build, lint** — the agent's normal work, hooks, and CI.
- **`REVIEW.md` tooling** — the file is the project's. A reviewer who wants a new
  rule writes a normal line comment ("add this to `REVIEW.md`").
- **Explainers for a module** — ask Claude in the same session. (Phase 4's
  assistant may cover this later.)
- **Measuring the bug finder** (catch rate, noise) — it measures another tool.
- **Approval policy** (how many people must approve) — branch protection and `CODEOWNERS`.

## Steps every schema change needs

Plans 017, 018 and 019 add optional fields to `submit_review`. Each one must
touch the same places, in this order:

1. `packages/core/schemas/review.schema.json` — the new optional field.
2. `packages/core/src/types.ts` — agent type and resolved type.
3. `packages/core/src/validate.ts` — the zod backstop, with tests.
4. `packages/core/src/resolve.ts` — pass the field through (or resolve it), with tests.
5. `packages/viewer/src/lib/reviewSchema.ts` — the viewer's own check of `/api/review`.
6. `packages/viewer/src/stories/fixtures.ts` — a fixture with and one without the field.
7. `apps/plugin/skills/review/SKILL.md` and `packages/core/prompts/review-template.md`,
   then `pnpm gen:prompts`.
8. `docs/review-contract.md` — the contract and an example.
9. `pnpm build:ui && pnpm build:plugin`, and commit `apps/plugin/ui/dist` and `apps/plugin/dist`.
10. `pnpm verify:ci` must pass.

Two rules hold for every new field:

- **Optional, always.** An old agent prompt that does not send the field must
  still give a valid review. The viewer shows nothing for a missing field.
- **Reference, do not reproduce.** A new field may hold a path and a line
  number. It must never hold diff or file text.
