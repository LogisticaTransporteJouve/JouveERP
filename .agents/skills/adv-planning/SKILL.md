---
name: adv-planning
description: >-
  Research a codebase change and produce an agent-ready execution plan (.md), then falsify it with
  independent read-only attackers before committing. Use for "plan this change", "write an execution
  plan", "research and plan this", "design and pressure-test the approach", "plan X and find the
  holes first". /adv-research falsifies an EXISTING target and writes no plan; the built-in /plan
  leaves no durable artifact.
argument-hint: "<what to plan> [rounds=N] [attackers=N]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, Task, WebFetch, WebSearch
---

# Adversarial Planning — plan, then kill your own plan

You produce ONE plan artifact and then subject it to REAL, independent falsification. You do not
write product code. Write touches ONLY the plan `.md` and scratch files.

`$ARGUMENTS` = the goal (e.g. "Add credit notes to storage billing"). If vague, resolve it from the repo — the
nearest sibling feature, recent PRs, `docs/pendientes.md` / `docs/roadmap.md`, any issue the user linked — and record the interpretation you chose
in the summary under the plan's title (section 1 of `_shared/plan-format.md`) so a wrong reading is
visible and cheap to correct. Do not add an `Intent` section — the format forbids inventing
top-level sections. Ask only if the goal
is unresolvable from the repo AND the mode is OFF (see `## Autonomy` below).
Param `rounds` (default 3) = falsification rounds in Step 3. **Min 4 attackers per round, and run one
more round than you think you need** — even on a change you're confident about; the attackers exist to
catch what you missed. Only a genuinely trivial change drops below this, and even then never below 4 attackers in one round.

## Autonomy

> **Runtime:** where a step says "spawn a wave" / "fan out subagents" (`Task`/`Explore`), that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the passes serially, same lenses/gates/floors), see `.claude/skills/_shared/runtime/capabilities.md`.

**MODE CHECK — do this first, unconditionally.** Read
`.claude/skills/_shared/night-shift/detect.md` and follow it
(`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken read into a confident, wrong `OFF`). If it records `night-shift: ON`, **RULE ZERO governs**:
never ask, never idle — build the narrowest defensible reading of a vague goal and put the
interpretation at the top of the summary. ⚠️ **Never pass `night-shift: ON` to your attackers** — they
are `Explore` agents whose whole contract is to report upward, and an act-autonomously token is
exactly what turns a read-only agent into a writing one (there is no autonomy token in this package
— do not invent one). **RULE ZERO overrides no rail in this file** — not the lens-load NEGATIVE GATE
below, not the ≥4-attackers-per-round floor, not the extra round, not "do not mark done with an open
fatal/serious finding".

## Step 0 — Load the lenses + plan format (before any planning)
Read `.claude/skills/enforce-ports-and-adapters/SKILL.md` IN FULL (incl. the layer map and
feature-slice rules), `.claude/skills/enforce-clean-code/SKILL.md` IN FULL (the DRY-progression law),
`.claude/skills/_shared/reach-lens/condensed-lens.md` IN FULL (the reach law), the routing table in
`.claude/skills/adv-review/SKILL.md` Step 3 (which lenses fire for which surface), and
`.claude/skills/_shared/plan-format.md` (the schema you must emit). NEGATIVE GATE: if you have not
read all five this turn, you may NOT write the plan.

## Step 1 — Research the codebase (spend most of your time here)
Build a real mental model before planning. Read `README.md`, root `CLAUDE.md`, `docs/pendientes.md`, and the
subsystem docs the change touches (`docs/accounting-patterns.md`, `docs/hr-patterns.md`,
`docs/ai-patterns.md`, `docs/{chat,files,notifications}-patterns.md`). Use Glob/Grep/Read and `Explore` agents to learn: current architecture and the
"worked example" of a similar existing feature; exact files to change; which components are generic
vs context-specific; existing test patterns; the project's real test/lint/build commands. Locate the
nearest sibling feature slice (`features/invoices/`, `features/aging/`) or seam (`lib/afip/`,
`features/ai/model.ts`, an existing `lib/inngest/functions/*`) so the plan can mirror its shape. A plan on shallow understanding produces
agents that get stuck.

## Step 2 — Write the plan (the plan-format.md schema)
Write the plan to the path the user gives (else suggest `PLAN_<FEATURE>.md`), in the EXACT section
order of `_shared/plan-format.md`, meeting its quality bar (exact paths; pasted real current code;
every call site; concrete per-item validation; 10–30-line items; explicit scope). Fill the two
mandatory design sections:
- `## Architecture & Ports Contract` — name every port the change touches, which layer each NEW
  piece of logic lives in (`lib/`, which `features/<domain>/`, `app/`), and an explicit "these consumers must never branch on the
  implementation" list. A plan that bakes in a boundary violation is rejected and redesigned HERE,
  before any code exists. Where the research shows a piece of logic will occur a 2nd time, name the
  shared interface up front (or record why the occurrences change for different reasons and stay
  separate) — a plan that bakes in an avoidable copy-paste OR a premature abstraction is redesigned HERE.
  For each one-way door (`adv-review` Step 2, check 7: a persisted shape, an AFIP-issued voucher or
  other external contract, a persisted name such as an Inngest event, audit event type or permission
  string, a change to existing production data) the plan adds, record the alternative it rejected and
  why, and whether an additive or flag-gated shape would make it two-way. Where the plan adds a member
  to a family (a channel, a voucher type, an AI tool, a provider), list what the next member would
  touch (`enforce-clean-code` Step 4, the next member).
- `## Falsification Log` — start empty; Steps 3–4 fill it.

## Step 3 — Falsify the plan with INDEPENDENT attackers (not you re-reading)
This is the load-bearing step. You do NOT self-review — an author re-reading rationalizes. Spawn
`Explore` subagents (read-only tool type — load-bearing, not prose) that receive ONLY the plan `.md`
+ the codebase — NEVER your reasoning or rationale. Run `rounds` rounds (**≥4 attackers per round; run
one more round than you think you need**); each round assigns each subagent one falsifying premise it
must PROVE with evidence:
- "This doesn't actually solve the goal" / "over- or under-engineered" / "breaks in production
  (cold start, scale)" / "the assumptions are wrong" / "there is a radically simpler way"
- ONE dedicated premise every round: **"this plan misses a place the change must reach"** — the
  attacker runs the reach lens against the plan: every writer, reader, entry point, exit, variant
  (4 channels, CAE/CAEA, ARS/USD, NC/ND) and surface (action ↔ AI CFO tool ↔ hook/keys ↔ page; money ↔
  RPC/view ↔ PDF ↔ libro IVA/exports; permission ↔ matrix + test + RLS arrays + UI) of what the plan
  changes, every other piece of code answering the same question, and every registry a new unit must
  join (`app/api/inngest/route.ts`, `features/ai/registry/`, `lib/auth/permissions.ts`).
- ONE dedicated premise every round: **"this plan bakes in a ports/boundary violation"** — the
  attacker checks `## Architecture & Ports Contract` against the ports law.
- ONE dedicated premise every round: **"this plan bakes in an avoidable duplication OR a premature/
  wrong abstraction"** — the attacker applies the DRY-progression discriminator to the planned work.
- ONE dedicated premise every round: **"this plan bakes in an algorithmic-performance defect that
  scales with data"** — the attacker checks the planned queries/loops/jobs against the scaling law
  (keyset not offset, a selective indexed filter on large tables, no JS aggregation over a
  possibly-truncated PostgREST result (max_rows 1000), no whole-set materialization on a hot path, no
  N+1, independent queries in `Promise.all`, bounded/resumable Inngest work) and the large-table registry in `_shared/perf-lens/condensed-lens.md`.
- ONE dedicated premise in every round WHERE the plan adds a failure surface or emits/configures
  telemetry (when the change emits nothing this seat returns to a general falsifier, so the lens
  premises never crowd the ≥4-attacker floor at once): **"this plan adds a failure surface but bakes
  in no telemetry, or bakes in a telemetry defect"** — the attacker checks the planned emissions against the telemetry
  law (routed through the house pipeline — `lib/logger.ts`, `captureException` in
  `lib/observability.ts` → Sentry, `logAudit()` → `audit_events` for audit facts — stable greppable
  names, ids and counts as context, no secret/PII: never amounts, CUIT/DNI/CBU, tokens, AFIP
  cert/key, or extracted JSON) and flags any new endpoint/cache/retry/fallback/flag-branch/
  outbound-dep/queue-consumer that emits nothing.
- ONE dedicated premise in every round WHERE the plan touches a DB or authz surface — migrations, RLS
  policies, grants, `SECURITY DEFINER` functions, service-role clients, `"use server"` files, route
  handlers, or assistant tools (when the plan touches none of those this seat returns to a general
  falsifier): **"this plan bakes in a path around the role gate"** — the attacker checks the planned
  actions/policies/grants/functions/handlers/tools against the role law in `enforce-role-isolation`:
  a `"use server"` export or route reaching `getServiceClient()` without `requireUserContext()` +
  `userCan(ctx.access, "<perm>")`, a gate a per-user deny does not reach, a write gated by a `:read` permission, a new table without RLS in the
  same migration, a policy with a bare `user_has_role()` or no `WITH CHECK`, a `SECURITY DEFINER`
  function without `SET search_path` or an internal role check, a `REVOKE ... FROM PUBLIC` that leaves
  the explicit `anon`/`authenticated` grants standing, any grant to `anon`, a self-scoped row without
  its `user_id` filter, an AI tool that bypasses its read action, a new permission missing from
  `lib/auth/permissions.ts` or its test — and rejects any planned fix that ships without a test
  observed to FAIL against the pre-fix state.
- ONE dedicated premise every round: **"this plan bakes in a value that loses its meaning on the way
  to its sink, or an effect that is unguarded, non-atomic or unsafe to replay"** — the attacker Reads
  `.claude/skills/enforce-outcomes/SKILL.md` and `.claude/skills/enforce-effects/SKILL.md` in full and
  applies them to the planned reads, writes, AFIP calls and Inngest steps.
- ONE dedicated premise in every round for each CONDITIONAL lens whose `adv-review` Step 3 trigger
  fires for the plan — data-integrity, deploy-safety, ui-state (role and telemetry are above):
  **"this plan bakes in a defect this lens exists to catch"**; the attacker Reads that lens's
  `SKILL.md` in full. A lens that does not fire gets no seat.
- **Lens seats never crowd the floor.** They are additive: every round ALSO runs at least two
  general falsifiers from the first bullet (rotate them across rounds; the "assumptions are wrong"
  one Reads `.claude/skills/enforce-claims/SKILL.md` and checks every claim the plan makes about the
  current code). Round size = lens seats + ≥2 general, and never under 4.

Paste into EVERY subagent prompt, verbatim: (a) the block from
`.claude/skills/_shared/subagent-constraints/hard-constraints.md`; (b) the orientation block from
`.claude/skills/_shared/subagent-constraints/working-location.md`; (c) the condensed ports lens
from `.claude/skills/_shared/ports-lens/condensed-lens.md`; (d) the condensed clean-code lens from
`.claude/skills/_shared/dry-lens/condensed-lens.md`; (e) the condensed algorithmic-performance lens
from `.claude/skills/_shared/perf-lens/condensed-lens.md`; (f) the condensed telemetry lens from
`.claude/skills/_shared/telemetry-lens/condensed-lens.md`; (g) the condensed reach lens from
`.claude/skills/_shared/reach-lens/condensed-lens.md`; (h) the one assigned premise, with the
`SKILL.md` path of each Read-delivered lens it names; (i) the plan path; and (j) — ONLY where the plan touches a DB or authz surface — the condensed
role-isolation lens from `.claude/skills/_shared/role-lens/condensed-lens.md` (omit it otherwise;
that lens is conditional and a plan with no DB/authz surface must not pay for it). Each finding:
attack vector, specific evidence (code paths), severity cosmetic/serious/fatal, and the proposed
replacement if fatal. After each round, verify what the
agents did (`git status`, worktrees, branches) before trusting findings.

## Step 4 — Resolve and gate
You are the SYNTHESIZER only. For every finding, record it in `## Falsification Log` and either FIX
the plan or REBUT it with specific evidence (not "seems fine"). Convergence across independent
premises on the same weakness is strong signal — act on it. Check each finding's premise at its
source before acting on it (`adv-review` Step 5; agreement between attackers is not evidence). A
finding against a one-way door is resolved only by recording the rejected alternative and why. The plan is done ONLY when no fatal or
serious finding is unresolved. Before finishing, do a dedup/contradiction pass on the plan prose
(two items that say the same thing, a Target that contradicts a Scope) — `/tighten` at level low
compresses the prose, but never let it drop a load-bearing path, line number, or call site.

## Handoff
The plan `.md` path is the single handoff token. Two consumers: `/auto-implement <plan.md>`
(one coherent single-context build) or `/auto-build <plan.md>` (large multi-track plan fanned
out). This skill does not decide which — it emits a plan whose DAG structure supports both.

## Anti-patterns — do NOT do these
1. Do NOT adjudicate your own plan by re-reading it — independent Explore attackers with assigned premises are the mechanism.
2. Do NOT write vague items, hide dependencies, or skip reading real code (line numbers matter).
3. Do NOT let a subagent write files — they are `Explore`, read-only, findings only.
4. Do NOT mark done with an open fatal/serious finding.
5. Do NOT write anything but the plan `.md` and scratch files. The plan format + quality bar live here and in `_shared/plan-format.md`.
