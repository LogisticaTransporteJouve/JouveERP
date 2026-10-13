---
name: enforce-clean-code
description: >-
  The strict enforcement lens for the DRY-progression law — fires the moment a piece of logic
  appears a SECOND time and forces one acted-on-now verdict: EXTRACT, REUSE, or LEAVE + NOTE.
  Reports both genuine duplication left un-extracted and forced/premature abstraction. Use for
  "should I extract this or duplicate it", "is this reusable", "DRY-check this", "I'm writing this a
  second time", "am I about to make a premature abstraction", "did I leave copy-paste lying around",
  "enforce clean code". NOT for general cleanup/style (/simplify) or bug-hunting (/code-review);
  enforce-ports-and-adapters is the spatial boundary law, this is the temporal 1→2 duplication law.
---

# Enforce Clean Code — the DRY-progression law

This is a **language guide**, not a workflow — the strict standard other passes cite (like
`enforce-ports-and-adapters`). It governs ONE thing: what must happen the moment a piece of logic
appears a second time. It is deliberately unforgiving about *running the check* and about *real*
duplication; deliberately lenient about coincidental similarity. Strictness lives on every axis that
cannot produce a false positive, and nowhere else.

## The one law
**First occurrence: inline whatever is most pragmatic — do not abstract a shape you have seen once.
At the SECOND occurrence of the same concept, the DRY-check is MANDATORY and RECORDED. Deferring it
("I'll dedupe later / in a follow-up") is a defect — the deferral is the sin, not the duplication.**

This is a rule-of-TWO of the *check*, not of extraction. The check has three verdicts; you must
record which, and act on it in the same change.

## Step 1 — find the 2nd occurrence (look in BOTH places)
- **In-diff:** two added blocks that encode one concept.
- **Pre-existing (the highest-value catch):** the diff RE-IMPLEMENTS a helper/constant/type that
  already exists in the repo but is not in the diff. This is invisible if you only read the diff. For
  each non-trivial added function/constant/guard, extract a token (the domain noun, the literal
  value(s), or a distinctive 4–6 token slice of the body) and `rg` it across the repo OUTSIDE the
  diffed files; a hit is a candidate the diff must import, not re-implement. Skipping this search
  makes any "no duplication" claim a lie.

## Step 2 — the discriminator: is it the SAME thing? (present-tense, mechanical)
Two fragments are duplication only if ALL THREE hold NOW — never a forecast:
1. **Same noun** — both encode the same named rule/constant/shape, sayable in one word. Can't name it
   in one word → coincidence.
2. **Same-answer-required** — for one shared input, correctness DEMANDS identical output.
3. **Bug-mirrors** — a defect in copy A is, by definition, also a defect in copy B (read both).

Any one absent → **coincidence, leave it.** Divergent-reasons exclusion: blocks written to satisfy
different requirements are coincidence even if byte-identical today. The one-sentence form: *if fixing
one copy to make a real behavioural change would obligate editing the other or ship a bug, it is
duplication — extract; if they can evolve independently without either becoming wrong, leave it.*

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

## Delivery
Reviews/plans/builds Read this guide, then paste the condensed block from
`.claude/skills/_shared/dry-lens/condensed-lens.md` into every subagent prompt (subagents inherit
nothing). The block carries the load-proof echo (`dry-lens loaded: … | duplication surface: <list|none>`)
and the per-diff verdict. `none`/`N/A` is a clean pass only when the scanned surface is stated; a
wrongful `none` on a diff that repeats a concept is a first-class defect.

## Cross-references (do NOT restate these; they own their own domains)
`enforce-ports-and-adapters` (the boundary special case where an extraction lands on a port);
`_shared/telemetry-lens/condensed-lens.md` (the observability sibling — a clean, un-duplicated change can still emit garbage);
`/simplify` and `/code-review` (the cleanup/bug PASSES that run against a diff — this is the standard
they cite, not a runner); the catalog's `[type-tightness]` (repeated *type/shape*; this lens = repeated
*behaviour/rule*); `tighten` (text/prose dedup, not code).
