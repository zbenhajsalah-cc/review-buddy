# Design: Phase 2 round-trip (reviewer verdict + feedback → agent)

**Status:** design + spike (Plan 014). The spike is real but flag-gated behind
`REVIEW_BUDDY_ROUNDTRIP=1`; with the flag off, behavior is byte-identical to
Phase 1 (always `allow`). This doc is the input to the real Phase 2 build
plan(s); it makes the decisions that are cheap to make now and names the ones
deferred to that build.

Companion: `ARCHITECTURE.md` ("Later phases" table) and `PRD.md` (the
"top-level Review control [to] submit an overall verdict" requirement).

---

## 1. Mechanism — does `deny` + reason actually reach the model?

The entire round-trip rides on one Claude Code behavior: a `PreToolUse` hook that
returns `permissionDecision: "deny"` must (a) block the `submit_review` tool call
and (b) deliver `permissionDecisionReason` **to the model** so the agent can act
on it. Phase 1 was deliberately built to make this a drop-in: the hook already
**blocks** the turn until the reviewer clicks Done, and the emitter shape is
already the exact `hookSpecificOutput` envelope.

**Verified against the current Claude Code hooks docs**
(https://code.claude.com/docs/en/hooks, fetched 2026-07-07):

- `permissionDecision: "deny"` **is** valid for `PreToolUse`. The documented
  values are **`"allow"`, `"deny"`, `"ask"`, `"defer"`** (four — ARCHITECTURE.md
  only mentions allow/deny; see Open below).
- `permissionDecisionReason` is, verbatim, **"A human-readable reason shown to
  Claude."** That is the feedback channel: on `deny`, the tool call does not
  execute and the reason string is what drives the agent's next message.
- The envelope is exactly what `allow()` already emits:
  ```json
  { "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "…" } }
  ```

**Decision:** the mechanism is sound as designed; `deny(reason)` is a one-line
mirror of the existing `allow(reason)` (change the literal `"allow"` →
`"deny"`). No architectural pivot; ARCHITECTURE.md:71's assumption holds.

**Open:** the docs do **not** specify how `deny` interacts with `auto`-accept /
`bypassPermissions` permission modes; they hint `bypassPermissions` *may override
hook denials*. If a user runs in bypass mode, a "request changes" verdict could
be silently ignored (the tool call proceeds anyway). `PreToolUse` was chosen over
`PermissionRequest` precisely because it always *fires* even in auto-accept — but
whether the *deny is honored* in bypass mode is a separate, unverified question.
The real Phase 2 build must test this empirically and, if bypass overrides deny,
surface a warning ("round-trip has no effect in bypassPermissions mode").

**Open:** `"ask"` is a documented alternative to `"deny"`. `deny` is the right
default for "request changes" (it blocks the call and returns the reason in one
step), but a future variant could use `"ask"` to let the user arbitrate a
borderline verdict. Not needed for the spike.

### 1a. End-to-end observation (Plan 014 Step 5)

**Emit boundary — proven live (2026-07-07).** Running the real hook CLI exactly as
Claude Code invokes it (`bun src/cli/index.ts open-review` with a piped hook
event, `REVIEW_BUDDY_ROUNDTRIP=1`), then POSTing a `request_changes` verdict to
`/api/done`, the hook wrote this to stdout — the exact bytes Claude Code feeds the
model:
```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
 "permissionDecisionReason":"Reviewer requested changes:\n\ntighten the null check in app.ts and confirm z is used"}}
```
The automated spawn test (`src/cli/index.test.ts`, "request_changes verdict
returns deny with the summary") locks this in as a regression guard. Together with
the docs confirmation above (the reason is "shown to Claude"), every layer *we*
control is proven.

**Model-reaction — not proven in-session (deliberately).** The one remaining link
— Claude Code actually surfacing that reason to the agent, and the agent re-running
`submit_review` — needs a *live interactive* `/review` where the agent and the
reviewer are two separate actors. It can't be self-driven from a single Claude Code
turn: calling `submit_review` blocks the agent's turn on the hook, so the same
agent can't also POST `/api/done`. And the spike gates on a hook-process env var
that a running session can't inject into itself. The clean proof is a fresh session
started with `REVIEW_BUDDY_ROUNDTRIP=1`, a human clicking **Request changes**, and
observing whether the agent re-submits. That run is left to the operator (it also
carries an unrelated machine-stability caveat on the current hardware). This gap is
model/host behavior, already documented above — not a gap in this spike's code.

---

## 2. Feedback contract

The reviewer's decision travels client → server → hook as `DoneResult` (POSTed to
`/api/done`, forwarded verbatim by the server, resolved into `serveAndBlock`).

**Decision — extend `DoneResult` (spike ships `verdict` + `summary`; `annotations`
is designed here, built in Phase 2 proper):**
```ts
interface DoneResult {
  verdict?: "approve" | "request_changes"; // Phase 1 left this a reserved string
  summary?: string;                         // reviewer's overall note (markdown)
  annotations?: Annotation[];               // DESIGNED here; NOT built in the spike
}

interface Annotation {
  chapterIndex: number;   // which chapter (viewed-state is keyed by chapter)
  path: string;           // file path (matches ResolvedFile.path)
  side: "old" | "new";    // which side of the hunk the line is on
  line: number;           // anchored to the RESOLVED hunk lines (source B), never
                          // to reviewer-typed content — same reference-not-reproduce
                          // discipline as chapters
  body: string;           // the reviewer's comment (markdown)
}
```

**Decision — annotation → `permissionDecisionReason` serialization.** The channel
is a single string, so annotations serialize to a compact markdown list the model
can parse and act on, `path:line` prefixed, grouped after the summary:
```
Reviewer requested changes.

<summary>

Inline notes:
- src/server/http.ts:127 (new): this containment check should reject before the fetch, not after
- src/ui/src/api.ts:24 (new): missing await on postDone
```
Rationale: `path:line` prefixes let the agent jump straight to the site; markdown
matches everything else the agent already reads. **Decision:** the tool builds
this string from structured `annotations` — the UI never sends assembled prose or
code content back through the hook (keeps the channel injection-safe and small).

**Open — token budget.** `permissionDecisionReason` is unbounded in principle but
a very long reason wastes context and may be truncated by Claude Code. The Phase 2
build should cap the serialized reason (e.g. summary + first N annotations, with a
"…and M more; re-open the review" tail) and measure the real truncation limit.
The spike sends only `summary`, so this doesn't bite yet.

---

## 3. Agent behavior (the loop)

On `deny`, the agent receives the reason and must treat it as review feedback,
address each item, then call `submit_review` **again with the SAME `source`** (so
the hook re-captures the same diff) — a bounded loop.

**Decision — SKILL.md gains a "Phase 2 spike" deny-handling paragraph:** if the
`submit_review` call is denied, read `permissionDecisionReason` as the reviewer's
requested changes; make the edits; re-run `submit_review` with the identical
`source`. Acknowledge what changed between submissions.

**Decision — cap re-submissions.** The agent re-submits **at most 3 times** before
stopping and asking the human directly (prevents an infinite deny↔resubmit loop if
the reviewer keeps requesting changes or the agent can't satisfy them). The cap
lives in the SKILL prose (the agent self-limits); a hard server/hook-side counter
is a Phase 2 option, noted below.

**Open — loop divergence.** If the agent re-submits a *near-identical* review
(doesn't actually address the feedback), the reviewer sees Groundhog Day. Plan 014
Step 5's STOP condition calls this out as the key risk to observe, not to
prompt-engineer away in the spike. Phase 2 may need a hook-side resubmit counter
and/or a diff-of-reviews check.

---

## 4. UX

**Decision — the verdict control extends the existing "Done" button** (top-right
of the chapter screen, `ChapterReview.tsx`), rather than a new screen. Flag on, it
becomes a small split control:
- **Approve** — the current Done path: `postDone({ verdict: "approve" })` →
  hook `allow`s (turn proceeds). Behaviorally identical to today's Done.
- **Request changes** — reveals one free-text `summary` textarea; on submit,
  `postDone({ verdict: "request_changes", summary })` → hook `deny`s with the
  summary as the reason.

Flag off, the button is exactly today's single "Done" (no verdict, `allow`).

**Decision — how the client learns the flag.** The UI is a prebuilt bundle and
cannot read `process.env.REVIEW_BUDDY_ROUNDTRIP` (a hook-runtime var). So the hook
passes the flag into the server (`ServerContext.roundtrip`) and the client reads
it from a tiny token-gated **`GET /api/config → { roundtrip }`**. The verdict
control renders only when `roundtrip` is true — so with the flag off the client
gets `{ roundtrip: false }` and shows exactly today's single "Done". This keeps
the spike flag out of the core `ResolvedReview` contract (`/api/review`).

**Decision — empty "request changes" still denies.** If the reviewer picks Request
changes but types nothing, the hook still returns `deny` with a generic reason
("Reviewer requested changes (no details provided) — re-examine the flagged
chapters."). Rationale: the reviewer's *verdict* is the signal; missing prose
shouldn't silently flip it to approve.

**Open — approve + viewed-state.** Should Approve also relay which
chapters/files the reviewer actually looked at (so the agent knows coverage)?
Deferred — viewed-state persistence (`/api/file-viewed`) is a separate Phase 2
item; the spike keeps Approve = allow, nothing else.

**Open — per-chapter verdicts.** The PRD's top-level verdict is one overall
decision. A richer model (per-chapter approve/request-changes) is possible but
out of scope; the annotation contract (§2) already carries `chapterIndex`, so it's
forward-compatible.

---

## 5. Failure modes

**Decision — reviewer closes the tab / never clicks anything.** The hook blocks on
a long timeout (`~345600`s). Today, timeout ⇒ the hook process is killed and the
turn is whatever Claude Code does on a dead hook. For the round-trip, the safe
default is **fail-open `allow`** on timeout/abnormal exit — never trap the agent's
turn forever because a human wandered off. (This matches Phase 1's fail-open ethos
in `runOpenReview`, which `allow`s on every error path.) The spike does not change
the timeout; it inherits it.

**Decision — double-submit.** `/api/done` resolves the `done` promise once
(`resolveDone` on the first POST); subsequent POSTs are no-ops against an
already-resolved promise. The UI also flips to a "submitted" terminal state after
the first click. No new guard needed for the spike.

**Open — feedback larger than the reason budget.** See §2 Open — capping +
truncation is a Phase 2 concern; the spike's single `summary` is small.

**Open — malformed verdict.** If a client POSTs `verdict: "garbage"`, the hook
treats anything other than `"request_changes"` (with the flag on) as the default
`allow` path. That's safe (fail-open) but silent; Phase 2 could validate the
verdict enum server-side and log unexpected values.

---

## 6. Open questions (carried forward to the Phase 2 build)

- **Decision vs Open ledger** aside, the load-bearing unknowns for Phase 2 are:
  1. **Open:** does `deny` survive `bypassPermissions`? (§1) — must be tested.
  2. **Open:** annotation serialization token budget + truncation limit. (§2)
  3. **Open:** loop divergence / resubmit cap enforcement (prose vs hook counter). (§3)
  4. **Open:** should Approve relay viewed-state coverage? (§4)
  5. **Open:** per-chapter verdicts vs one overall verdict. (§4)
  6. **Open:** server-side verdict-enum validation + logging. (§5)

**Update:** the annotation UI (per-line commenting) is built, viewer side only:
`packages/viewer/src/lib/comments.ts` (`LineComment` = the `Annotation` above, plus an
`id` and an optional range start `startSide` / `startLine`; the comment shows under its
last line). Comments are not in `DoneResult` yet. The rest of this paragraph is still the
plan.

The annotation UI (per-line commenting), viewed-state round-trip
(`/api/file-viewed`), and any GitHub write (posting the verdict to the PR) are
explicitly **not** in this spike — they are the real Phase 2 build, for which this
document is the brief.
