# Condensed clean-code / DRY-progression lens (paste verbatim per subagent)

This is the block review/planning/build skills paste into EVERY subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). The fat `enforce-clean-code/SKILL.md` is
the orchestrator's Read; subagents get only the block below.

```
=== DRY-PROGRESSION LENS (attack every change for un-checked 2nd occurrences) ===
Emit in your load-proof HEADER BLOCK, on its own prefixed line (header order: catalog, ports-lens, dry-lens):
  dry-lens loaded: 2nd-occurrence check performed | duplication surface: <file:line list | "none (checked: new fn/const/guard bodies vs existing helpers repo-wide; cross-feature features/<a>↔features/<b>↔lib/; TS↔SQL constants)">
("none" is a CLEAN pass ONLY when the scanned surface is stated. A bare "none" or a missing/garbled
dry-lens line = NON-CLEAN, re-run. A wrongful "none"/"N/A" on a diff that DOES repeat a concept is a
first-class DEFECT, equal severity to a missed extraction.)

THE LAW (rule-of-TWO of the CHECK): the 1st occurrence may be inlined. At the 2nd, the check is
MANDATORY and RECORDED. "I'll dedupe later" = DEFECT — deferral is the sin, not the duplication itself.

FIND the 2nd occurrence — look in BOTH places, not just the diff:
 A. IN-DIFF: two added blocks encoding one concept.
 B. PRE-EXISTING (highest value): the diff RE-IMPLEMENTS a helper/constant/type already in the repo.
    For each non-trivial added function / constant / guard, extract a token (the domain noun, the
    literal value(s), or a distinctive 4-6 token slice of the body) and `rg` it across the repo
    OUTSIDE the diffed files. A hit = candidate; cite its file:line — the diff must IMPORT it, not
    re-implement it. Skipping this search makes "none" a lie.

CHANGES-TOGETHER (present-tense + mechanical — do NOT predict the future). Two blocks are ONE concept
iff ALL THREE hold NOW:
 1. SAME NOUN — both encode the same named rule/constant/shape (say it in ONE word; can't ⇒ leave).
 2. SAME-ANSWER-REQUIRED — for one shared input, correctness DEMANDS identical output.
 3. BUG-MIRRORS — a defect in copy A is, BY DEFINITION, also a defect in copy B (read both; present
    check, not a forecast).
Any one absent = COINCIDENCE → LEAVE. Divergent-reasons: look-alike blocks written to satisfy
DIFFERENT requirements = leave even if byte-identical today.

THREE LEGAL VERDICTS, all acted on NOW (never deferred) — the same three as enforce-clean-code:
 • EXTRACT — same concept + all-three + >=2 real call-sites; the 2nd site IMPORTS, never re-implements.
   (Two impls of one contract across a boundary ⇒ the shared interface IS a port → hand placement/
   naming/DAG to enforce-ports-and-adapters.)
 • REUSE — a helper/pattern already covers it; call that instead of adding a third copy.
 • LEAVE + NOTE — one line that names BOTH: (a) a CONCRETE, FALSIFIABLE independent-change axis — a
   specific future edit that would hit one copy and NOT the other (vague "different reasons" /
   "coincidental" = DEFECT); and (b) the DEATH CONDITION — the event on which they become one concept
   and must be extracted. Missing EITHER = defect. If the honest answer to "would a real behavioral
   fix touch BOTH copies?" is yes, the axis is a lie → MISSED-REUSE defect.

NO-SOFTENING HARD BLOCKERS — LEAVE / duplicate-on-purpose is UNAVAILABLE here; the only clean
verdicts are EXTRACT or REUSE:
 - copying an EXISTING helper's body; a 2nd site re-implementing instead of importing an existing shape;
 - cross-feature / cross-language logic drift (features/<a>↔features/<b>↔lib/, TS↔SQL) — one product
   rule, so changes-together is definitionally true;
 - hand-copied constants/enums with no parity gate; a re-inlined named shape; a "temporary" dup with
   no extraction and no follow-up.

TWO SYMMETRIC DEFECTS (report either):
 • MISSED-REUSE — genuine same-concept dup, or a re-implemented existing helper, left un-extracted.
 • WRONG-ABSTRACTION — a forced / flag-parameterized helper fusing coincidental code before the shape
   stabilised. A boolean/mode param that forks a "shared" function into two behaviours is this defect.
NEVER flag: the 1st occurrence; framework/test/config/migration boilerplate; documented
divergence. A repeated TYPE / field-shape belongs to the catalog's [type-tightness]; THIS lens = a
repeated BEHAVIOUR / RULE / constant.

VERDICT: per repeated concept, PASS|DEFECT + one line (extracted / justified-inline / MISSED-REUSE /
WRONG-ABSTRACTION). If nothing repeats, emit exactly:
  dry: N/A — no repeated concept (checked in-diff + repo-wide).
=== END DRY-PROGRESSION LENS ===
```
