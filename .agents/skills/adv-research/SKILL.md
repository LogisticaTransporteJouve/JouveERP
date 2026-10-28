---
name: adv-research
description: >-
  Stress-test a design, decision, claim, plan, or codebase area with waves of read-only Explore
  subagents, each attacking from a different premise, then synthesize what survived and the
  converged minimal design. Use for "adversarial research on X", "falsify this design/plan", "find
  the holes before I commit", "stress-test this decision", "attack this doc". adv-review attacks
  CODE and fixes it; this falsifies claims and writes one synthesis document.
---

# Adversarial Research — Falsification & Synthesis

## Autonomy

> **Runtime:** where a step says "spawn a wave" / "fan out subagents" (`Task`/`Explore`), that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the passes serially, same lenses/gates/floors), see `.claude/skills/_shared/runtime/capabilities.md`.
**MODE CHECK — do this first.** Read `.claude/skills/_shared/night-shift/detect.md`
(`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system
prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken
read into a confident, wrong `OFF`), **and follow it**. If it records `night-shift: ON`, **RULE ZERO governs**: never ask, never idle. ⚠️ **Never give a read-only `Explore` agent autonomy** — no doctrine paste, no "decide and proceed": its contract is to report upward, it holds `Bash`, and telling one to act is how a read-only agent becomes a writing one. This
skill is what the orchestrators invoke to resolve a design fork, so it is reached most often with
nobody at the keyboard — a vague input is narrowed by *you*, from the repo, and the narrowing is
recorded in the synthesis. It overrides none of this skill's read-only rails.

**THIS SKILL IS READ-ONLY on everything it analyzes** — do not edit, move, or delete any existing file, and run no write commands against code or data. The ONE exception is your single deliverable: writing the synthesis markdown to `output_file` (see ## Input Parameters for the default — the scratchpad, never the tracked `docs/` tree). Subagents are strictly read-only and never write.

## Input Parameters

The user may specify any of the following. Use defaults when not provided:

- **target**: The document, decision, codebase area, or idea to falsify (required)
- **sequences**: Number of independent adversarial sequences (default: 3)
- **rounds**: Max rounds per sequence (default: 5)
- **agents_per_round**: Subagents per round (**default 4; minimum 4, never fewer**)
- **output_file**: Where to write the final synthesis (default: `<your scratchpad>/adv-research-<timestamp>.md` — the scratchpad, never the tracked `docs/` tree, which the ship gate forbids committing)

Example invocation: `/adv-research target="docs/my-design.md" sequences=5 rounds=3 agents_per_round=4`

## Process

### Phase 1: Understand the Target

Read the target thoroughly. Identify:
- The core claims (what does this assume to be true?)
- The load-bearing components (what breaks if removed?)
- The stated benefits (what outcomes are promised?)

### Phase 2: Falsification Waves

Run `sequences` independent attack sequences, each with up to `rounds` rounds of `agents_per_round` subagents. Each sequence starts from a different adversarial premise. Choose premises appropriate to the target — examples:

**"This doesn't actually solve the problem"**
- Attack the core value proposition
- Find scenarios where the mechanism fails silently
- Quantify realistic impact (not optimistic projections)

**"This is over-engineered / under-engineered"**
- Find components that can be removed without loss
- Find gaps where missing components cause failure
- Attack the complexity/benefit ratio of each piece

**"This breaks in production"**
- Attack data quality assumptions with real data
- Find failure modes at scale (cold start, drift, adversarial users)
- Identify untestable components (things you can't validate until too late)

**"This won't scale — its cost grows with the data"** (MANDATORY when the target touches a query, a loop over rows, a paged job, or a large list)
- Attack via the algorithmic-performance lens — Read and paste `.claude/skills/_shared/perf-lens/condensed-lens.md` into the agent: OFFSET over a large/growing set, a large-table query with no selective indexed filter, a sum/balance computed in JS over a PostgREST result silently truncated at `max_rows` (1000), a whole-set materialization on a hot path, N+1 (a per-row query/model call in a loop), unbounded fan-out, a whole-table read into memory/browser
- Check every touched large table against the lens's large-table registry for its required access rule
- Size for years of growth (`transactions`, `journal_entry_lines`, `invoices`, `receipts`, `audit_events`, `ai_usage`), not dev data

**"This adds a failure surface but goes dark — or emits telemetry that's wrong"** (MANDATORY when the target adds an endpoint, cache, retry, fallback, flag-branch, outbound dep, or queue consumer, or touches logs, Sentry capture/config, or audit events)
- Attack via the telemetry lens — Read and paste `.claude/skills/_shared/telemetry-lens/condensed-lens.md` into the agent: a new failure surface that emits nothing, a signal routed outside the house pipeline (`lib/logger.ts`, `captureException`/`captureMessage` in `lib/observability.ts` → Sentry, `logAudit()` → `audit_events`), `console.*` in server code, an interpolated or data-built log/audit name, a unit of work with no correlation id (user id, entity id, Inngest attempt), a secret or PII in any field (amounts, CUIT/DNI/CBU, tokens, AFIP cert/key, extracted JSON), or a log/audit shape change smuggled into an unrelated diff
- Check where the change lands (server actions, `app/api/**` route handlers, the Inngest functions in `lib/inngest/functions/`) and whether failures there are captured — a change landing on an uninstrumented path raises the gap, it doesn't excuse silence
- Confirm the emitted signal actually DETECTS, LOCALIZES, or EXPLAINS a failure — a signal that does none is not worth emitting

**"A user without the permission can reach this"** (MANDATORY when the target touches migrations, RLS policies, grants, `SECURITY DEFINER` functions, `getServiceClient()`, `"use server"` files, route handlers, AI tools, or `lib/auth/permissions.ts`)
- Attack via the role-isolation lens — Read `.claude/skills/enforce-role-isolation/SKILL.md` and paste `.claude/skills/_shared/role-lens/condensed-lens.md` into the agent: a `"use server"` export or route reaching `getServiceClient()` without `requireUserContext()` + `userCan(ctx.access, "<perm>")`, a gate a per-user deny does not reach, a write gated by a `:read` permission, a new table without RLS in its creating migration, an UPDATE policy with no `WITH CHECK` (Postgres silently reuses `USING`), a bare `user_has_role()` in a new policy, a `SECURITY DEFINER` function without `SET search_path` or an internal role check, a `REVOKE ... FROM PUBLIC` that leaves the explicit `anon`/`authenticated` grants standing, any grant to `anon`, a self-scoped row (notifications, AI chat, driver trips) without its `user_id` filter, an AI tool that bypasses its read action or takes an identity from the model, a permission missing from the matrix or its test
- Check both halves of the PostgREST gate: a policy without a grant is unreachable, a grant without a constraining policy is open
- A proposed fix with no test observed to FAIL against the pre-fix state is not a fix — action-level Vitest tests with a role lacking the permission, the matrix test in `lib/auth/permissions.test.ts`, and pgTAP in `supabase/tests/` once it exists

**"This misses a place it must reach"** (MANDATORY every round when the target is a code change, a design for one, or a codebase area)
- Attack via the reach lens — Read and paste `.claude/skills/_shared/reach-lens/condensed-lens.md` into the agent: every writer, reader, entry point, exit, variant (4 channels, CAE/CAEA, ARS/USD, NC/ND) and surface (server action ↔ AI CFO tool ↔ hook/query keys ↔ page; money ↔ RPC/view ↔ PDF ↔ libro IVA/exports; permission ↔ matrix + test + RLS arrays + UI) the target changes, every other piece of code answering the same question, and every registry a new unit must join (`app/api/inngest/route.ts`, `features/ai/registry/`, `lib/auth/permissions.ts`)
- Search outside the target with `git grep`; a "nothing else reads it" that names no grep is not a finding

**"A routed review lens would catch it"** (MANDATORY when the target is a code change or a design for one)
- Run one attacker per lens the routing table in `.claude/skills/adv-review/SKILL.md` Step 3 routes for the target and that no premise above already covers: `enforce-outcomes`, `enforce-effects`, `enforce-claims`, and each conditional lens whose trigger fires (`enforce-data-integrity`, `enforce-deploy-safety`, `enforce-ui-state`). The attacker Reads that lens's `SKILL.md` in full and fills its coverage table.
- **Lens attackers never crowd the floor.** They are added on top of the general premises: every round still runs at least two general falsifiers (the premises above and below that name no lens), and never fewer than `agents_per_round` in total.

**"The assumptions are wrong"**
- Challenge unstated assumptions about users, data, environment
- Find contradictions between the design and actual system behavior
- Test edge cases the design doesn't mention

**"There's a simpler way"**
- Propose radically simpler alternatives
- Identify unnecessary indirection or abstraction
- Question whether the problem even needs solving

Each round's agents should:
1. State their attack vector explicitly
2. Provide specific evidence (data, code paths, research, analogies)
3. Rate severity: cosmetic / serious / fatal
4. Propose what would replace the killed component (if fatal)
5. Flag any one-way door the target adds (`adv-review` Step 2, check 7: a persisted shape, an external contract such as an AFIP-issued voucher, a persisted name such as an Inngest event, audit event type or permission string, a change to existing production data)

Before counting a kill, check its premise at the source (`adv-review` Step 5 and the **Before you raise** rules in `.claude/skills/_shared/review-calibration/defect-catalog.md`); agreement between attackers is not evidence.

### Phase 3: Convergence

After all waves complete:
1. List everything that was killed (with the fatal finding for each)
2. List everything that survived (with why it withstood attack)
3. Identify what EMERGED from the attacks (new simpler designs that multiple sequences converged on independently)
4. Produce honest numbers (realistic timelines, actual impact estimates)

### Phase 4: Synthesis with Intellectual Honesty

Write the final output preserving:
- **What we tried and why** (the reasoning was sound at the time)
- **What killed it and the specific evidence** (not "it seemed wrong" but "data shows X")
- **What emerged** (the converged minimal design)
- **Honest numbers** (realistic, not optimistic)

The synthesis should read as a narrative of earned knowledge — showing the reasoning path so future readers understand WHY the final design looks the way it does, not just WHAT it is.

## Key Principles

- **Kill your darlings.** The goal is truth, not validation. If something dies, let it die.
- **Specific evidence over vibes.** "This feels over-engineered" is not a kill. "This component adds X complexity for Y marginal benefit, and here's why Y is marginal: [evidence]" is a kill.
- **Convergence is signal.** When multiple independent attack sequences arrive at the same simpler design, that's strong evidence.
- **Run one more than you think — min 4 agents per wave.** Always spawn at least 4 agents per wave/round, and run at least ONE MORE wave than you believe you need — even when you're confident you already have the answer. The waves exist to catch what earlier agents missed; convergence you can see is not proof of completeness. Erring toward more waves is responsible practice, not overkill.
- **Preserve the reasoning chain.** The killed approaches are as valuable as the survivors — they prevent future teams from re-exploring dead ends.
- **Honest numbers.** Replace optimistic projections with realistic ranges. If you can't estimate confidently, say so.

## Subagent Rules

- **Spawn subagents as the `Explore` agent type** (read-only toolset). A prose "read-only" instruction is NOT a hard constraint — a general-purpose agent can and has overstepped (committed code, opened a PR) despite one. Tool-scoping is the real fence; the boilerplate below is the backstop.
- Read `.claude/skills/_shared/subagent-constraints/hard-constraints.md` and paste its block VERBATIM at the top of every subagent prompt. Do NOT inline a copy here — that file is the single source and an inlined copy drifts. Also Read and paste `.claude/skills/_shared/subagent-constraints/working-location.md` (orientation — which worktree/branch) at the top of every prompt.
- Each subagent gets a focused attack vector, not the whole problem.
- Subagents must cite specific code paths, data, or prior art — no hand-waving.
- Only the final synthesizer writes the output document.
- The synthesizer must count unique findings, not just aggregate.
- **After each wave, verify what the agents actually did** (`git status`, `git worktree list`, branches, open PRs) before trusting the findings — restore any unexpected tracked edit.

## Output Format

The single output document should have:
1. Executive summary of what survived
2. The converged design (minimal, specific, implementable)
3. "What We Tried and Killed" section (~30% of document) with full reasoning for each
4. Honest impact estimates with explicit assumptions
5. Ship order (what to build first, what to defer, what might never ship)
6. One-way doors: each one the converged design keeps, the alternative it rejected and why, and whether an additive or flag-gated shape would make it two-way

## Usage

Works for anything that benefits from stress-testing:
- System architecture documents
- Product feature designs
- Technical strategy decisions
- Process/workflow proposals
- API designs
- Codebase audits (find bugs, dead code, architectural debt)
- Business ideas and go-to-market plans
- Migration plans
- Any decision where you want to find the holes before committing

The input should be a specific document, codebase area, or decision. Vague "falsify my thinking" requests need to be narrowed to a concrete artifact first.
