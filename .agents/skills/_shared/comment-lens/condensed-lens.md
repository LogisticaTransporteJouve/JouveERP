# Condensed comment-value lens (paste verbatim per subagent)

This is the block review/build skills paste into EVERY cleanliness subagent prompt (a "see the comment
skill" reference is inert — subagents inherit nothing but their prompt). The fat
`enforce-comment-value/SKILL.md` (full classifier, calibration fixtures, never-touch encyclopedia) is
the ORCHESTRATOR's Read; subagents get only the block below.

```
=== COMMENT-VALUE LENS (classify every comment the diff adds or touches) ===
On its own `comment-lens loaded:`-prefixed line in the load-proof header block (header order: catalog,
ports-lens, dry-lens, perf-lens, comment-lens; the tripwire keys on the PREFIX, not on line position),
or this wave is NON-CLEAN and re-run:
  comment-lens loaded: every touched comment classified | comment surface: <file:line list | "none — no comment added/touched in diff">
("none" is a CLEAN pass. A missing/garbled comment-lens line = NON-CLEAN. Comment-value findings are
comment-only edits — fix them in the pass; they NEVER block a merge and never reset a clean counter.)

THE ONE LAW: a comment must carry information the code cannot, that a competent reader would otherwise
get wrong. Everything else is a liability — a read on every visit, a diff on every change, paying nothing.

BUG-FILING TEST (primary gate): without this comment, would a competent reader make a WRONG change —
assume something false, "fix" something deliberate, or file a bug against correct code? YES = load-bearing.
NO = delete; it only plants the idea it answers.

TWO-QUESTION CLASSIFIER (in order):
 Q1 DERIVABLE? Claim recoverable from the enclosing function (or ±20 lines at file scope), no jumping
    files? → YES = DELETE. Restatement, narration of the next statement, a docstring echoing the
    signature, step-numbered running commentary, "// Update existing record" above an update.
 Q2 RECOVERABLE from this repo at all (types, tests, an adjacent module)? → NO = KEEP. The comments that
    pay: external-system behaviour (what Supabase/PostgREST/Inngest/AFIP WSFEv1/an AI provider/a library actually does, esp. vs its
    docs/name); a decision + why the alternative was rejected + its death condition; an invariant the
    types don't express (units, inclusive/exclusive, nullability, ordering); a hazard the code's shape
    invites (silent truncation, overflowed querystring, swallowed error, role check or `channel_id` filter that must
    stay in the predicate); a load-bearing constant's rationale + which way to move it.
 Rot risk is NOT a delete reason — an external-system comment goes stale BECAUSE it describes what this
 repo doesn't control; that is its value. Rot risk = ANCHOR it, never drop it.

CHANGE-NARRATION (cuts across Q1/verdicts): a comment describing the EDIT, not current behaviour.
 EXPLICIT: "was X, now Y", "previously", "used to", "changed from", "renamed", "moved from", "no longer".
 IMPLICIT/comparative: "rather than X", "instead of X", "not X but Y", "as opposed to", "unlike X".
 Strip the contrast; state only what the code does now — change rationale/migration notes go in the PR
 body, never the code. `// this was in ARS, now USD (MEP)` → `// USD (MEP)` (or delete if the code already
 says it); `// keyset-paginate, rather than OFFSET` → `// keyset-paginate`. Whole comment is contrast →
 DELETE; only a clause → REWRITE.

FIVE VERDICTS (record one, act now):
 • DELETE — Q1 derivable. No replacement.
 • KEEP+ANCHOR — Q2 unrecoverable. Name the external fact it depends on; reference constants BY NAME not
   value; give temporaries a death condition (+ ticket where one exists). Anchoring is mandatory.
 • REWRITE — right fact, wrong form (buried in narration, throat-clearing, or no longer matches the code).
   Keep the fact, cut to the shortest form that survives the bug-filing test.
 • HOIST — real fact at the wrong altitude: a per-line contract belongs on the interface; a fact repeated
   across sibling call-sites belongs once at the definition. Hoisting turns N comments into one.
 • REFACTOR-INSTEAD — the comment exists only because the code is unreadable (step-numbered block, a
   divider inside one function = a request for a named function). Propose the extraction; do NOT silently
   restructure logic in a comment pass.

ASYMMETRY (safety rail — do not average away): noise-kept = a wasted line, caught next pass (cheap,
reversible). Context-destroyed = an unrecoverable fact deleted, gone from the repo (permanent). So when a
comment's value is UNCLEAR the verdict is REWRITE, never DELETE. "I couldn't tell what this was for" is
the strongest signal it carries something you don't have.

NEVER TOUCH: tool directives (eslint-disable, biome-ignore, @ts-expect-error, # noqa, #pragma, //go:);
license headers + shebangs; JSDoc/TSDoc on a public/doc-tooled API; TODO/FIXME/HACK
that references a ticket (an unreferenced one is REWRITE — give it a ticket — not DELETE); a test's intent
+ expected-value arithmetic; SQL migration comments; anything in a generated file. Section banners
(// ====, // Constants) make no claim, cannot rot — LOWEST priority, never spend review attention on them.

SCOPE: comments only — never change behaviour, names, or control flow. REFACTOR-INSTEAD is a PROPOSAL
unless the invocation authorised refactoring.

VERDICT: per comment the diff adds/touches, emit the verdict + one line. If none, emit exactly:
  comment: N/A — no comment added or touched in diff.
=== END COMMENT-VALUE LENS ===
```
