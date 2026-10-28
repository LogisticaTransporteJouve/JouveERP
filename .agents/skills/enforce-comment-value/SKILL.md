---
name: enforce-comment-value
description: >-
  The strict enforcement lens for comment value — which comments earn the maintenance they cost.
  Fires on every comment written or touched and yields one recorded verdict (DELETE, KEEP+ANCHOR,
  REWRITE, HOIST, REFACTOR-INSTEAD); EDITS the comments in scope. Use for "clean up the comments",
  "comment audit", "are these comments worth it", "too many comments", "comment noise", "is this
  comment useful", "should I comment this", "stale comment", "the comments restate the code",
  "enforce comment value". Diff-scoped by default. NOT a bug hunt (/adv-review), NOT
  prose-tightening (/tighten); enforce-clean-code is the duplication law over code, this is the
  value law over comments.
---

# Enforce Comment Value — the earn-your-maintenance law

A **language guide**, not a workflow — the strict standard other passes cite (like
`enforce-clean-code`). It governs ONE thing: whether a given comment earns the maintenance it costs.
Deliberately unforgiving about restatement and unanchored claims; deliberately lenient about anything
encoding a fact the repo cannot re-derive.

**Standing-rule note.** Leaving existing comments alone is the correct default for an agent doing
unrelated work, and some personal `CLAUDE.md` files say so outright. Invoking this lens is an explicit
opt-in that supersedes that default **for the stated scope only, for this invocation only** — outside
that scope, hands off.

## The one law
**A comment must carry information the code cannot, that a competent reader would otherwise get wrong.
Everything else is a liability: it costs a read on every visit and a diff on every change, and it pays
nothing back.**

The cost is not the writing. It is that every future edit must decide whether the comment still holds —
and a wrong comment is worse than none, because it is believed.

## Step 1 — the bug-filing test (the primary gate)
Repo doctrine (the comment rule this repo's agent instructions follow), generalised:

> Would a competent reader, without this comment, make a **wrong change** — assume something false,
> "fix" something deliberate, or file a bug against correct code?
>
> **If yes → the comment is load-bearing. If no → delete it; it only plants the idea it answers.**

Applies hardest to comments explaining an *absence* or a *non-obvious choice*. A comment defending a
choice nobody would question is pure liability.

## Step 2 — the two-question classifier (mechanical, in order)
**Q1 — Derivable?** Is the comment's claim recoverable from the enclosing function (or, at file
scope, the ±20 lines around it) — no jumping to other files?
→ **YES = DELETE.** Restatement, narration of the next statement, a docstring echoing the signature,
a step-numbered running commentary, "// Update existing record" above an update.

**Q2 — Recoverable from this repo at all?** If not derivable: is the information written down
*anywhere* a reader would find — types, tests, an adjacent module?
→ **NO = KEEP.** These are the comments that pay for themselves:
- **external-system behaviour** — what Supabase/PostgREST/Inngest/AFIP WSFEv1/an AI provider/a library
  actually does, especially where it contradicts its docs or its name
- **a decision + why the alternative was rejected**, including the death condition that retires it
- **an invariant or contract** the type system does not express (units, inclusive/exclusive, nullability
  semantics, ownership, ordering)
- **a hazard** — a failure mode the shape of the code invites (silent truncation, an overflowed
  querystring, a swallowed error, an owner key `user_id` that must stay in the predicate)
- **a load-bearing constant's rationale** — why *this* threshold, and which way to move it

**Rot risk is NOT a delete reason.** A comment about an external system can go stale precisely because
it describes something this repo does not control — that is what makes it valuable. Rot risk means
**anchor it**, never drop it.

**Change-narration (a special case cutting across Q1 and the verdicts).** A comment that describes the
*edit* rather than the *current behaviour* is a liability: it narrates history the code no longer needs.
- EXPLICIT: `was X, now Y`, `previously`, `used to`, `changed from`, `renamed`, `moved from`, `no longer`.
- IMPLICIT / comparative: `rather than X`, `instead of X`, `not X but Y`, `as opposed to`, `unlike X` —
  any wording framing the code against a prior, rejected, or other state.

Strip the contrast; state only what the code does now. Change rationale and migration notes belong in
the PR body, never the code. `// this was in ARS, now USD (MEP)` → `// USD (MEP)` (or delete if the code
already says it); `// keyset-paginate, rather than OFFSET` → `// keyset-paginate`. When the whole
comment is contrast → DELETE; when only a clause is → REWRITE to the load-bearing clause.

## Step 2b — the common defects (each maps to a verdict below)
- **A rewording.** An edited comment that says what the old one said, in as many words or more.
  Verdict: restore the old text — the rewording costs a review and tells the reader nothing new.
- **Facts that drift**: hard-coded counts ("12 of the 77 permissions"), a ticket id standing in for
  the reason, section or line numbers, file names, values restated from a constant. REWRITE:
  reference the constant by name, state the reason instead of the ticket.
- **Length beyond the why.** A comment longer than the code it explains is cut to the reason.
- **A doc block split from its declaration** — a function or constant inserted between a JSDoc and
  the symbol it documents, so the doc now sits on the wrong thing. Move it back.
- **A nullable or union field's doc that misses a producer.** The doc lists every meaning `NULL` (or
  each union member) can carry, including the one this diff's new writer produces.
- **A deleted contract on an exported symbol** (its JSDoc, an invariant, a units/nullability note).
  **Restore it by default**; deleting one needs the bug-filing test to say no, stated in one line.
- **A law stated without its condition** ("do NOT retry this") when it holds only sometimes — add
  the condition.

## Step 3 — the five verdicts (record one, act now)
- **DELETE** — Q1 = derivable. No ceremony, no replacement.
- **KEEP + ANCHOR** — Q2 = unrecoverable. Anchoring is mandatory, not optional polish. Name the
  *external fact* it depends on (`Inngest step retries`, `PostgREST`, `Safari 14`), reference constants **by
  name, never by value** (a restated value drifts silently), and for anything temporary give a **death
  condition** — the observable event that retires it — plus a ticket where one exists.
- **REWRITE** — right information, wrong form: buried in narration, three sentences of throat-clearing,
  or a claim that no longer matches the code. Keep the fact, cut to the shortest form that survives the
  bug-filing test. **This is the uncertainty verdict** (see the asymmetry below).
- **HOIST** — the fact is real but sits at the wrong altitude. A per-line note explaining a contract
  belongs on the interface; a fact repeated across sibling call-sites belongs once at the definition.
  Hoisting is how N comments become one.
- **REFACTOR-INSTEAD** — the comment exists only because the code is unreadable: a step-numbered block
  (`// 1. …  // 2. …`) or a commented divider inside one function is a request for a named function.
  Extract, delete the comment. Propose the extraction; do not silently restructure logic during a
  comment pass.

## The asymmetry (the safety rail — do not average it away)
The two defects are NOT symmetric:
- **NOISE-KEPT** — a restatement survives. Cost: a wasted line. Caught again on the next pass.
- **CONTEXT-DESTROYED** — a comment encoding something unrecoverable is deleted. The fact is gone from
  the repo; git history preserves the bytes but no future reader knows to look. Practically permanent,
  and it is how a codebase gets re-broken the same way twice.

Therefore: **when a comment's value is unclear, the verdict is REWRITE, never DELETE.** "I couldn't tell
what this was for" is the strongest possible signal it is carrying something you don't have. Ask, or
keep it and shorten it.

## Never touch (leniency lives here, and only here)
Tool directives (`eslint-disable`, `biome-ignore`, `@ts-expect-error`,
`# noqa`, `#pragma`, `//go:`) · license headers and shebangs · JSDoc/TSDoc on a public API or consumed
by doc tooling · `TODO`/`FIXME`/`HACK` that references a ticket or issue (an unreferenced one is
REWRITE — give it a ticket — not DELETE) · comments stating a test's *intent* or the arithmetic behind
an expected value · SQL migration comments · anything in a generated file (the generated Supabase DB
types in `lib/db/database.types.ts`, `supabase/migrations/`) — generated files are out of scope entirely.

**Section banners** (`// ====`, `// Constants`, `// Handlers`) make no claim, so they cannot rot and
cost nothing to maintain. They are the LOWEST priority: never spend review attention on them; delete
them only during a deliberate full-file pass, and leave them in large registry-style files where they
are genuine navigation.

## Scope — this lens is never loose on the whole repo
- **Default: diff-scoped.** `git diff` + `git diff --cached`: changed hunks, plus the comments the
  diff DELETED (a removed comment is in scope — it may be a destroyed contract).
- **Campaign: path-scoped**, and only when a path is named explicitly. State the file count before
  starting.
- **Completeness rule.** Every comment in scope gets a recorded verdict — none skipped silently. A pass
  is done only when each one is DELETE, KEEP+ANCHOR, REWRITE, HOIST, or REFACTOR-INSTEAD.
- **Comments only.** Never change behaviour, names, or control flow in a comment pass. REFACTOR-INSTEAD
  is a *proposal* unless the invocation explicitly authorised refactoring.
- **Report** as a verdict tally plus every KEEP that was rewritten, so the diff is reviewable.
- **Verdicts only** when the caller asks for them: report and edit nothing.

## Delivery
Reviews/builds Read this guide, then paste the condensed block from
`.claude/skills/_shared/comment-lens/condensed-lens.md` into every subagent that runs the cleanliness
pass (subagents inherit nothing but their prompt). The block carries the load-proof echo
(`comment-lens loaded: … | comment surface: <list|none>`) and the per-diff verdict. Its findings are
comment-only edits: fixed in the pass, never a merge blocker.

## Calibration
`calibration.md` in this directory holds hand-labelled comments (JouveERP-shaped exemplars until
reviews supply real ones). Read it before a first
pass, and when a verdict feels uncertain. An edit to this lens that flips a calibration label is a
regression — fix the lens, not the label.

## Cross-references (do NOT restate these; they own their own domains)
`enforce-clean-code` (repeated *behaviour*; this lens = comment value — a fact repeated across
call-sites is HOIST here and a DRY-check there) · `enforce-ports-and-adapters` (a comment naming
something its file must know nothing of is a boundary defect, reported there) ·
`_shared/perf-lens/condensed-lens.md` (owns the scaling hazards a KEEP comment may be documenting) ·
`_shared/telemetry-lens/condensed-lens.md` (a comment naming a signal's shape/routing is that lens's domain, not this one) ·
`/adv-review` and `/simplify` (the PASSES that run against a diff — this is a standard they cite, not a
runner) · `/tighten` (prose, not code).
