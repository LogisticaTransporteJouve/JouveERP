---
name: adv-review
description: >-
  Adversarial review of a code change (PR, branch, or staged diff) before merging — correctness AND
  cleanliness. Default converge-and-fix runs parallel agent waves, fixing as it goes, to 3
  consecutive clean waves plus one more; verdict-only ("reasons not to merge", "is this safe to
  merge", "senior review") reviews read-only and emits a STRICT merge recommendation. Use for
  "review this PR", "adversarial review", "attack this change", "find bugs before I merge".
  adv-research falsifies claims and adv-planning attacks a plan; this attacks code.
---

# Adversarial Code Review

Attack a code change before it merges. Review two things equally: **correctness** (bugs, edge
cases, invariants, security) and **cleanliness** (does this fit the codebase or reinvent what
exists?). One shared analysis spine feeds two terminal paths.

## Autonomy

> **Runtime:** where a step says "spawn a wave" / "fan out subagents" (`Task`/`Explore`), that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the passes serially, same lenses/gates/floors), see `.claude/skills/_shared/runtime/capabilities.md`.
> **MODE CHECK — do this first.** Read `.claude/skills/_shared/night-shift/detect.md` and follow it (`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken read into a confident, wrong `OFF`). If it records `night-shift: ON`, its **RULE ZERO** governs: never ask,
> never idle, resolve forks from the evidence and log the call. RULE ZERO cancels the _stopping_, not the selectivity: unattended there is nobody to surface to, so a genuine
> product/business call is recorded as `AWAITING-HUMAN: <the question>` in the summary and the run
> continues — never a turn that ends waiting. The restriction carried by "Surface to the user only a genuine
> product/business call" (below) and "reserve questions for business-logic calls" (under `## Rules`) is
> untouched: surfacing
> is still reserved for that narrow class and everything else is still yours to decide from the code. ⚠️ **Never give a read-only `Explore` agent autonomy** — no doctrine paste, no "decide and proceed": its contract is to report upward, it holds `Bash`, and telling one to act is how a read-only agent becomes a writing one. It overrides NONE of this skill's rails —
> the wave floors (≥4 subagents, ≥3 consecutive clean waves then one more), "any unresolved HIGH → DO NOT
> MERGE", the migration EXPLAIN HARD GATE, and the never-raise list. A stated minimum binds exactly as a
> cap does: exceed it freely, never go under, and report actual-vs-floor.

## Two paths — routed by trigger, not a flag

Pick the path from how you were invoked. There is **no `--mode`**; the trigger phrase selects it.

- **PATH A — converge & fix** (default; "review this PR", "adversarial review", "attack this change").
  Run the spine in parallel waves, **fix everything fixable as you go**, loop to convergence.
- **PATH B — verdict-only** ("reasons not to merge", "is this safe to merge", "senior review",
  "review someone else's PR"). Run the spine **read-only** over **Explore-only** subagents, **no
  fix step**, and emit the STRICT merge-recommendation contract below. Confirm bugs with a red
  test, then **delete it**.

Both paths share Steps 0–0g, the spine, and the synthesizer output rules. They differ ONLY in the
terminal step (fix-and-loop vs verdict-and-stop) and subagent tools (fixing vs Explore-only).

**Run end-to-end. Do not stop and check in.** Surface to the user only a genuine product/business
call you cannot resolve by reading the code. In PATH A, **Boy-Scout**: an obvious bug/dup — fix it.

## Scope the diff first

- Identify the change: `git diff <base>...HEAD` (or staged diff, or `gh pr diff`), then `git status`
  and read the WORKING-TREE version of every file — a caller mid-build leaves edits uncommitted on
  purpose, and the committed diff would both hide them and re-flag what they already fixed.
- Note the repo commands: `pnpm test` (Vitest), `pnpm lint`, `pnpm typecheck`, `pnpm build`; plus
  `pnpm db:types:check` only when `supabase/` changed AND a local stack is already running.
- Research prior art up front: for each new helper/type/query/component, grep for the existing
  pattern and learn the conventions (error handling, naming, data access, timezones, txns, locale).

## Step 0 — Load the calibration (before Wave 1 / Pass 1)

Read the ENTIRE file `.claude/skills/_shared/review-calibration/defect-catalog.md` — every line —
and **prepend it to EVERY subagent prompt** (pass the absolute path; worktrees are separate dirs). Also prepend `.claude/skills/_shared/subagent-constraints/working-location.md` (orientation) to every subagent prompt, and prepend `.claude/skills/_shared/subagent-constraints/hard-constraints.md` verbatim to every READ-ONLY subagent (Track-1 analysts and all of PATH B, which are `Explore`) — writers get orientation ONLY, never the read-only fence; when a PATH-A fix writer runs in its OWN separate worktree, fill its `ROOTS:` line with THAT writer's worktree path + branch (what pins it to its own tree); when writers share the review checkout, ROOTS names that checkout.
Each subagent must, on its `catalog:` line in the load-proof header block (Step 0c), echo the count
of Curated classes it read; a wave/pass with any missing or zero echo is **NON-CLEAN** and does not
count toward convergence. Look
hardest where the Curated classes recur; **never raise anything in the catalog's "Known false-
positives" section**. Cite catalog classes by their `**[bracket name]**`, not by line number.

## Step 0b — Load the ports lens (before Wave 1 / Pass 1)

Read `.claude/skills/enforce-ports-and-adapters/SKILL.md` — every line, including the layer map and feature-slice rules — then
**paste the condensed lens from `.claude/skills/_shared/ports-lens/condensed-lens.md` verbatim
into EVERY subagent prompt** (a "see X" reference is inert; subagents inherit nothing). That block
carries its own load-proof: each subagent's `ports-lens loaded: … | touched layers: <list|none>`
line in the header block ("none" is a clean pass; a missing/garbled line = NON-CLEAN), and the
per-law verdict (four verdicts if a port surface is touched, else one `ports: N/A` line). Always on.

## Step 0c — Load the clean-code lens (before Wave 1 / Pass 1)

Read `.claude/skills/enforce-clean-code/SKILL.md` — every line — then **paste the condensed lens
from `.claude/skills/_shared/dry-lens/condensed-lens.md` verbatim into every subagent that runs the
cleanliness/DRY pass — Track-1 in PATH A's waves, and every spine subagent in PATH B (verdict-only).** It enforces the DRY-progression law: the 2nd occurrence of a concept forces a mandatory
recorded check (extract genuine same-concept duplication, or leave with a falsifiable rationale, or
reuse an existing helper — including one found by `rg`-ing the repo outside the diff), and flags both
a missed extraction AND a forced/premature abstraction. Always on, like the ports lens.

## Step 0d — Load the algorithmic-performance lens (before Wave 1 / Pass 1)

Read `.claude/skills/_shared/perf-lens/condensed-lens.md` — every line — then **paste it
verbatim into every subagent that runs the
cleanliness/perf pass — Track-1 in PATH A's waves, and every spine subagent in PATH B
(verdict-only).** It enforces the scaling law: work on a hot path must stay bounded by a
page/working set (never total data), every large-table access carries a selective indexed filter,
nothing is summed in JS over a PostgREST result that `max_rows` (1000) may have truncated, pages go by
keyset not offset, independent queries run in `Promise.all`, unknown-size work is paged + resumable + concurrency-capped, and set logic
lives in the DB (no N+1). It carries its own load-proof (`perf-lens loaded: … | data touches:
<list|none>`) and a per-law verdict (five verdicts if a data-scaling surface is touched, else one
`perf: N/A` line). Always on, like the ports and clean-code lenses.

## Step 0e — Load the comment-value lens (before Wave 1 / Pass 1)

Read `.claude/skills/enforce-comment-value/SKILL.md` — every line — then **paste the condensed lens
from `.claude/skills/_shared/comment-lens/condensed-lens.md` verbatim into every subagent that runs the
cleanliness pass — Track-1 in PATH A's waves, and every spine subagent in PATH B (verdict-only).** It
enforces the comment-value law: every comment the diff adds or touches earns a verdict (DELETE /
KEEP+ANCHOR / REWRITE / HOIST / REFACTOR-INSTEAD) via the bug-filing test + the derivable/recoverable
classifier, change-narration is stripped to current behaviour, and an unclear comment is REWRITTEN,
never DELETED. It carries its own load-proof (`comment-lens loaded: … | comment surface: <list|none>`)
and a per-diff verdict. Always on, like the ports/clean-code/perf lenses — **but its findings are
comment-only edits: fix them in the wave, and per the consecutive-clean-counter rule (comment-only
waves count as clean) they do NOT reset convergence.**

## Step 0f — Load the telemetry lens (before Wave 1 / Pass 1)

Read `.claude/skills/_shared/telemetry-lens/condensed-lens.md` — every line — then **paste it
verbatim into every subagent that runs the
cleanliness pass — Track-1 in PATH A's waves, and every spine subagent in PATH B (verdict-only).** It
enforces the telemetry law: every signal the change emits (logs, error captures, audit rows, Sentry
config) flows through the house pipeline (`lib/logger.ts` for logs; `captureException` /
`captureMessage` in `lib/observability.ts` → Sentry for errors; `logAudit()` → the append-only
`audit_events` table for audit facts), uses stable greppable names, carries ids and counts as
context (user id, entity id, Inngest attempt, AFIP code), and never carries a secret, PII, an
amount, a CUIT/DNI/CBU, AFIP credentials, or extracted JSON — and a behavioral diff that adds a
failure surface (route handler/server action/retry/fallback/outbound AFIP, AI or email call/Inngest
step) yet emits nothing is a silent-failure-surface defect, not a neutral absence. It carries its own load-proof (`telemetry-lens loaded: … |
telemetry surface: <list|none>`) and a per-law verdict. Always on, like the ports/clean-code/perf
lenses — its findings are real defects that reset convergence.

## Step 0g — Load the identity & refactor-completeness lens (before Wave 1 / Pass 1)

**Paste `.claude/skills/_shared/identity-lens/condensed-lens.md` verbatim into EVERY subagent —
both tracks in PATH A, every spine subagent in PATH B.** It carries three laws no other lens covers:
**(1) fork height** — where two representations of one identity coexist, the decision of which to use
is made ONCE, at the resolution point, and everything downstream carries the resolved handle blind to
its arm; **(2) refactor debris** — bare aliases, no-op wrappers, surviving old names, dropped guards,
and truthiness drift (`!!x` / `filter(Boolean)` swapped in for an explicit `!== null`, which differ on
`""`/`0`/`false`); **(3) consumer completeness** — every consumer of a changed symbol found by a
repo-wide `git grep` including tests, raw SQL and string literals, plus the sibling-query test (the count
beside the list, the total beside the summary, the export beside the view) and the write-side/read-side
contract test. It carries its own load-proof (`identity-lens loaded: … | surface: <list|none>`) and a
per-law verdict. Always on, like the ports/clean-code/perf/comment/telemetry lenses.

Law 3 cannot be satisfied by reading the diff — a subagent that reports it CLEAN
without naming the consumers it grepped has not run it, and that wave is NON-CLEAN.

## Step 0h — Load the role-isolation lens (CONDITIONAL — only when the diff has a DB/authz surface)

Unlike the lenses above, this one is **not always on**. It activates when the diff touches
`supabase/migrations/**`, an RLS policy, a `GRANT`/`REVOKE`, a `SECURITY DEFINER` function, any use of
`getServiceClient()` (`lib/supabase/service.ts` — service role, bypasses RLS), a storage bucket or its
policies, a `"use server"` file, an HTTP route handler (`app/api/**/route.ts` — including
`app/api/inngest`, the AI chat route, the PDF and export routes), an AI tool (`features/ai/tools/**`),
or `lib/auth/**`; on any other diff it
is a **no-op** and no wave pays for it. When it fires: Read
`.claude/skills/enforce-role-isolation/SKILL.md` — every line — then **paste the condensed lens from
`.claude/skills/_shared/role-lens/condensed-lens.md` verbatim into
every subagent that runs the SECURITY pass — Track 2 in PATH A's waves (Track 2 also writes the
targeted tests, which is where the verified-to-fail law lands), and every spine subagent in PATH B
(verdict-only).** It enforces the role law: every `"use server"` export and route handler calls
`requireUserContext()` + `userCan(ctx.roles, "<perm>")` with the permission matching the operation
BEFORE `getServiceClient()`; every new table has RLS in its creating migration with policies on
`(select public.user_has_role(array[...]))` in BOTH `USING` and `WITH CHECK`; `anon` is granted
nothing; a `SECURITY DEFINER` function sets `search_path` and checks the role inside, never trusting a
parameter; `REVOKE ... FROM PUBLIC` alone is a no-op on Supabase — revoke from `anon, authenticated`
too; self-scoped rows filter by `ctx.userId`; AI tools go through gated actions; new permissions live
in `lib/auth/permissions.ts` with its test; and every fix ships a test **observed to fail against the
pre-fix state**. It carries its own load-proof (`role-lens loaded: … |
db/authz surface: <list|none>`) and a per-law verdict (or one `role: N/A` line when no DB/authz
surface is touched). Its findings are
real defects that reset convergence.

**Load-proof header block** — every subagent opens its output with these labelled lines, in this
order (emit only the lines for the lenses it carries); each lens's tripwire keys on its own prefix,
NOT on being literally line 1, and a missing/garbled line for a lens it carries = NON-CLEAN:

```
catalog: <N> classes read
ports-lens loaded: … | touched layers: <list|none>
dry-lens loaded: 2nd-occurrence check performed | duplication surface: <list|none (with scanned surface)>
perf-lens loaded: work bounded by page/working-set, not total data | data touches: <list|none>
comment-lens loaded: every touched comment classified | comment surface: <list|none>
telemetry-lens loaded: every emission routed/named/bounded/clean | telemetry surface: <list|none>
identity-lens loaded: fork-height | refactor-debris | consumer-completeness | surface: <list|none>
role-lens loaded: holding a session is not holding the permission | db/authz surface: <list|none>
```

## The analysis spine — four ordered passes (shared by both paths)

Run these four passes IN ORDER over the diff. The catalog (Step 0) is the encyclopedia of what
recurs in each pass — go there for the defect shapes; the passes below are only the procedure.

1. **Intent** — does the change do what the request/PR asked, and only that? A refactor/port that
   silently reverts a shipped feature, drops a returned field, or resurrects debug logs is a
   finding. Reason about the MERGED result of a stacked chain. (Catalog: **[doc / PR-body over-claim]**.)
2. **Negative-requirement invariants** — confirm the diff cannot violate them; the shapes live in
   the catalog, not here: **[idempotency / concurrency / atomicity]**, **[money / financial math]**,
   **[authorization / role-gating / IDOR]**, **[migrations — ordered, append-only, typed]**,
   **[double-entry / accounting integrity]**, **[fiscal invoicing / AFIP rules]**,
   **[data exposure / audit logging / telemetry leaks / inbound callbacks]**. Look hardest at the highest-frequency classes.
3. **Correctness & edge cases** — per changed function: nulls, empty collections, timezone/locale
   bounds, max-length input, concurrent writes, stale state after mutation/sign-out/user-switch/retry,
   silently swallowed errors, pagination drain / row caps, contract/schema-key mismatch. (Catalog:
   **[stale cache …]**, **[silently-swallowed / unchecked errors]**, **[PostgREST truncation / keyset pagination soundness]**.)
4. **Security** — the new attack surface beyond Pass-2: who can reach a new endpoint and with what
   asserted by whom, whether a role lacking the permission can drive a client-delegated path,
   orphaned mutations on abort. Plus the **[type-tightness]** and **[user-facing copy …]** cleanliness lenses.

## PATH A — wave engine & convergence

⚠️ **Under the mode, any PATH-A subagent that WRITES gets the doctrine** — paste
`.claude/skills/_shared/night-shift/condensed-doctrine.md` verbatim into its prompt, and check its
result for the verbatim first line `night-shift doctrine loaded: decided-not-asked | judgement calls:
<count> | open questions: none`; missing means the paste never landed and that wave is **NON-CLEAN,
re-run it**.

⚠️ **This applies only when you actually spawn a writer.** On the uncommitted-change path — the
`/auto-build` P2→P3 handoff, always — the orchestrator applies the FIX edits itself, so there is no
fix-writer subagent to check. **Track 2 is still a writer** on that path: it writes the targeted
tests, so it gets the doctrine paste and MUST emit the proof line, exactly as on any other path.
Only a wave that spawned no writer at all is exempt, and "no writers this wave" is a claim you have
to be able to point at — if Track 2 ran, there was a writer. Read-only Track-1 analysts and all
PATH-B agents are `Explore`: they get **neither** the doctrine nor autonomy, ever.

Each wave spawns **at least 4 parallel subagents — minimum 2 per Track**. Separate worktrees only when the change is COMMITTED; a fresh worktree contains committed content only, so if the change is uncommitted (the `/auto-build` P2→P3 handoff always is) every subagent shares THIS checkout and its `ROOTS:` names it — otherwise the wave reviews a tree without the code in it. A shared checkout loses the write isolation worktrees gave you, so on that path serialize the writes: subagents still analyse in parallel, but only ONE writes at a time (the orchestrator applies fixes and lets Track 2 write its tests in turn). Never two concurrent writers in one tree. **Track 1** carries passes 1–3 +
cleanliness/reuse + the ports lens + the clean-code (DRY-progression) lens; **Track 2** carries pass 4 + the role-isolation lens whenever it fires (Step 0h) + writes targeted tests for the risks
Track 1 surfaces, runs them, and runs the FULL suite. After each wave, synthesize into one ranked
list, **fix everything fixable** (reusing the researched patterns), and re-run the suite green.
Keep a **consecutive-clean counter** at 0:

- Any finding → fix all, **reset to 0**.
- Zero findings → increment.
- **Comment-only** and **pure test-coverage-gap** waves count as clean (make the edits, don't reset).
- **Require ≥3 consecutive clean waves — then run ONE MORE.**
- ⚠️ **Ceiling: 12 waves, or 6 since the last finding whose remedy touched a production file**
  (the same test that decides whether a wave counts as clean — comment-only and pure test-coverage
  waves do not reset the counter and do not restart this one). At the cap, stop: log
  `FAILED: adv-review did not converge — <N> waves, outstanding: <list>` and hand on with that stated.
  A non-converging review is a reportable result; an unbounded one spends the night and ships nothing.
- ⚠️ **A load-proof tripwire (catalog / ports / dry / perf / comment / telemetry / identity / role / doctrine) may re-run a wave at most TWICE.** If
  the same line is still missing on the third attempt, the fault is in how you are building the
  prompt, not in the subagent: fix the prompt, or record `FAILED: <which> load-proof never emitted`
  and count the wave. Never let a missing echo loop forever — it blocks the counter without ever
  examining the code.

When you believe it has converged, run one additional wave anyway before stopping — visible
convergence is not proof, and the waves exist to catch what earlier agents missed. Then report:
everything fixed, final test pass/fail, waves-to-converge.

## PATH B — verdict-only

Run the spine once, read-only, over Explore-only subagents. Do NOT edit, push, or open anything.
Prefer practicality over theoretical completeness; never trade silently-wrong for silently-broken.
Out of scope: style/naming/lint/formatting (Prettier/ESLint own these). Emit the contract below.

## Synthesizer output rules (both paths)

- **Red-test discipline.** Confirm a suspected bug with a TEMPORARY red test asserting the wrong
  current behavior. PATH A: keep it (it becomes the regression test). PATH B: prove, then DELETE it.
  Tag every finding **[CONFIRMED-BY-TEST]** or **[SUSPECTED]**. Distrust green specs on stale fixtures.
- **Never-raise.** Never surface anything in the catalog's "Known false-positives" section.
- **STRICT verdict (PATH B — match exactly).** Three single-line headers, then severity-sorted findings:

```
Intent: <what the request/PR asked, one sentence>
Verified clean: <high-risk areas checked and found sound, one sentence>
Merge recommendation: <MERGE | MERGE WITH FOLLOW-UPS (#x) | DO NOT MERGE (#x)>

N. [SEVERITY: high|medium|low] [CONFIRMED-BY-TEST|SUSPECTED] file:line
   Trigger: <input that breaks it>. Expected vs actual: <…>. Red test: <the assertion, or why none>. Fix: <minimal change>.
```

Any unresolved HIGH → recommendation MUST be **DO NOT MERGE**. Defer non-blocking issues to the PR
body's `## Follow-ups`. Zero findings → the three headers then `No findings.` and nothing else.

## Migration EXPLAIN — HARD GATE (executed here, not deferred to the catalog)

Every migration or change to a query/RPC/function/view/trigger/index MUST be `EXPLAIN (ANALYZE)`'d
against a realistic LARGE dataset (a local DB seeded with 100k+ rows across `transactions`,
`journal_entry_lines`, `invoices`, `receipts`, `audit_events` — only on a local stack that is ALREADY
running, never started unprompted — or via read-only Supabase MCP; note row counts) and the plan pasted
in. No local stack and no read-only access → record `EXPLAIN: not run (no database available)` as an
open HIGH and say so in the verdict; never fake a plan. **DB-executed SQL without a plan is itself a
CRITICAL blocking finding — treat it as unreviewed.** Hunt: non-sargable predicates (`COALESCE`/
function on a WHERE/JOIN column, an OR guarded by a correlated outer value, a join on an expression);
a `Seq Scan` on a hot table inside a correlated `SubPlan` with `loops` >> 1; the **authenticated-path
budget** — any query reachable via PostgREST as `authenticated` MUST finish under that role's
`statement_timeout` (check `supabase/config.toml` / the hosted setting) or it silently aborts in
prod. A self-admitted unindexed scan
is CRITICAL — the index ships in the SAME PR, never "out of band". Prove index-fixable vs needs-
restructure (`SET enable_seqscan=off`; expression index for an expression aggregate); try one output-
identical faster reformulation and verify equivalence (`EXCEPT` both directions = 0 rows). Multiply
per-call cost by call frequency. Defect shapes: catalog **[migration EXPLAIN gate …]**, **[perf: cost × call frequency]**.

## Rules

- Judge ACTUAL behavior, not whether tests match the code.
- DRY-progression: apply the clean-code lens (Step 0c) — 2nd occurrence forces a mandatory recorded check; extract genuine same-concept duplication, else leave with a falsifiable rationale. Both a missed extraction and a forced/premature abstraction are defects.
- Never WRITE to the production DB — no DDL, no DML, no `supabase db push`, no `supabase link`. Read-only queries are the only remote access (that is what the EXPLAIN gate above uses when no large local dataset exists); schema changes go through migration files only.
- PATH A only: resolve review threads for things you've fixed — BOT threads only (whichever review bots are enabled — e.g. `github-actions[bot]` posting the `Claude Code Review` workflow's comment, which only runs once the human marks the PR ready, or `copilot-pull-request-reviewer`). Never resolve a human's thread and never reply to one; reserve questions for business-logic calls.
