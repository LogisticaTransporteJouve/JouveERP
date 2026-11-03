---
name: td-plan
description: >-
  Plan a JouveERP change end to end and hand the user a readable plan page: research the code,
  settle the design decisions with the user one at a time, write and falsify the agent-ready plan
  .md on the adv-planning rails, then publish an artifact that shows what changes, why it is safe,
  what breaks if it is wrong, the decisions, what the attackers found and the steps. ES/EN always.
  Never writes product code. Takes a plain description, a GitHub issue or (optionally) a Linear
  issue. Use for "/td-plan", "planeá esto", "hacé el plan de #123", "plan this with a page for me",
  "plan page". A plan .md alone, without the page or the decision round, is /adv-planning.
argument-hint: "<what to plan, a GitHub issue (#123 or URL) or a Linear key>"
---

# td-plan

Two outputs, two readers:

- **The plan `.md`** for the agent that implements it (`/td-implement`, `/auto-implement`). Long,
  exact, in the repo's plan format (`.agents/skills/_shared/plan-format.md`). The user does not need to read it.
- **The plan page** (an artifact) for the user. They read it to understand and approve the plan.

Visual language: `.agents/skills/td-explain/SKILL.md` §Theme and §5. Start the page from
`.agents/skills/td-explain/reference/shell/head.html` (light + dark tokens, the ES/EN toggle and the
SVG helpers `box`, `ar`, `list`, `matrix`); drop its walk markup (map, picker, step card) and lay out
the sections below in its `.wrap`.

Never write product code, commit or push. Write only the plan `.md`, scratch files and the page.

## 1. Pin the goal

- A GitHub issue: `gh issue view <n> --repo LogisticaTransporteJouve/JouveERP --comments`, or the
  GitHub MCP's `issue_read` where `gh` is not signed in (cloud sessions). A Linear
  key or URL: read the issue and its comments through `nav-linear`, only if the Linear MCP is
  connected (read-only; never write to Linear). Otherwise take the user's words. Linear is optional
  in JouveERP: nothing waits on an issue.
- If the goal is vague, settle it from the repo (the nearest sibling feature, recent PRs,
  `docs/pendientes.md`). Write the reading you chose in one line; it goes at the top of the plan and the page.
- Plan path, never in the repo (nav-github: plan docs are never committed): the session scratchpad
  when the system prompt lists one, `<scratchpad>/plans/<key>/PLAN.md`; otherwise
  `~/.cache/jouve-plans/<key>/PLAN.md`. `<key>` is the Linear key in lowercase, the GitHub issue
  (`gh-123`) or a short English slug. Say the path in the reply: a scratchpad dies with its session.
  If a plan exists at the path, update it rather than starting over.

## 2. Research

Follow `.agents/skills/adv-planning/SKILL.md` exactly for its mode check and Steps 0–1: load its
lenses and `_shared/plan-format.md`, then research the code (read-only `Explore` agents in parallel
for a wide change). Read from `origin/main` (`git fetch origin main` first), not a stale local branch.

## 3. Settle the decisions with the user, one at a time

Before writing the plan, list every choice the research leaves open that is the user's to make
(product behaviour, Spanish UI copy that changes what the user is told, scope, a one-way door from
`adv-review` Step 2 check 7, an alternative with a real trade-off). Not choices the code or
`CLAUDE.md` already settle.

For each, in order of impact, ask with `AskUserQuestion`: one question, 2–3 options, the
recommended one first with "(Recomendado)" / "(Recommended)" in the user's language, each option's
trade-off in one line, grounded in the code. Wait for the answer before the next. Record each answer
as a decision (chosen, rejected, why).

If nothing is open, say so in one line and continue. If adv-planning's mode check returned
`night-shift: ON`, don't ask: take the recommended option, list it under **Decided by the agent**
and record `AWAITING-HUMAN: <the question>`.

## 4. Write and falsify the plan `.md`

Follow `adv-planning` Steps 2–4 exactly: the plan-format sections, the Architecture & Ports
Contract, the attacker rounds (≥4 read-only attackers per round, one round more than you think),
the Falsification Log, and the gate (no open fatal or serious finding). Record the step-3 decisions
in the plan (Architecture section: chosen, rejected alternative, why).

If an attacker finding reopens a decision the user made, stop and ask them again; don't overrule
them silently.

## 5. Build the plan page

Built from the final `.md`. Every sentence traces to it or to the code. In this order:

1. **Header:** eyebrow (`Plan · <#issue or slug> · <area>`), title (a name, 2–4 words), two sentences: what
   we do and why. Status chips: ready or not, open serious findings, one-way or two-way door,
   files and line counts, the PR when one exists.
2. **What changes:** the goal reading in one line, then a **today / after diagram** of the
   mechanism the change touches (removed paths dashed and in the warn colour, new paths in the
   accent). Under it, two short panels: what the user notices, and what changes in the code.
   Then the **code shape, today → after**: a short annotated tree (server actions, components,
   Inngest steps, tables and RPCs) of only what the change touches. Today's tree marks what is wrong with `✗ <why>`; the after tree is
   a diff (`+` / `−` lines). Monospace, file names right-aligned and muted.
3. **Why it's safe:** the facts that must be true for the plan to work, drawn as evidence (a
   timeline of migrations and deploys — `promote-to-production.yml` applies migrations before it
   deploys, and a rollback runs older code on the newer schema — and a list of checks with ✓).
   Anything not verified is marked as such, never shown as a ✓.
4. **If it goes wrong:** a diagram of the failure: what breaks, what the user sees, how we find
   out (a `logger` slug, Sentry via `captureException`, an `audit_events` row, or none), and how we roll back.
5. **Decisions,** in two groups: **Your calls** (the ones the user answered in step 3, by impact)
   and **Decided by the agent** (choices the research or the attackers settled, so the user can
   object). One row each: the question, the chosen option (accent), the rejected one (struck
   through), why in one or two lines.
6. **What the attackers found:** a bar per round (serious vs cosmetic, fixed vs rejected), then
   only the findings that changed the plan, one line each, and the full list folded.
7. **Steps:** one row per work item (file, what changes, line delta), the ordering constraints
   marked on the rows, then the validation commands (`pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm build`; `pnpm check:migrations` and `pnpm db:types:generate` when `supabase/` changes).
   For several phases or PRs, one group per phase with its own result.
   **Verify:** one concrete scenario that proves it works, on the `/verify` recipe: the local stack,
   the seeded user and role (`pnpm seed:dev`, a lesser role for a permission change), and what each
   surface must show (exact Spanish copy, values). Then **Follow-ups:** what is left out on purpose,
   one line each, for the PR body's `## Follow-ups`, not filed.
8. **Footer:** the plan `.md` path, the commit researched, the date.

Follows the system theme, with the tokens of td-explain §Theme. Skip a section only when it has no
content (for example, no decisions open). ES/EN toggle always, both languages complete (td-explain §6).
Take one headless screenshot (td-explain §6), fix overlaps once, publish with the Artifact tool,
and copy the source next to the plan as `plan.html`.

## 6. Hand off

When `/td-build` runs this skill, the page also carries its progress bar (see td-build).

Reply in the user's language: the page link, the plan `.md` path, two or three lines on what the
plan does and anything still open, and the next command (`/td-implement <plan path>`).
