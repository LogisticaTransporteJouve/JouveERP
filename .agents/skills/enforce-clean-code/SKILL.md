---
name: enforce-clean-code
description: >-
  The strict clean-code lens — reuse before write, the DRY-progression law, the simplest mechanism,
  names, and refactor debris. Fires the moment a piece of logic appears a SECOND time and forces one
  acted-on-now verdict: EXTRACT, REUSE, or LEAVE + NOTE; searches the repo for an existing producer
  of anything the diff writes; asks "what is the simplest standard thing, and why not that?" of each
  new mechanism and what the next member of each new family costs; flags misleading names, lineage
  markers, bare aliases, pass-through wrappers and unreachable leftovers. Use for "should I extract
  this or duplicate it", "is this reusable", "DRY-check this", "I'm writing this a second time", "am
  I about to make a premature abstraction", "is this over-engineered", "is there a simpler way",
  "naming", "did I leave copy-paste or debris lying around", "enforce clean code". NOT for
  general cleanup/style (/simplify) or bug-hunting (/code-review); enforce-ports-and-adapters is the
  spatial boundary law, this is the temporal 1→2 duplication law plus its debris.
---

# Enforce Clean Code — reuse, the DRY-progression law, and no debris

This is a **language guide**, not a workflow — the strict standard other passes cite (like
`enforce-ports-and-adapters`). **The law: a change uses what the repo already has, adds the simplest
mechanism that does the job, names things by what they are, and leaves nothing behind.** It is
deliberately unforgiving about *running the check*, about *real* duplication and about debris;
deliberately lenient about coincidental similarity. Strictness lives on every axis that cannot
produce a false positive, and nowhere else.

## The DRY-progression law
**First occurrence: inline whatever is most pragmatic — do not abstract a shape you have seen once.
At the SECOND occurrence of the same concept, the DRY-check is MANDATORY and RECORDED. Deferring it
("I'll dedupe later / in a follow-up") is a defect — the deferral is the sin, not the duplication.**

This is a rule-of-TWO of the *check*, not of extraction. The check has three verdicts; you must
record which, and act on it in the same change.

## Step 1 — reuse before write: find the 2nd occurrence (look in BOTH places)
- **In-diff:** two added blocks that encode one concept.
- **Pre-existing (the highest-value catch):** the diff RE-IMPLEMENTS a helper/constant/type/client/
  query that already exists in the repo but is not in the diff. This is invisible if you only read
  the diff. For each non-trivial added function, constant, guard, client, type or query:
  1. **Search by output and domain noun, not only body tokens.** Which existing code already returns
     this figure, canonical form, client or predicate? Grep the noun (saldo, CUIT, canal, cotización,
     asiento, comprobante) and the likely helper verbs (`resolve*`, `normalize*`, `format*`,
     `create*Client`, `is*`, `*ForRange`) in `lib/`, the feature's own `lib/` and the sibling
     feature that owns that noun (`lib/format.ts`, `lib/fx.ts`, `lib/channels.ts`,
     `lib/date-range.ts`, `lib/validation/cuit.ts`, `lib/supabase/paginate.ts`). Re-derivations
     rarely share text with the original, so a body-token `rg` alone misses them. Use `git grep` or
     `rg --hidden -g '!.git'` — a bare `rg` skips dot-directories.
  2. **If one exists, diff what it does that the new code doesn't**: a guard, a fail-closed branch,
     canonicalisation, the other identity arm, the `max_rows` drain, the channel or date-range
     resolution. A re-implementation that drops a guard takes on that guard's severity.
  3. **A hoist is a move, not a copy.** After extracting to `lib/`, the old definition and its
     imports are gone.
  4. **Read through the existing typed helper or action**, not a new raw query beside it.

  A hit is a candidate the diff must import, not re-implement. Skipping this search makes any "no
  duplication" claim a lie.

## Step 2 — the same-concept test: is it the SAME thing? (present-tense, mechanical)
Two fragments are duplication only if ALL THREE hold NOW — never a forecast:
1. **Same noun** — both encode the same named rule/constant/shape, sayable in one word. Can't name it
   in one word → coincidence.
2. **Same-answer-required** — for one shared input, correctness DEMANDS identical output.
3. **Bug-mirrors** — a defect in copy A is, by definition, also a defect in copy B (read both).

Any one absent → **coincidence, leave it.** Divergent-reasons exclusion: blocks written to satisfy
different requirements are coincidence even if byte-identical today. The one-sentence form: *if fixing
one copy to make a real behavioural change would obligate editing the other or ship a bug, it is
duplication — extract; if they can evolve independently without either becoming wrong, leave it.*

**Skeletons** (an Inngest function shell, a CI step, a test harness, a dialog scaffold) repeat by
design: at the 2nd copy the usual verdict is LEAVE + NOTE with the death condition "a third copy";
at the third, extract.

## Step 3 — the three verdicts (record one, act now)
- **EXTRACT** — same concept + all three + ≥2 real call-sites. Extract to ONE shared interface; the
  2nd site imports it and must not re-implement. Prefer the cheapest sufficient form: share a **named
  type** (`&`/intersection) before you share behaviour; a shared function/interface only when the
  behaviour itself is one thing. If a helper already exists, REUSE it — never copy its body.
  *When the two occurrences are two implementations of one contract across a boundary, the shared
  interface IS a port → hand placement/naming/DAG to `enforce-ports-and-adapters`.*
- **REUSE** — a helper/pattern already covers it; use that instead of a third copy.
- **LEAVE + NOTE** — only if the discriminator fails. The rationale is a DEFECT unless it names, in one
  line, BOTH: (a) a concrete, **falsifiable** independent-change axis — a specific future edit that
  would hit one copy and not the other (vague "different reasons"/"coincidental" = defect); and (b) a
  **death condition** — the event on which they become one concept and must be extracted. Missing
  either = defect. This is the ONLY sanctioned way to keep a 2nd occurrence inline, and it is on
  probation. Three coincidental lines beat a premature abstraction — LEAVE is often the correct
  verdict — but it must be *earned* by a falsifiable rationale, not asserted.

## Step 4 — the simplest mechanism
For each new mechanism — an Inngest function or cron, a timer, a cache, a flag, a setting, a
user-facing toggle, a CI step, a script, a dependency, a wrapper, a state machine, a second delivery
path, a per-channel variant of a feature — ask: **what is the simplest existing or standard thing
that does this, and does the PR say why it isn't enough?** House answers to check first:
- **Data**: a static lookup table or constant map, not a stateful cache.
- **Lifecycles**: a status/soft-delete column plus a periodic Inngest reaper (the shape of
  `lib/inngest/functions/ttl-cleanup.ts`), not a long-running workflow that sleeps per row.
- **CI**: native GitHub `needs:`, `workflow_run` or environment protection, not polling.
- **Libraries**: the tool's own flag or an installed dependency (Zod for parsing, `fast-xml-parser`
  for XML, `write-excel-file` for spreadsheets), not hand-rolled parsing.
- **The producer**: fix the producer (the prompt, the mapper, the writer, the RPC), not the
  downstream symptom.
- **Necessity**: no new setting or control unless someone would deliberately choose the non-default.
  No new gate that restates a failure the platform already reports.

Raise these as **questions** that name the alternative and what it would delete. A question becomes
a defect only when the simpler alternative provably covers the need and the PR is silent on it.

**Tuning numbers.** A new tuning value in production code (timeout, Inngest `concurrency`/`throttle`,
lookback, batch or page size, threshold) gets a name or a one-line reason for its value; if missing,
ask where the number comes from. A value derived from other constants is built from them (not
re-typed). Layout values and test data are exempt.

**The next member.** For each special case, branch on a variant, per-variant copy (an event, a
component, a config block, a per-channel branch over `lib/channels.ts`) or list every member must
join, ask what the next member of that family costs. The family must be real: a sibling already
exists, or the ticket or PR names the next one. Measure from this diff: the files this member had to
touch are the files the next one will touch. Raise it only with that list and the shape that would
make the next member one edit ("a fifth channel edits these five files; a map entry makes it one").
Tier: should-fix on a one-way door (`adv-review`), question on a two-way door. It never overrides
Step 2's same-concept test.

## Step 5 — names and vocabulary
Raise a name only when it misleads: it misstates scope or meaning and a reader would act on the wrong
idea. A new name on a one-way door (a DB column, an RPC, an audit event type, an exported contract)
is also raised when it departs from the house term, because it cannot be renamed later; an existing
one is never renamed as a cleanup.
- Grep for the existing house term (comprobante, CAE, asiento, canal, recibo, orden de pago) before
  accepting a new one.
- Name for the general relationship, not the first use case.
- Finish a rename everywhere: code, tests, string literals, SQL, docs.
- No lineage markers that name a successor or predecessor of the same thing (`fooV2` beside `foo`,
  `oldX`/`newX`, `legacy*` left after a refactor). Domain terms are fine (a trigger's `old` row, an
  AFIP "comprobante asociado"). Provider names leaking into shared code are
  `enforce-ports-and-adapters`' CONTRACT-VOCAB law, not this one.

## Step 6 — debris (owned here)
Compiler-led renames, extractions, reroutes and helper adoptions are the highest-yield debris
generators, and a green typecheck proves nothing about any of these. Defects:
- **Bare aliases** — `const x = y` where both are plain identifiers.
- **Pass-through wrappers** — a function that forwards its arguments unchanged.
- **Unreachable old paths, flags and helpers** left after rerouting — a helper, type or export now
  unreferenced, or a value used exactly once immediately after definition for no reason.
- **The old name surviving** in a comment, test name, variable, string literal or doc string, so code
  and prose now disagree.
- **Guards**: one the new types made unreachable — and, more dangerous, one silently DROPPED that is
  still needed.
- **Truthiness drift** — `!!x`, `filter(Boolean)`, `x ? …` substituted for `x !== null` /
  `x !== undefined`. They differ on `""`, `0`, `false`, `NaN`; name the value that distinguishes them
  or state that none can occur. `?? null`, `|| []` the new types make a no-op, or that changed
  behaviour.
- **Scratch files** and planning notes committed with the change.

Unused imports, locals and parameters belong to lint (`@typescript-eslint/no-unused-vars`).
Change-narration comments belong to `enforce-comment-value`; a consumer left behind by a changed
signature belongs to `enforce-reach`. Per hit: cosmetic debris vs actual behaviour difference, with
the distinguishing input.

## No-softening hard blockers — LEAVE / duplicate-on-purpose is UNAVAILABLE
For these, the only clean verdicts are EXTRACT or REUSE; a "keep it inline" rationale is itself a
defect because the honest changes-together answer is definitionally yes:
1. Copying an existing helper's body instead of calling it.
2. A 2nd site re-implementing instead of importing a shape/helper that is already named.
3. Cross-feature / cross-language logic drift (`features/<a>` ↔ `features/<b>` ↔ `lib/`, TS ↔ SQL
   RPCs/views/triggers — e.g. a total or an IVA rule computed both in the RPC and in a component) —
   one product rule hand-mirrored with no shared source.
4. Hand-copied constants/enums with no parity gate (silent-drift risk).
5. A re-inlined named shape (a shape that already has a name, re-spelled inline — the `[type-tightness]`
   catalog class; there the fix is the named type).
6. A "temporary" duplication left with neither extraction nor a recorded follow-up.
7. A re-implementation that drops a guard the existing helper carries (Step 1.2).

## The two symmetric defects (both are failures)
- **MISSED-REUSE** — genuine same-concept duplication, or a re-implemented existing helper, left
  un-extracted; or a rubber-stamp LEAVE whose named axis is false.
- **WRONG-ABSTRACTION** — a forced/flag-parameterized helper fusing things that change for different
  reasons; a premature abstraction on the 2nd look before the shape has stabilised. A boolean/mode
  param that forks a "shared" function into two behaviours is this defect. Duplication is cheaper than
  the wrong abstraction; un-picking a wrong shared abstraction costs more than the copies would have.

## Never flag (leniency lives here, and only here)
The 1st occurrence; framework/test/config/migration boilerplate; documented divergence
between consumers; coincidental similarity that changes for different reasons.

## Coverage table (proof of work)

```
new unit, mechanism or variant branch | existing producer searched (command → hit or none) | verdict: reuse / extract / leave (axis + death) / question (alternative) / amplifies (next member → files it touches) / debris
```

## Verify before raising
- **"Use helper X"**: confirm X produces the same output on this input (read it; check its guards).
- **"Simpler X would do"**: name the capability by which X covers the need.
- **"Debris"**: grep the symbol repo-wide (including tests, SQL and dot-directories) before calling
  it unreferenced.

## Delivery
Reviews/plans/builds Read this guide, then paste the condensed block from
`.claude/skills/_shared/dry-lens/condensed-lens.md` into every subagent prompt (subagents inherit
nothing). The block carries the load-proof echo (`dry-lens loaded: … | duplication surface: <list|none>`)
and the per-diff verdict. `none`/`N/A` is a clean pass only when the scanned surface is stated; a
wrongful `none` on a diff that repeats a concept is a first-class defect.

## Cross-references (do NOT restate these; they own their own domains)
`enforce-ports-and-adapters` (the boundary special case where an extraction lands on a port, and
provider-name vocabulary); `enforce-reach` (every consumer of a changed contract);
`enforce-comment-value` (change-narration and comment value);
`_shared/telemetry-lens/condensed-lens.md` (the observability sibling — a clean, un-duplicated change
can still emit garbage); `/simplify` and `/code-review` (the cleanup/bug PASSES that run against a
diff — this is the standard they cite, not a runner); the catalog's `[type-tightness]` (repeated
*type/shape*; this lens = repeated *behaviour/rule*); `tighten` (text/prose dedup, not code).
