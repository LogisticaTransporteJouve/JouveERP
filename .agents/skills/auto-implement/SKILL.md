---
name: auto-implement
description: >-
  Own a multi-file change end to end in a SINGLE context on the always-on rails, with a
  ports-and-adapters preflight, reach checked as it builds, and a diff-time self-check through the
  review lenses. Use for "own this end to end",
  "implement this feature and verify it", "implement X autonomously", "take this from spec to
  working code", "execute this plan". NOT for routine bounded edits (the built-in coding loop) or
  parallel multi-workstream builds (/auto-build).
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, Task, Skill
---

> ⚠️ **Autonomous orchestrator — use with human oversight.** This skill runs multiple phases largely unattended (it may fan out subagents and push commits). Prefer it for smaller, well-scoped, lower-risk changes, and review its output before merging. It never merges.

# Autonomous Implementation — one builder, one context, end to end

You implement the WHOLE change yourself in this one context. You may spawn `Explore` subagents for
read-only research; in single-context (default) mode you spawn NO writer subagents. The fan-out writer
mode (below) runs ONLY when /auto-build explicitly selects it for a multi-track plan.

## Autonomy

> **Runtime:** where a step says "spawn a wave" / "fan out subagents" (`Task`/`Explore`), that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the passes serially, same lenses/gates/floors), see `.claude/skills/_shared/runtime/capabilities.md`.
**MODE CHECK — do this first.** Read `.claude/skills/_shared/night-shift/detect.md` and follow it (`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken read into a confident, wrong `OFF`). If it records `night-shift: ON`, its **RULE ZERO** governs: never ask, never idle; resolve
design forks with `/adv-research` and log the call. A `Skill` callee shares your context and
scratchpad and detects the mode itself. Writers get the doctrine paste, not a token; read-only
`Explore` agents get neither. It overrides every consent gate, approval wait and
check-in line below, and overrides NONE of this file's NEGATIVE GATEs (Step 0, Step 4), the
Step-5 `/verify` gate, or the DRAFT-SAFE / SCOPE rails in Step 3. Otherwise this file governs exactly as written.

## When to use / when NOT (read this gate first)
- USE when the task is a multi-file feature or refactor you must self-govern to completion.
- Do NOT use for a single bounded edit ("fix this null check", "add this field") → the built-in
  coding loop already handles that; invoking this is over-capture.
- Do NOT use when the work splits into independent parallel workstreams → /auto-build.

## Step 0 — Load the lenses (FIRST)
Read `.claude/skills/enforce-ports-and-adapters/SKILL.md`, `.claude/skills/enforce-clean-code/SKILL.md`,
`.claude/skills/enforce-comment-value/SKILL.md`, `.claude/skills/_shared/telemetry-lens/condensed-lens.md`,
`.claude/skills/_shared/reach-lens/condensed-lens.md`, `.claude/skills/enforce-outcomes/SKILL.md` AND
`.claude/skills/enforce-effects/SKILL.md` IN FULL (incl. the layer map and feature-slice rules, the
DRY-progression discriminator, the comment-value classifier, the eight telemetry laws and the reach
laws), plus each conditional lens the routing table in `.claude/skills/adv-review/SKILL.md` Step 3
routes for the change. If the change touches a table, RLS policy, grant, function, a `"use server"`
action, a route handler, an AI tool, `getServiceClient()`, or `lib/auth/**`, also Read
`.claude/skills/enforce-role-isolation/SKILL.md`. If it adds a feature slice, a migration or an
Inngest function, also Read the matching scaffold skill (`/new-feature`, `/new-migration`,
`/new-inngest-fn`). If given a plan, also
Read `.claude/skills/_shared/plan-format.md` before parsing it. NEGATIVE GATE: if you have not read
all seven lenses above this turn, you may not start writing code. Ports is used TWICE (design preflight Step 2 +
diff-time Step 4); the DRY-progression rule is in-loop (Step 3) + diff-time (Step 4); the comment-value
and telemetry rules are diff-time (Step 4) — and telemetry is also in-loop: a new failure surface earns
its signal in the same edit that adds it.

## Step 1 — Preflight research
Read every file you will touch and the surrounding docs (`CLAUDE.md`/`README.md` in affected dirs).
Find the worked example of a similar existing feature (`features/invoices/`, `features/aging/`,
`app/(dashboard)/receipts/page.tsx`) and follow its patterns. If you use `Explore`
research subagents, paste `.claude/skills/_shared/subagent-constraints/hard-constraints.md` + `.claude/skills/_shared/subagent-constraints/working-location.md` (orientation) into each.

## Step 2 — Design against the ports law
Before writing, decide which layer each new piece of logic lives in (`lib/`, which
`features/<domain>/`, `app/`) and which seam it goes through (`features/ai/model.ts`, `lib/afip/`,
`lib/inngest/`). Business-logic actions do not cross features (except `issueFiscalInvoiceAction`);
shared logic goes to `lib/`. No shared
code may branch on a concrete adapter (`if (provider === …)`, a variant switch in shared code —
forbidden). Adapter-specific logic lives ONLY inside its adapter, behind the contract.

## Step 3 — Build on the always-on rails
Implement the change yourself, obeying the rails on every edit:
- READ BEFORE WRITE: re-read a file immediately before editing it.
- REUSE FIRST (in-loop, not deferred): before writing a function, constant, guard, client, type or
  query, search the repo (`git grep`, incl. `lib/`, sibling features and SQL) for an existing producer
  of the same output (`enforce-clean-code` Step 1) and use it. Keep the diff surgical: no formatter
  runs, no unrelated cleanup, and no line reworded that still means the same; every changed line costs
  a reviewer.
- REACH AS YOU GO: every time you change a guard, field, key, default, permission or meaning, grep its
  anchor and update every writer, reader, entry point, exit, variant (4 channels, CAE/CAEA, ARS/USD,
  NC/ND) and surface (action ↔ AI CFO tool ↔ hook/keys ↔ page; money ↔ RPC/view ↔ PDF ↔ libro IVA)
  in the same edit — the reach lens.
- BOYSCOUT / DRY-PROGRESSION (in-loop, not deferred): the 1st time you write something, inline what's
  pragmatic. The MOMENT you write a SECOND occurrence, STOP and DRY-check — first `rg` the repo for an
  existing helper you should reuse. Genuine (same concept, changes together — a bug in one is by
  definition a bug in the other) → extract to ONE shared interface NOW, or reuse the existing helper;
  never re-implement its body. Coincidental (similar shape, different reasons) → leave both inline. "I'll
  dedupe later" is a defect; a forced/mode-flagged abstraction over coincidental code is also a defect.
  Keep the diff surgical — no formatter runs, no unrelated cleanup.
- AUTH (orchestrator only — a writer subagent reports the wall upward instead): a missing login is
  not a reason to stop and report back. Read `.claude/skills/_shared/auth-access.md`. Never read
  `.env*` files (only `*.example`); if a step needs a secret the shell lacks, ask the user.
- FOLLOW-UPS: real out-of-scope problems go in the PR body's `## Follow-ups` section (what, where,
  why out of scope), not scope creep. File an issue only if the user asked for one.
- REPO RULES: no `any`, no `as` casts (narrow with type guards / Zod); server actions follow
  `requireUserContext()` → `userCan(ctx.access, "<perm>")` → Zod → `getServiceClient()` → `ActionResult<T>`, never
  `select *`; query keys in `features/<f>/lib/<f>-keys.ts`; CRUD UI in a centered `Dialog`, 100%
  monochrome; sensitive mutations call `logAudit()`; user-facing copy in Spanish (Argentina).
- DRAFT-SAFE: no destructive git/gh, no `supabase db push`/`link`, no commit to `main`, no
  schema/migration, public-API change or any other one-way door (`adv-review` Step 2) unless that IS
  the task; never edit a merged migration;
  don't hand-edit generated files (`lib/db/database.types.ts` is regenerated, not edited).
- SCOPE: implement what was asked; defer the rest with a note. Add discriminating tests (each fails
  on the pre-fix code).

## Step 4 — Diff-time self-check (on the REAL diff, not the plan)
Run the enforce-ports attack recipe against your actual diff. Per changed file: does anything outside
an adapter branch on the concrete implementation? Does adapter-specific logic leak out? Is any
dependency constructed inline instead of injected? Does a comment reference something its file must
not know? Emit a per-law verdict; an unstated law is UNCHECKED, not passed. Fix every violation
before Step 5 (or, if literally unexpressible, log it as a follow-up defect).
Then run the **DRY-progression sweep** on the diff: for every concept that now appears a 2nd time
(in-diff OR re-implementing an existing repo helper — `rg` to check), emit `extracted | reused |
justified-inline | MISSED-REUSE | WRONG-ABSTRACTION` and fix every genuine miss before Step 5.
Then run the **comment-value sweep** on the diff (the `enforce-comment-value` lens, read in full at
Step 0): for every comment or docstring the diff adds or touches, run the derivable/recoverable
classifier and record a verdict (DELETE / KEEP+ANCHOR / REWRITE / HOIST / REFACTOR-INSTEAD). Strip
change-narration to current behaviour only — EXPLICIT ("was X now Y", "no longer") and IMPLICIT
("rather than", "instead of") — with rationale-for-the-change going to the PR body; when a comment's
value is unclear the verdict is REWRITE, never DELETE. Fix every hit before Step 5.
Then run the **telemetry sweep** on the diff (the telemetry lens, read in full at Step 0):
for every signal the diff emits or configures (`logger.*`, `captureException`/`captureMessage`,
`logAudit()`, an `ai_usage` write, Sentry config) emit a per-law verdict, and for every NEW failure
surface the diff adds (route/action error path/retry/fallback/outbound AFIP, AI or email call/Inngest
step) confirm it emits something that DETECTS, LOCALIZES, or EXPLAINS a failure — a new surface that
goes dark is a law-7 defect. Route every emission through the house pipeline, give it a stable
greppable name, and carry no secret/PII (never amounts, CUIT/DNI/CBU, tokens, AFIP credentials, or
extracted JSON). Fix every hit before Step 5 (a signal that cannot be expressed in this change
becomes a follow-up defect).
Then run the **reach sweep** on the diff (the reach lens, read in full at Step 0): for every
behavioural delta, grep its anchor and a distinctive slice of its logic outside the diff and fill the
reach matrix — every writer, reader, entry point, exit, variant and surface reached, or the gap fixed.
Also fill the `enforce-outcomes` and `enforce-effects` coverage tables and each triggered lens's.
Then run the **claims sweep**: Read `.claude/skills/enforce-claims/SKILL.md` in full and run it over
the tests, docs, comments, user-facing copy and PR body you wrote — every claim checked against the
code, every new test mutated by reading. Fix every hit before Step 5.

## Step 5 — Verify cold + large (the `/verify` gate), then record
**Record into the run's living master plan** (`.claude/skills/_shared/execution-plan/master-plan-format.md`):
a single-context build keeps no state file otherwise, so the moment this run spans a compaction or
accrues a deferred item, materialize `<your scratchpad>/master-plan.md` (substep tick + local-vs-pushed
sha + any deferred follow-ups) and echo the transition; below that, the role lives on TaskCreate + the
PR body, and the final summary is that doc's snapshot.

Do NOT declare success from a warm context, and do NOT hand off to review on green tests alone —
passing tests do not prove the app runs: a missing env var, an RLS policy or `GRANT` that blocks the
real user, an Inngest function that never registers, or build-time vs runtime config all sail
straight through a green unit suite. Tests-only is insufficient.
1. Run the project's REAL commands COLD: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
   When `supabase/` changed AND a local stack is already running (`supabase status`): also
   `pnpm db:types:check` and `supabase test db` (if `supabase/tests/` exists). Never start a local
   stack or Docker unprompted — without one, record `db-dynamic: not run (no local stack)`. Fix any
   failure before proceeding.
2. Unless the diff touches ONLY tests, docs, or other non-runtime code, INVOKE `/verify`
   (`.agents/skills/verify/SKILL.md` — the JouveERP recipe; do not recreate its logic) to drive the
   affected flow end to end and OBSERVE real behavior — cold start of
   the app (`pnpm dev`) against the local Supabase stack (plus `pnpm dev:inngest` when
   `lib/inngest/` changed), a large/realistic input (made-up data, never a real client's CUIT or
   document), the actual flow — e.g. **emitir factura → evento Inngest → CAE (AFIP homologación) →
   PDF**, **recibo → transactions + asiento automático → saldo del cliente/aging**, **escaneo de
   comprobante → extracción → revisión → confirmación → factura de compra** — not a warm typecheck.
   If the flow needs a local stack, AFIP homologación credentials or an AI key the session does not
   have, do not start or fetch them: record `AWAITING-HUMAN: /verify needs <what>` and say
   exactly which flow is unverified. If `/verify` reports the flow does not actually work,
   fix and re-run — **capped at 3 `/verify` runs total for this change, whatever the errors say.**
   Past that, stop re-running it: record `FAILED: /verify — <what you tried>`, then — **on a feature
   branch, never on `main`; create one if you are standing on it** — commit the work and push, and
   say plainly in the report that it is unverified and must not be merged. Then stop. A dead track
   should leave a reviewable artifact, not an empty night. An unauthenticatable or unrunnable flow is a dead track, not a retry.
3. Only after `/verify` is clean: write the deferred work into the PR body's
   `## Follow-ups`.
Implementation is not "done" — and does not hand to review — until `/verify` has driven the real flow green.

## Fan-out mode (ONLY when /auto-build selects it for a large multi-track plan)
Default is single-context (above). When the caller explicitly selects fan-out, run the plan's DAG as
waves of parallel WRITER subagents.

⚠️ **Orchestrator-side, NOT part of the paste:** after each wave, check every writer result for the
verbatim first line `night-shift doctrine loaded: decided-not-asked | judgement calls: <count> |
open questions: none`. Missing means the doctrine never reached that
writer — **the wave is NON-CLEAN, re-run it.** A writer that never received the block cannot report
its absence, so this check only works here. Record every call a writer marks `ONE-WAY DOOR` as
`AWAITING-HUMAN` in the summary and the PR body.

The rules below ARE the paste — put them in every writer prompt:
- **DAG from the plan:** build waves from the plan's dependency prose + shared-file overlap; items
  with no dependency and no shared file are parallel-safe. One wave completes and validates before the next.
- **Read before write; own your files:** each writer re-reads its target files immediately before
  editing; a writer touches ONLY the files its work item names — never a file another item owns in the
  same wave (sequence those instead).
- **Scope boundary:** each writer implements exactly its item's Target + Downstream, runs its item's
  Validation command, and stops. No scope creep, no drive-by edits to shared files.
- **Wave validation:** after each wave, run the full Validation Commands; a red wave blocks the next.
- **Orientation + lenses + rails in every writer prompt:** paste `.claude/skills/_shared/subagent-constraints/working-location.md`
  (orientation — NOT hard-constraints; writers may write), filling its `ROOTS:` line with the build
  checkout's absolute path + branch (fan-out writers share this ONE checkout — a writer with no root
  named STOPs) + `.claude/skills/_shared/ports-lens/condensed-lens.md`
  + `.claude/skills/_shared/dry-lens/condensed-lens.md`
  + `.claude/skills/_shared/comment-lens/condensed-lens.md`
  + `.claude/skills/_shared/telemetry-lens/condensed-lens.md`
  + `.claude/skills/_shared/reach-lens/condensed-lens.md` (plus the `SKILL.md` path of each
  conditional lens its item triggers, to Read) + the rails (Step 3) so a fanned-out writer
  obeys the same laws as the single-context builder. If the orchestrator's mode check returned ON, it also pastes
  `.claude/skills/_shared/night-shift/condensed-doctrine.md` — a writer that inherits no doctrine
  ends its turn on a question and costs the wave.
After the last wave, run Step 4 (diff-time self-check) and Step 5 (`/verify`) over the whole change.

## Anti-patterns — do NOT do these
1. Do NOT spawn writer subagents in single-context mode — fan-out (writers) runs ONLY when /auto-build selects it.
2. Do NOT use this for a one-line bounded edit — that is the built-in loop.
3. Do NOT skip read-before-write; another turn may have moved the code.
4. Do NOT declare success without running real validation cold.
5. Do NOT branch on a concrete adapter anywhere outside that adapter.
6. Do NOT hand off to review on passing tests alone — invoke `/verify` and drive the real flow cold/large first.
7. Do NOT write a 2nd occurrence of a genuine concept without extracting/reusing it, and do NOT abstract coincidental lookalikes.
