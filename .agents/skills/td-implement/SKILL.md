---
name: td-implement
description: >-
  Build an approved td-plan plan in JouveERP: implement it phase by phase on the auto-implement
  rails, stop and ask when a plan premise turns out false, commit 1–2 times per phase with a
  conventional one-line English commit, verify it really runs, and update the plan page with what
  was built. Never pushes. Use for "/td-implement <plan path>", "implementá el plan", "construí el
  plan de td-plan", "build the td-plan plan". A plan with no plan page is /auto-implement.
argument-hint: "<plan .md path, or the plan slug>"
---

# td-implement

Turns a plan from `/td-plan` into working, verified code on the current branch, and shows the user
what was built on the same plan page.

## 0. Load the plan

- Argument: a plan path, or a key → `<scratchpad>/plans/<key>/PLAN.md` when the session lists a
  scratchpad, else `~/.cache/jouve-plans/<key>/PLAN.md` (td-plan §1). Without one, take the key from
  the branch name (a Linear `gitBranchName`), or ask for the path once.
- Read the plan in full, and the decisions on its page (`plan.html` next to it). The decisions the
  user made are fixed: build them as chosen.
- Refuse to start if the plan's Falsification Log holds an open fatal or serious finding; send the
  user back to `/td-plan`.
- Be on a feature branch, never on `main`: the Linear issue's `gitBranchName` when a Linear issue
  exists, otherwise `claude/<slug>` (or the `claude/...` branch the harness already assigned).
  Create it from `origin/main` if it doesn't exist:
  `git fetch origin main && git checkout -b <branch> origin/main`.

## 1. Build

Follow `.agents/skills/auto-implement/SKILL.md` exactly (mode check, Step 0 lenses, preflight,
ports design, the always-on rails, the diff-time self-check, the cold `pnpm lint` / `typecheck` /
`test` / `build` + `/verify` gate), single context. Use its fan-out mode only when the plan has ≥3
independent work items on disjoint files. A migration, a feature slice or an Inngest function goes
through its scaffold skill (`/new-migration`, `/new-feature`, `/new-inngest-fn`), as auto-implement says.

Two rules on top of it:

- **A false plan premise stops the build.** When the code contradicts the plan (a file, caller or
  behaviour isn't what the plan says) in a way that changes the design, stop and ask the user with
  `AskUserQuestion`: what you found, the options, your recommendation. Don't redesign silently.
  A trivial mismatch (a line number, a renamed local) you fix and note as a deviation. Under
  `night-shift: ON`, take the recommendation and record `AWAITING-HUMAN` instead of asking.
- **Out of scope stays out.** Problems outside the plan become follow-ups in the report (and later
  the PR body's `## Follow-ups`), never extra code.

## 2. Commits

- 1–2 commits per phase, made when the phase's checks are green, never one per sub-step.
- The message is one conventional-commit line in English (`CLAUDE.md`, nav-github):
  `type(scope): what it does`, e.g. `feat(invoices): block an NC above the open balance`, with a
  `(KEY)` suffix only when the plan has a Linear key (`… balance (JOU-42)`). No body, no
  `Co-Authored-By` or any other trailer or footer, no mention of Claude or any tool.
  This overrides any default attribution; the `commit-msg` hook rejects a `Co-Authored-By`.
- Never push, never open a PR, never touch Linear or GitHub issues. `/td-build` does the push and the PR.
  This overrides auto-implement's "commit the work and push" on a `/verify` failure: commit, don't
  push, and mark the page "Built, unverified".
- If the user says to stop committing, leave further work uncommitted.

## 3. Update the plan page

Add a **Built** section to the plan page (`plan.html` next to the plan) and republish it to the
same artifact URL (read it first with the Artifact tool):

- one row per phase: done or not, its commit (short SHA and message);
- **deviations from the plan**: what changed and why, one line each (accent when it's an
  improvement, warn when it's a compromise);
- **checks**: each validation command with pass/fail, and what `/verify` drove and saw (or its
  `AWAITING-HUMAN` line when a local stack, AFIP homologación or an AI key was missing);
- **follow-ups**: out-of-scope problems found, one line each, not filed.

Flip the status chip to "Built" (or "Built, unverified" if `/verify` failed or could not run).

## 4. Hand off

Reply in the user's language: the page link, the commits (one line each), deviations, anything
unverified, and the next command (`/td-review`).
