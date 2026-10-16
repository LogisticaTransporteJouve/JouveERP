# Canonical plan.md format (single source of truth)

This is the ONE schema for an execution plan `.md`. It is the handoff contract between the plan
WRITER and the plan READERS. Do not diverge from it in either direction.

- WRITER: `/adv-planning` (Step 2) emits a plan in EXACTLY this section order.
- READERS: the plan-execution engine folded into `/auto-implement`, and
  `/auto-build`, parse EXACTLY these sections and field names.

If the writer emits a section the readers don't parse, or the readers expect a section the writer
doesn't emit, the interface has drifted — fix it HERE first, then both sides.

## Canonical section order (emit in this order, parse by these headers)

1. `# <Title>` + a 1–2 sentence summary of what the plan achieves.
2. `## Current State`
   - `### What already exists` — bullets of relevant infra/code/data in place.
   - `### What does NOT exist yet` — bullets of the gaps this plan fills.
3. `## Architecture & Ports Contract`   ← MANDATORY, NEW (see below)
4. `## Validation Commands` — the project's REAL commands, discovered during research:
   - **Test:** `<cmd>`  **Lint:** `<cmd>`  **Build:** `<cmd>`  **Quick check:** `<cmd>`
     (JouveERP: `pnpm test` · `pnpm lint` · `pnpm build` · `pnpm typecheck`; plus `pnpm db:types:check`
     when `supabase/` changes and a local stack is already running.)
5. `## Phase N: <Title>` (one per phase; 1–2 sentence phase goal + invariant) — each containing
   one or more work items `### N.M <Work Item Title>` in the work-item schema below.
6. `## File Inventory: What Gets Created/Modified`
   - `### New files` table (`| File | Purpose |`)
   - `### Modified files` table (`| File | Change |`)
7. `## Success Criteria` — numbered, concrete, verifiable conditions that mean "done".
8. `## Falsification Log`   ← MANDATORY, NEW (see below)

Optional trailing `## Deferred Work` is allowed and MUST be parsed as NOT-required (readers skip
it during execution). Readers MUST ignore any section they don't recognize rather than erroring —
but the writer MUST NOT invent new top-level sections outside this list.

## Work-item schema (the unit the readers spawn/execute)

Each `### N.M <Work Item Title>` MUST carry these labeled fields, in this order:

- **Files:** exact paths to create/modify (never "the registry file" — `features/ai/registry/catalog.ts`).
- **Problem:** what's wrong / missing — specific, WITH line numbers.
- **Current:** the ACTUAL current code (paste it, fenced) if modifying existing code.
- **Target:** the target code (fenced) or an unambiguous description of the target state.
- **Downstream changes:** every other file/call-site that must change because of this item.
- **Validation:** exact command(s) from `## Validation Commands` that verify THIS item.
- **Scope:** explicit out-of-scope boundary — what this item does NOT touch.

Dependencies are expressed IN PROSE inside the item ("requires 1.1 done first"; "touches the same
file as 2.3 — sequence, don't parallelize"). Readers build the execution DAG from these statements
+ shared-file overlap. Items with no dependency note are parallel-safe by default.

Quality bar (writer MUST meet; reader MAY reject a plan that doesn't): exact paths, pasted real
current code, every call site listed, concrete per-item validation, each item 10–30 lines (split
if larger), explicit scope boundary.

## `## Architecture & Ports Contract` (MANDATORY, NEW)

Design-time boundary contract for the whole change. It MUST:
- Name every port/boundary the change touches.
- State which SIDE of each boundary every NEW piece of logic lives on, and its layer (`lib/`,
  `features/<domain>/`, `app/`) per the layer map in `enforce-ports-and-adapters`.
- Assert that NO shared code branches on a concrete adapter (`if (provider === …)`, a variant
  switch in shared code — forbidden); adapter-specific logic lives ONLY inside its adapter.
- Log any boundary that cannot be expressed as a follow-up defect (do not silently skip it).

Reader obligation: read this section and enforce it at diff-time — a produced diff that violates
the stated contract is a blocking defect, not a style nit.

## `## Falsification Log` (MANDATORY, NEW)

Starts empty; filled by `/adv-planning` Step 3/4 (independent Explore attackers). Each
entry: attack vector · specific evidence (code paths) · severity `cosmetic|serious|fatal` ·
resolution (FIXED-in-plan | REBUTTED-with-evidence).

HANDOFF GATE: a plan is NOT ready for execution while this log holds any UNRESOLVED `fatal` or
`serious` finding. Readers MUST refuse to start execution on such a plan and hand it back to
planning.

## Consumers — explicit-Read wiring (keep in sync)

- `/adv-planning` Step 2: imperative Read of THIS file before emitting the plan.
- `/auto-implement` (folded plan-execution engine) at plan-parse time: imperative Read
  of THIS file before parsing/executing a plan `.md`.
- `/auto-build` plan phase: imperative Read of THIS file before fanning out work items.

Each consumer cites this file by absolute path
(`.claude/skills/_shared/plan-format.md`) with a step-1 imperative Read + a negative gate ("if
you have not read this, do not emit/parse a plan"), because referenced files are NOT auto-loaded.
