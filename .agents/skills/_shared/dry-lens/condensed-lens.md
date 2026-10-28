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
 B. PRE-EXISTING (highest value): the diff RE-IMPLEMENTS a helper/constant/type/client/query already
    in the repo. For each non-trivial added function / constant / guard / query, search by OUTPUT and
    DOMAIN NOUN first (which existing code already returns this figure, canonical form, client or
    predicate? grep the noun — saldo, CUIT, canal, cotización, asiento — and likely helper verbs
    resolve*/normalize*/format*/is*/*ForRange in lib/, the feature's lib/ and the sibling feature
    that owns the noun), then the literal value(s) or a distinctive 4-6 token slice of the body, with
    `git grep` / `rg --hidden -g '!.git'` across the repo OUTSIDE the diffed files. Re-derivations
    rarely share text with the original. A hit = candidate; cite its file:line — the diff must IMPORT
    it, not re-implement it. Skipping this search makes "none" a lie.
 C. GUARD DIFF: when a producer exists, list what it does that the new code doesn't (a guard, a
    fail-closed branch, canonicalisation, the max_rows drain, channel/date-range resolution). A
    re-implementation that drops a guard takes on that guard's severity. A hoist is a MOVE: the old
    definition and its imports are gone afterwards.

CHANGES-TOGETHER (present-tense + mechanical — do NOT predict the future). Two blocks are ONE concept
iff ALL THREE hold NOW:
 1. SAME NOUN — both encode the same named rule/constant/shape (say it in ONE word; can't ⇒ leave).
 2. SAME-ANSWER-REQUIRED — for one shared input, correctness DEMANDS identical output.
 3. BUG-MIRRORS — a defect in copy A is, BY DEFINITION, also a defect in copy B (read both; present
    check, not a forecast).
Any one absent = COINCIDENCE → LEAVE. Divergent-reasons: look-alike blocks written to satisfy
DIFFERENT requirements = leave even if byte-identical today. Skeletons (Inngest function shell, CI
step, test harness) repeat by design: 2nd copy = LEAVE + NOTE (death: a third copy); 3rd = extract.

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

SIMPLEST MECHANISM (raise as QUESTIONS naming the alternative and what it would delete; a defect only
when the simpler alternative provably covers the need and the PR is silent): for each new Inngest
function/cron, timer, cache, flag, setting, toggle, CI step, script, dependency, wrapper, state
machine, second delivery path or per-channel variant — what is the simplest existing or standard
thing that does this? House answers: a static lookup table, not a stateful cache; a status/soft-delete
column + a periodic Inngest reaper, not a long-running workflow; native GitHub needs:/environment
protection, not polling; the tool's own flag or an installed dependency (Zod, fast-xml-parser), not
hand-rolled parsing; fix the PRODUCER (prompt, mapper, writer, RPC), not the downstream symptom; no
new setting unless someone would deliberately choose the non-default.
TUNING NUMBERS: a new timeout / concurrency / throttle / lookback / batch or page size / threshold in
production code gets a name or a one-line reason; a value derived from other constants is built from
them. Layout values and test data exempt.
NEXT MEMBER: for each special case, variant branch, per-variant copy or list every member must join
(a real family — a sibling exists or the ticket names the next one), list the files this member
touched (= what the next one touches) and the shape that makes it one edit. Should-fix on a one-way
door, question on a two-way door; never overrides CHANGES-TOGETHER.
NAMES: raise a name only when it misleads (misstates scope/meaning), or when a NEW name on a one-way
door (column, RPC, audit event type, exported contract) departs from the house term (comprobante,
CAE, asiento, canal, recibo — grep it first). Finish a rename everywhere (code, tests, strings, SQL,
docs). No lineage markers naming a predecessor/successor of the same thing (fooV2 beside foo,
oldX/newX, legacy*); domain terms (a trigger's `old` row) are fine.

DEBRIS (owned by this lens — compiler-led renames, extractions and reroutes leave it; a green
typecheck proves nothing): bare alias `const x = y`; a pass-through wrapper that forwards unchanged;
an unreachable old path/flag/helper/type/export left after rerouting (grep repo-wide incl. tests, SQL
and dot-dirs before calling it unreferenced); a value used once right after definition for no reason;
the OLD name surviving in a comment/test name/variable/string; a guard the new types made unreachable
— or, worse, one silently DROPPED that is still needed; truthiness drift (`!!x`, `filter(Boolean)`,
`x ? …` swapped for `x !== null` — name the distinguishing value: "", 0, false, NaN) and `?? null` /
`|| []` made a no-op or changed; scratch files / planning notes committed. Unused imports/locals =
lint's, not yours. Change-narration comments = comment lens; consumers left behind = reach lens.
Per hit: cosmetic vs behaviour difference, with the distinguishing input.

VERDICT: per repeated concept, PASS|DEFECT + one line (extracted / justified-inline / MISSED-REUSE /
WRONG-ABSTRACTION). Per mechanism/next-member/name question raised, one line naming the alternative.
Per debris hit, one line. If nothing repeats, emit exactly:
  dry: N/A — no repeated concept (checked in-diff + repo-wide).
and, separately, `debris: none` or the debris hits.
=== END DRY-PROGRESSION LENS ===
```
