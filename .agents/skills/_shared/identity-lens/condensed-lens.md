# Identity & refactor-completeness lens (condensed — paste verbatim into subagent prompts)

Three failure modes that no other lens in this package catches. They recur hardest in dual-arm
identity work (an entity addressable by EITHER a human code OR a stable uuid — in JouveERP, a ledger
account known by its chart code such as `1.1.01.001` OR by its id, a client by CUIT OR by id, an
invoice by `punto de venta + número` OR by id), but they are
general: they apply to any change that resolves between two representations of the same thing, and
to any refactor that moves logic behind a helper.

Emit this load-proof line in your header block, and a per-mode verdict:

```
identity-lens loaded: fork-height | refactor-debris | consumer-completeness | surface: <list|none>
```

A missing or garbled line makes the wave NON-CLEAN.

---

## LAW 1 — the fork lives in exactly ONE place, at the resolution point

Where two representations of one identity coexist, the decision of WHICH to use is made once, at the
single point that resolves them into a handle. Everything downstream carries the resolved handle and
is blind to which arm produced it.

**Defects:**
- an inline `a ?? b` / `if (a) … else b` coalesce at a call site, where a shared codec (the
  shared key/handle helper in `lib/` or the feature's `lib/` that resolves the two representations) already exists — every inline
  copy is a fork that can drift from the codec
- a function taking BOTH representations as parameters and re-deciding internally, when it could take
  one resolved handle
- arm-awareness leaking into a UI component, formatter, comparator, sort key, or pure helper that has
  no business knowing which arm it received
- the same fork made twice on one path (resolved at the query layer AND again at the render layer) —
  report the input on which the two can disagree
- **forking too high**: one arm discarded early, so a lower layer cannot recover it even though it
  needs to

**Not a defect:** the resolution point itself branching. That is its job. A second branch inside the
adapter that physically queries one column per arm is also fine — the arm split belongs at the query
boundary. What must not spread is the *decision*.

**Verdict:** name the file:line, where the fork SHOULD live, and whether the forks can actually
disagree (with the input that makes them).

---

## LAW 2 — a refactor leaves no debris

Compiler-led renames, extractions and helper-adoptions are the highest-yield debris generators, and
a green typecheck proves nothing about any of these.

**Defects:**
- `const x = y` where both are plain identifiers and `x` is a bare alias — an indirection left behind
- a helper, type or export now unreferenced, or a value used exactly once immediately after
  definition for no reason — the debris lint cannot see. An unused local, parameter or import is
  `@typescript-eslint/no-unused-vars`' finding, not yours; leave it to lint
- a wrapper that no longer wraps: forwards its arguments unchanged
- the OLD name of a renamed concept surviving in a comment, test name, variable, string literal or
  doc-string, so code and prose now disagree
- a guard the new types made unreachable — and, more dangerous, a guard silently DROPPED that is
  still needed
- **truthiness drift**: `!!x`, `filter(Boolean)`, `x ? …` substituted for an explicit `x !== null` /
  `x !== undefined`. These differ on `""`, `0`, `false`, `NaN`. Whenever a refactor swaps one for the
  other, name the value that distinguishes them or state that none can occur
- `?? null`, `|| []`, `filter(Boolean)` the new types make a no-op — or that changed behaviour
- change-narration comments ("now uses", "instead of", "no longer", "previously") rather than
  descriptions of current behaviour

**Verdict:** per hit, cosmetic debris vs actual behaviour difference, with the distinguishing input.

---

## LAW 3 — every consumer, or none

The costliest mode. When adjacent logic was implemented in two-or-more places rather than
single-sourced and parameterized, a fix lands in one copy and silently not the others. The result is
not a crash; it is two surfaces that disagree, which is far harder to notice.

**Required work — this lens is not satisfied by reading the diff:**
- for every symbol whose signature or semantics the diff changed, search every consumer repo-wide —
  **including test files, string literals, raw SQL, RPC names, and generated types** — and report any
  consumer left behind. Use `git grep` or `rg --hidden -g '!.git'`: a bare `rg` skips dot-directories
  (`.agents/`, `.claude/`, `.github/`) and answers zero hits, which reads exactly like clean
- search for the SHAPE of the changed logic, not only its name: the sibling that was written by
  copy-paste does not share the identifier
- **the sibling-query test**: for every query taught the new behaviour, find the query beside it —
  the count, the total, the summary, the export, the CSV, the tooltip, the cache warmer — and check
  it learned the same thing. A list that now includes a row while its own count still excludes it is
  the original bug moved one line over
- **the contract test**: a persisted contract (DB column, JSON metadata key, RPC argument, API
  response field) that gained a case on the write side but not the read side, or vice versa
- for two near-identical helpers, state explicitly: GENUINE duplication (same concept — a bug in one
  is by definition a bug in the other → extract and parameterize) or COINCIDENTAL similarity
  (different reasons to change → leave both; forcing the abstraction here is the worse defect)

**Verdict:** the consumers checked, the consumers missed, and for each miss the input that makes the
two surfaces disagree.

---

## Reporting bar (all three laws)

1. **A finding with no trigger is a suspicion.** Report it, but mark it `latent — no reachable
   trigger` and say why it is still worth fixing. Latent-but-real is valuable; vague-and-unverified
   is noise.
2. **Read the current file, not just the hunk**, and check the callers, before reporting.
3. **No style, naming, formatting or lint** — Prettier and ESLint own those.
4. Three verified findings beat fifteen speculative ones.
