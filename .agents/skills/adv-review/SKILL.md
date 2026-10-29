---
name: adv-review
description: >-
  Adversarial review of a code change (PR, branch, or staged diff) before merging — correctness AND
  cleanliness. An orchestrator pre-pass maps the ticket to the hunks, labels scope, finds open PRs
  touching the same symbols and lists the one-way doors; one routing table picks the lenses (some
  always on, the rest by what the change touches); every finding's premise is checked before anyone
  acts on it, and findings are tiered blocking / should-fix / nit / question. Default converge-and-fix
  runs parallel agent waves, fixing as it goes, to 3 consecutive clean waves plus one more;
  verdict-only ("reasons not to merge", "is this safe to merge", "senior review") reviews read-only
  and emits a STRICT merge recommendation. Use for "review this PR", "adversarial review", "attack
  this change", "find bugs before I merge". adv-research falsifies claims and adv-planning attacks a
  plan; this attacks code.
---

# Adversarial Code Review

Attack a code change before it merges. Review two things equally: **correctness** (bugs, edge
cases, invariants, security) and **cleanliness** (does this fit the codebase or reinvent what
exists?). Most misses sit away from the changed line (a sibling path, a consumer, a second
computation of the same answer), so the lenses search outside the diff. One shared spine (Steps 1–5)
feeds two terminal paths.

## Autonomy

> **Runtime:** where a step says "spawn a wave" / "fan out subagents" (`Task`/`Explore`), that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the passes serially, same lenses/gates/floors), see `.claude/skills/_shared/runtime/capabilities.md`.
> **MODE CHECK — do this first.** Read `.claude/skills/_shared/night-shift/detect.md` and follow it (`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken read into a confident, wrong `OFF`). If it records `night-shift: ON`, its **RULE ZERO** governs: never ask,
> never idle, resolve forks from the evidence and log the call. RULE ZERO cancels the _stopping_, not the selectivity: unattended there is nobody to surface to, so a genuine
> product/business call, or a one-way-door question (Step 2, check 7), is recorded as `AWAITING-HUMAN: <the question>` in the summary and the run
> continues — never a turn that ends waiting. The restriction carried by "Surface to the user only a genuine
> product/business call" (below) and "reserve questions for business-logic calls" (under `## Rules`) is
> untouched: surfacing
> is still reserved for that narrow class and everything else is still yours to decide from the code. ⚠️ **Never give a read-only `Explore` agent autonomy** — no doctrine paste, no "decide and proceed": its contract is to report upward, it holds `Bash`, and telling one to act is how a read-only agent becomes a writing one. It overrides NONE of this skill's rails —
> the wave floors (≥4 subagents, ≥3 consecutive clean waves then one more), "any unresolved blocking
> finding or unanswered one-way-door question → DO NOT MERGE", the premise gate (Step 5), the migration
> EXPLAIN HARD GATE, and the never-raise list. A stated minimum binds exactly as a
> cap does: exceed it freely, never go under, and report actual-vs-floor.

## Two paths — routed by trigger, not a flag

Pick the path from how you were invoked. There is **no `--mode`**; the trigger phrase selects it.

- **PATH A — converge & fix** (default; "review this PR", "adversarial review", "attack this change").
  Run the spine in parallel waves, **fix what survives the premise gate as you go**, loop to
  convergence (Step 6a).
- **PATH B — verdict-only** ("reasons not to merge", "is this safe to merge", "senior review",
  "review someone else's PR"). Run the spine **read-only** over **Explore-only** subagents, **no
  fix step**, no pushes, comments or filed issues, and emit the STRICT merge-recommendation contract
  (Step 6b).

Both paths share Steps 1–5 and the analysis spine. They differ ONLY in the terminal step
(fix-and-loop vs verdict-and-stop) and subagent tools (Track 2 writes tests vs Explore-only).

**Run end-to-end. Do not stop and check in.** Surface to the user only a genuine product/business
call you cannot resolve by reading the code, or a one-way-door question. In PATH A, **Boy-Scout**: an
obvious bug/dup — fix it.

## Step 1 — Scope

- **The change.** `git fetch origin main`, then `git diff $(git merge-base HEAD origin/main)` (or the
  staged diff, or `gh pr diff`), then `git status`, and read the WORKING-TREE version of every file —
  a caller mid-build leaves edits uncommitted on purpose, and the committed diff would both hide them
  and re-flag what they already fixed. For a stacked chain, review the tip and reason about the
  MERGED result. For a PR you are not on, fetch it without touching your checkout:
  `git fetch origin pull/<n>/head`, then `git worktree add --detach <scratchpad>/pr-<n> FETCH_HEAD`;
  that path is the review checkout.
- **What runs.** Note the commits that landed on `main`'s touched paths since the merge-base
  (`git log origin/main --since=<branch base date> -- <paths>`) and pass them to the subagents: CI
  runs the merge with `main`, not the branch alone.
- **What it claims.** The PR title and body, the linked issue's acceptance criteria (GitHub issue, or
  Linear only if one is named), the matching `docs/pendientes.md` entry if any.
- **What is settled.** Every existing review thread and the author's replies (catalog premise rule 8).
- **What it touches.** The list of paths; it drives routing in Step 3.
- **Commands.** `pnpm test` (Vitest), `pnpm lint`, `pnpm typecheck`, `pnpm build`; plus
  `pnpm db:types:check` only when `supabase/` changed AND a local stack is already running.
- **Prior art.** For each new helper/type/query/component, grep for the existing pattern and learn the
  conventions (error handling, naming, data access, timezones, txns, locale).

## Step 2 — Pre-pass (orchestrator, once)

These checks need `gh`, git history and the ticket, and give every subagent the same answer, so the
orchestrator runs them once, before Wave 1 / Pass 1.

1. **Ticket.** Map each acceptance criterion to the hunk or test that delivers it. An unmapped
   criterion is a finding unless the PR stops claiming to close it. Restate the ticket's named
   failure as a trigger and check the diff changes that exact path, not a neighbouring one.
2. **Scope.** Label each changed file *named fix*, *needed by the fix* or *unrelated*. Every
   unrelated file, and every behaviour change the ticket did not ask for, is named in the PR body or
   split out. A hunk that changes neither behaviour nor meaning and makes nothing shorter (a sentence
   reworded or made longer, a rule repeated where a check or another file already states it) is
   review load that buys nothing: a should-fix to revert it.
3. **In flight.** List the symbols the diff defines or redefines: SQL functions, tables and columns in
   `supabase/migrations/`, exported types and fields, permissions in `lib/auth/permissions.ts`, AI
   registry members (`features/ai/registry/`), Inngest event names and function ids (`lib/inngest/`),
   `audit_events` event types, query keys. List open PRs
   (`gh pr list --repo LogisticaTransporteJouve/JouveERP --state open --limit 1000 --json number,files`),
   narrow to those whose files share a touched `features/<domain>/`, `lib/` subtree or
   `supabase/migrations/`, and run `gh pr diff <n> | grep <symbol>` on those only. Check whether the
   fix already landed on `main` or another open PR supersedes it. Name each overlap, the side that
   adapts, and the merge order (two migrations in flight: the later timestamp merges second).
4. **Readiness.**
   - The base is `main` (or the stack parent) and the PR is a **draft**.
   - No conflict markers.
   - Every PR the body depends on has merged.
   - Any manual step (a Vercel env var, AFIP configuration, a backfill, a data fix) sits in the PR body
     with the order it must happen in — `promote-to-production.yml` applies migrations and then
     deploys the code, so the order is real.
5. **Evidence.** Some changes need evidence a code read cannot supply. Without it the change is
   *unverified*: a question for the author, not a defect.

   | The change touches | Evidence that counts |
   |---|---|
   | A prompt, a model id, model parameters or an AI tool description (`features/ai/`) | `pnpm eval:ai` (`features/ai/evals/routing.live.test.ts`) or a replay, before and after |
   | A lens law or a lens trigger under `.agents/skills/` | A replay of base against head over a past PR diff where the change should matter |
   | An AI provider, the fallback chain in `features/ai/model.ts`, or an SDK upgrade | A live or recorded run through each link |
   | An AFIP call (`lib/afip/`) | A run against AFIP homologación, or a recorded response, per voucher type touched |
   | A financial computation (IVA, percepciones, FX ARS↔USD, balances, aging, asientos) | An old-vs-new diff over the same data, or a characterisation test |

6. **Necessity.** When the diff is far larger than the ticket's premise implies, ask whether the PR
   should exist in this shape. These are questions, not defects.
7. **Doors.** A change is a *one-way door* when a wrong choice outlives a revert once it merges or
   deploys:
   - a persisted shape: a table, column, CHECK or enum value, jsonb shape, storage bucket or path;
   - a contract outside this deploy: an AFIP-issued voucher (a CAE and its number are an
     irreversible external create), an export format someone else consumes, an `app/api/**` route
     called from outside the app, an Inngest event payload already queued;
   - a persisted or out-of-process name: an Inngest event name, function id or cron, an
     `audit_events` event type, a permission string (it lives in RLS role arrays and in stored rows);
   - a change to existing production data: a backfill, a repair, a reclassification, a renumbering,
     or code that rewrites existing records on its next run.

   Everything else is a two-way door. The PR body names each one-way door, the alternative it
   rejected and why; a missing reason is a question. A change to existing production data also names
   who signs off (the owner) before it merges.

Output a **Scope and in-flight** block, one-way doors included; every subagent receives its summary.

## Step 3 — Load the calibration and route the lenses

**Calibration (always).** Read the ENTIRE file
`.claude/skills/_shared/review-calibration/defect-catalog.md` — every line — and **prepend it to
EVERY subagent prompt** (pass the absolute path; worktrees are separate dirs). Its **Before you
raise** section is the premise rule set every subagent applies before raising a finding. Each
subagent echoes, on the `catalog:` line of its load-proof header block, the count of Curated classes
it read; a wave/pass with any missing or zero echo is **NON-CLEAN** and does not count toward
convergence. Look hardest where the Curated classes recur; **never raise anything in the catalog's
"Known false-positives" section**. Cite catalog classes by their `**[bracket name]**`, not by line
number.

**Routing — the ONE table.** This is the only place lens triggers are defined; every other skill
points here. A trigger names what the change does, not only where it lives. When it is unclear
whether a trigger fires, run the lens. Two delivery modes:

- **Pasted** — the orchestrator Reads the lens's skill (where one exists) in full, then pastes the
  condensed block **verbatim** into the subagents named below (a "see X" reference is inert;
  subagents inherit nothing). Each block carries its own load-proof line and per-law verdict.
- **Read-delivered** — one `Explore` seat per routed lens. Its prompt names the lens's `SKILL.md`; the
  seat Reads it in full, applies its procedure, and **fills that lens's coverage table** — the table
  is its load-proof. No condensed copy exists for these lenses.

**Always on:**

| Lens | Delivery | Carried by |
|---|---|---|
| ports | Read `.claude/skills/enforce-ports-and-adapters/SKILL.md` (incl. layer map and feature-slice rules); paste `.claude/skills/_shared/ports-lens/condensed-lens.md` | EVERY subagent, both tracks and PATH B |
| reach | paste `.claude/skills/_shared/reach-lens/condensed-lens.md` (the lens body itself) | EVERY subagent, both tracks and PATH B |
| dry | Read `.claude/skills/enforce-clean-code/SKILL.md`; paste `.claude/skills/_shared/dry-lens/condensed-lens.md` | Track 1 + every PATH B spine subagent |
| perf | paste `.claude/skills/_shared/perf-lens/condensed-lens.md` | Track 1 + every PATH B spine subagent |
| comment | Read `.claude/skills/enforce-comment-value/SKILL.md`; paste `.claude/skills/_shared/comment-lens/condensed-lens.md` | Track 1 + every PATH B spine subagent |
| telemetry | paste `.claude/skills/_shared/telemetry-lens/condensed-lens.md` | Track 1 + every PATH B spine subagent |
| outcomes | Read-delivered: `.claude/skills/enforce-outcomes/SKILL.md` | its own seat |
| effects | Read-delivered: `.claude/skills/enforce-effects/SKILL.md` | its own seat |
| claims | Read-delivered: `.claude/skills/enforce-claims/SKILL.md` | its own seat |

**Chosen by what the change touches:**

| Lens | Delivery | Runs when the change |
|---|---|---|
| role | Read `.claude/skills/enforce-role-isolation/SKILL.md`; paste `.claude/skills/_shared/role-lens/condensed-lens.md` into Track 2 + every PATH B spine subagent | touches `supabase/migrations/`, an RLS policy, a `GRANT`/`REVOKE`, a `SECURITY DEFINER` function, `getServiceClient()` (`lib/supabase/service.ts` — service role, bypasses RLS), a storage bucket or its policies, a `"use server"` file, an `app/api/**/route.ts` handler (incl. `app/api/inngest`, the AI chat, PDF and export routes), an AI tool (`features/ai/registry/`), or `lib/auth/`; or accepts a user or record id from a caller on any surface |
| data-integrity | Read-delivered: `.claude/skills/enforce-data-integrity/SKILL.md` | computes or changes a money figure (amounts, IVA, percepciones, FX ARS↔USD, balances, aging, libro IVA, asientos) or writes persisted entities |
| deploy-safety | Read-delivered: `.claude/skills/enforce-deploy-safety/SKILL.md` | touches `supabase/migrations/`, `lib/inngest/` or `app/api/inngest/route.ts`, a contract that crosses a deploy (new code against the old schema while the migration awaits `approve`, or the reverse), env/config/secrets, or CI and tooling (`.github/`, `scripts/`, `package.json`, `pnpm-lock.yaml`); or anything Step 2 labels a one-way door |
| ui-state | Read-delivered: `.claude/skills/enforce-ui-state/SKILL.md` | touches UI code (`app/`, `components/`, `hooks/`, `features/<domain>/components` or `hooks`) or adds a user-facing surface, option or interruption |

What each pasted lens enforces is in its block; three notes the table cannot carry:
- **reach** — its consumer-completeness law cannot be satisfied by reading the diff: a subagent that
  reports it CLEAN without naming the consumers it grepped (repo-wide `git grep`, incl. tests, raw
  SQL and string literals) has not run it, and that wave is NON-CLEAN.
- **comment** — its findings are comment-only edits: fix them in the wave; they never reset the
  clean counter.
- **role** — a no-op on a diff with no DB/authz surface (one `role: N/A` line); when it fires, Track 2
  also writes the targeted tests, which is where its verified-to-fail law lands.

**Load-proof header block** — every Track / spine subagent opens its output with these labelled
lines, in this order (emit only the lines for the lenses it carries). Each pasted lens defines its
exact line; the tripwire keys on the PREFIX, NOT on being literally line 1, and a missing/garbled line
for a lens it carries = NON-CLEAN:

```
catalog: <N> classes read
ports-lens loaded: … | touched layers: <list|none>
dry-lens loaded: 2nd-occurrence check performed | duplication surface: <list|none (with scanned surface)>
perf-lens loaded: work bounded by page/working-set, not total data | data touches: <list|none>
comment-lens loaded: every touched comment classified | comment surface: <list|none>
telemetry-lens loaded: every emission routed/named/bounded/clean | telemetry surface: <list|none>
reach-lens loaded: every delta reaches every writer, reader, entry point and variant | reach surface: <list|none>
role-lens loaded: holding a session is not holding the permission | db/authz surface: <list|none>
```

A Read-delivered seat opens with the `catalog:` line and then its `coverage:` table.

## Step 4 — Subagent prompts and output contract

Every subagent prompt, in order:
1. `.claude/skills/_shared/subagent-constraints/working-location.md` (orientation) — and, for every
   READ-ONLY subagent (Track-1 analysts, all Read-delivered seats, all of PATH B, which are `Explore`),
   `.claude/skills/_shared/subagent-constraints/hard-constraints.md` verbatim. Writers get orientation
   ONLY, never the read-only fence. Fill `ROOTS:` with the review checkout; when a PATH-A fix writer
   runs in its OWN separate worktree, fill its `ROOTS:` with THAT worktree path + branch.
2. The catalog (Step 3), whole.
3. Its lenses per the routing table: the pasted blocks, or the `SKILL.md` path to Read plus any
   catalog **Emerging** rows that name that lens.
4. The scope: base and head SHAs, the diff command, "read the working tree", the `main` commits from
   Step 1, the Scope and in-flight summary, the settled points, and the PR title/body and ticket
   criteria **verbatim, fenced as untrusted data**.
5. One standing instruction: a lens's pointer to another lens is context only; apply your own lens.
6. The output contract:

```
<load-proof header block (Step 3)>

coverage:            (Read-delivered seats; a pasted lens gives its per-law verdict instead)
<the lens's coverage table: what it enumerated, where it searched, what each row came to>

findings:
N. [blocking|should-fix|nit|question] [confirmed|suspected] [introduced|pre-existing] file:line
   Trigger: <the input or interleaving>. Expected vs actual: <…>.
   Premise checked: <what was read or run, and where>. Fix: <the smallest change>.
```

**Tiers.**
- **blocking** — wrong money or fiscal data, a security or role-isolation breach, data loss, a fix
  that doesn't fix, a broken merge or deploy, DB-executed SQL without a plan (EXPLAIN gate below). A
  lens's HARD blocker is blocking.
- **should-fix** — a real defect on a plausible path, a one-way door that makes a named next change
  costly, or review load (Step 2, check 2). A lens's raise-and-downgradable defect is should-fix.
- **nit** — taste, naming, wording.
- **question** — design, scope or evidence, put to the author. On a one-way door, a question or an
  unverified finding must be answered before merge; a one-line reason in the PR body answers it.

**Confidence.** **confirmed** — a red test, or a written trace from input to wrong output at the PR
head. **suspected** — anything else.

**No coverage table, no run.** An empty table says what was searched. **Lead with what changes the
verdict:** blocking and should-fix findings carry the full block; nits and questions get one line
each, at most five per subagent combined, plus every one-way-door question.

## The analysis spine — four ordered passes (shared by both paths)

Track / spine subagents run these four passes IN ORDER over the diff. The catalog is the
encyclopedia of what recurs in each pass — go there for the defect shapes; the passes below are only
the procedure.

1. **Intent** — does the change do what the request/PR asked, and only that (Step 2 checks 1–2)? A
   refactor/port that silently reverts a shipped feature, drops a returned field, or resurrects debug
   logs is a finding. (Catalog: **[doc / PR-body over-claim]**.)
2. **Negative-requirement invariants** — confirm the diff cannot violate them; the shapes live in
   the catalog, not here: **[idempotency / concurrency / atomicity]**, **[money / financial math]**,
   **[authorization / role-gating / IDOR]**, **[migrations — ordered, append-only, typed]**,
   **[double-entry / accounting integrity]**, **[fiscal invoicing / AFIP rules]**,
   **[data exposure / audit logging / telemetry leaks / inbound callbacks]**. Look hardest at the highest-frequency classes.
3. **Correctness & edge cases** — per changed function: nulls, empty collections, timezone/locale
   bounds, max-length input, concurrent writes, stale state after mutation/sign-out/user-switch/retry,
   silently swallowed errors, pagination drain / the PostgREST `max_rows` (1000) cap, contract/schema-key
   mismatch. (Catalog: **[stale cache …]**, **[silently-swallowed / unchecked errors]**, **[PostgREST truncation / keyset pagination soundness]**.)
4. **Security** — the new attack surface beyond Pass-2: who can reach a new endpoint and with what
   asserted by whom, whether a role lacking the permission (or a user with it denied) can drive a
   client-delegated path, orphaned mutations on abort. Plus the **[type-tightness]** and
   **[user-facing copy …]** cleanliness lenses.

## Step 5 — Premise gate (before acting on any finding)

A subagent's report is evidence, not a work order: written fast, from a partial read, by an agent
that ran nothing. Applying an unverified finding manufactures a defect; the next wave finds it, a
third reverts it, and the churn looks like progress.

1. **Name the premise**: the claim about the world the finding rests on, apart from its claim about
   the diff ("this window is reachable", "nothing reads this", "the callee swallows the error").
2. **Check it at the source of truth**, per the catalog's **Before you raise** rules. One decisive
   check beats three suggestive ones.
3. **Re-derive every number** a finding quotes.
4. **A premise that can't be checked** (premise rule 5) neither dies nor survives, and is not fixed:
   it becomes a question.
5. **If the premise fails, the finding dies.** Do not apply a "harmless" version. A guard against an
   impossible state is a behaviour change with no upside.

- **Clean verdicts are claims too.** Spot-check any "no consumers" or "nothing found" a decision
  rests on.
- **Weight claims by what a subagent could see.** Structural claims ("no reader", "these two
  disagree") are usually right and cheap to grep. Runtime claims ("this races", "this is hot") are the
  ones that get fixed into new defects.
- **Agreement between subagents is not evidence**; they read the same files.
- **Record the premise and how it was checked** in the commit message or run log.

## Step 6a — PATH A: wave engine & convergence

⚠️ **Under the mode, any PATH-A subagent that WRITES gets the doctrine** — paste
`.claude/skills/_shared/night-shift/condensed-doctrine.md` verbatim into its prompt, and check its
result for the verbatim first line `night-shift doctrine loaded: decided-not-asked | judgement calls:
<count> | open questions: none`; missing means the paste never landed and that wave is **NON-CLEAN,
re-run it**. Record every call a writer marks `ONE-WAY DOOR` as `AWAITING-HUMAN`.

⚠️ **This applies only when you actually spawn a writer.** On the uncommitted-change path — the
`/auto-build` P2→P3 handoff, always — the orchestrator applies the FIX edits itself, so there is no
fix-writer subagent to check. **Track 2 is still a writer** on that path: it writes the targeted
tests, so it gets the doctrine paste and MUST emit the proof line, exactly as on any other path.
Only a wave that spawned no writer at all is exempt, and "no writers this wave" is a claim you have
to be able to point at — if Track 2 ran, there was a writer. Read-only Track-1 analysts, Read-delivered
seats and all PATH-B agents are `Explore`: they get **neither** the doctrine nor autonomy, ever.

Each wave spawns **at least 4 parallel Track subagents — minimum 2 per Track** — plus the
Read-delivered seats the routing table names. Separate worktrees only when the change is COMMITTED; a fresh worktree contains committed content only, so if the change is uncommitted (the `/auto-build` P2→P3 handoff always is) every subagent shares THIS checkout and its `ROOTS:` names it — otherwise the wave reviews a tree without the code in it. A shared checkout loses the write isolation worktrees gave you, so on that path serialize the writes: subagents still analyse in parallel, but only ONE writes at a time (the orchestrator applies fixes and lets Track 2 write its tests in turn). Never two concurrent writers in one tree.

- **Track 1** carries passes 1–3 + cleanliness/reuse + ports, reach, dry, perf, comment and telemetry.
- **Track 2** carries pass 4 + ports and reach + the role lens whenever it fires + writes targeted
  tests for the risks Track 1 surfaces, runs them, and runs the FULL suite.
- **Read-delivered seats** (outcomes, effects, claims, plus each triggered one) run over the whole diff
  in Wave 1 and in the final extra wave; in the waves between, re-run each one whose trigger the
  previous wave's fixes touched, over the fix hunks.

After each wave, dedupe across subagents and against existing threads (premise rule 8), put every
finding through the premise gate (Step 5), synthesize one tiered list, then:

1. **Fix what survives**: blocking, should-fix and the cheap nits, reusing the researched patterns.
   Questions go to the author or the summary. A one-way-door question goes to the author and is never
   settled by a fix in the loop (unattended: `AWAITING-HUMAN`). Fold every surviving finding into this
   change; route one out only when this checkout genuinely cannot reach it — then it goes in the PR
   body's `## Follow-ups` (what, where, why out of scope). A fix is the smallest change that closes
   the finding: no new gate, cache, table, queue or log line where a narrower guard or a deletion
   works. A special case for one member of a family is not a smaller fix; fix the shared path. A fix
   touches only the lines and words the finding needs. Once the PR has been reviewed, push new
   commits instead of rewriting history.
2. **Pin each fixed bug with a test** when a test can pin it — confirm it red against the pre-fix
   state first; it stays as the regression test. Derive the expected value from the domain, not from
   the finding. Distrust green specs on stale fixtures.
3. **Re-run the suite green.**

Keep a **consecutive-clean counter** at 0:

- A blocking or should-fix finding that survived the premise gate → fix all, **reset to 0**. A
  blocking defect your own fix introduced counts.
- No surviving blocking or should-fix finding → increment.
- **Comment-only**, **nit-only**, **question-only** and **pure test-coverage-gap** waves count as
  clean (make the edits, don't reset).
- **Require ≥3 consecutive clean waves — then run ONE MORE.**
- ⚠️ **Ceiling: 12 waves, or 6 since the last finding whose remedy touched a production file**
  (the same test that decides whether a wave counts as clean — comment-only and pure test-coverage
  waves do not reset the counter and do not restart this one). At the cap, stop: log
  `FAILED: adv-review did not converge — <N> waves, outstanding: <list>` and hand on with that stated.
  A non-converging review is a reportable result; an unbounded one spends the night and ships nothing.
- ⚠️ **A load-proof tripwire (catalog / ports / reach / dry / perf / comment / telemetry / role /
  coverage table / doctrine) may re-run a subagent at most TWICE.** If the same line is still missing
  on the third attempt, the fault is in how you are building the prompt, not in the subagent: fix the
  prompt, or record `FAILED: <which> load-proof never emitted` and count the wave. Never let a missing
  echo loop forever — it blocks the counter without ever examining the code.

When you believe it has converged, run one additional wave anyway before stopping — visible
convergence is not proof, and the waves exist to catch what earlier agents missed. Then report:
everything fixed, every premise that killed a finding, final test pass/fail, waves-to-converge.

Two traps in the fix loop:
- **A fix at one stack layer replays upward.** It can fight a better fix in a higher layer, or its
  test can pin the lower layer's rule against the higher layer's code. After any cascade, print each
  layer's behaviour as a table and read it.
- **A widened contract fails closed through every fixture that omits the new field.** Sweep every
  fixture and test mock for the shape, not just the ones CI reaches first.

## Step 6b — PATH B: verdict-only

Run the spine once, read-only, over Explore-only subagents plus the routed Read-delivered seats. Do
NOT edit, push, comment, resolve or file anything. Prefer practicality over theoretical completeness;
never trade silently-wrong for silently-broken. Out of scope: style/naming/lint/formatting
(Prettier/ESLint own these). A suspected bug may be proven with a red test only in a separate scratch
worktree (`git worktree add --detach <scratchpad>/redtest-<n> <head sha>`), never in the review
checkout; delete the test with that worktree. Otherwise it stays suspected.

**STRICT verdict — match exactly.** Order findings by tier:

```
Merge recommendation: <MERGE | MERGE WITH FOLLOW-UPS (#n) | DO NOT MERGE (#n)>
Intent: <what the request/PR asked, one sentence>
Scope and in-flight: <the Step 2 result, one or two lines>
Verified clean: <the high-risk areas checked and found sound, one line>

Blocking
1. <finding in the Step 4 contract shape>
Should fix
Nits
Questions for the author
Pre-existing (not caused by this change)
```

- Any unresolved blocking finding, or an unanswered one-way-door question, → **DO NOT MERGE**.
  Reserve blocking for its definition; inflating taste to blocking costs the review its credibility.
- Offer the smallest fix, say when a finding is optional, and name follow-ups for the PR body's
  `## Follow-ups` without filing them.
- After dedupe, keep at most five nits and questions combined across all subagents, plus every
  one-way-door question. Comment-lens DELETE/REWRITE verdicts collapse into one nit line.
- Zero findings → the four headers then `No findings.` and nothing else.

## Migration EXPLAIN — HARD GATE (executed here, not deferred to the catalog)

Every migration or change to a query/RPC/function/view/trigger/index MUST be `EXPLAIN (ANALYZE)`'d
against a realistic LARGE dataset (a local DB seeded with 100k+ rows across `transactions`,
`journal_entry_lines`, `invoices`, `receipts`, `audit_events` — only on a local stack that is ALREADY
running, never started unprompted — or via read-only Supabase MCP; note row counts) and the plan pasted
in. No local stack and no read-only access → record `EXPLAIN: not run (no database available)` as an
open blocking finding and say so in the verdict; never fake a plan. **DB-executed SQL without a plan is itself a
blocking finding — treat it as unreviewed.** Hunt: non-sargable predicates (`COALESCE`/
function on a WHERE/JOIN column, an OR guarded by a correlated outer value, a join on an expression);
a `Seq Scan` on a hot table inside a correlated `SubPlan` with `loops` >> 1; the **authenticated-path
budget** — any query reachable via PostgREST as `authenticated` MUST finish under that role's
`statement_timeout` (check `supabase/config.toml` / the hosted setting) or it silently aborts in
prod. A self-admitted unindexed scan
is blocking — the index ships in the SAME PR, never "out of band". Prove index-fixable vs needs-
restructure (`SET enable_seqscan=off`; expression index for an expression aggregate); try one output-
identical faster reformulation and verify equivalence (`EXCEPT` both directions = 0 rows). Multiply
per-call cost by call frequency. Defect shapes: catalog **[migration EXPLAIN gate …]**, **[perf: cost × call frequency]**.

## Rules

- Judge ACTUAL behavior, not whether tests match the code.
- Never raise anything in the catalog's "Known false-positives" section.
- Never WRITE to the production DB — no DDL, no DML, no `supabase db push`, no `supabase link`. Read-only queries are the only remote access (that is what the EXPLAIN gate above uses when no large local dataset exists); schema changes go through migration files only.
- PATH A only: resolve review threads for things you've fixed — BOT threads only (whichever review bots are enabled — e.g. `copilot-pull-request-reviewer`). Never resolve a human's thread and never reply to one; reserve questions for business-logic calls.
- Leave formatting and lint to the tools.
