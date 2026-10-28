---
name: auto-build
description: >-
  Take one change from intent to merge-ready end to end: adv-planning → auto-implement → adv-review
  → auto-ship-gate over a SINGLE change. Use for "build this feature end to end", "take this from
  plan to merged", "own this change start to finish", "orchestrate the full build". One change
  only — not a sweep over a set of already-open PRs. JouveERP (single Next.js app, PRs
  always draft against main).
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, Task, Skill
---

> ⚠️ **Autonomous orchestrator — use with human oversight.** This skill runs multiple phases largely unattended (it may fan out subagents and push commits). Prefer it for smaller, well-scoped, lower-risk changes, and review its output before merging. It stops at merge-ready — it never merges.

# Orchestrate Build — plan → implement → review → ship, for one change

You are the **conductor**. You do NOT design, write, review, or gate the code yourself — each phase
is a self-contained L3 skill you invoke IN SEQUENCE via the `Skill` tool. Your only jobs: sequence
the four phases, carry the `plan.md` handoff, decide single-context vs. fan-out for the build phase,
and stop at merge-ready. The parallelism lives INSIDE the implementation phase — this conductor is
sequential and thin.

## Autonomy

> **Runtime:** where a step says "spawn a wave" / "fan out subagents" (`Task`/`Explore`), that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the passes serially, same lenses/gates/floors), see `.claude/skills/_shared/runtime/capabilities.md`.

**MODE CHECK — do this first.** Read `.claude/skills/_shared/night-shift/detect.md` and follow it (`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken read into a confident, wrong `OFF`). If it records `night-shift: ON`, its **RULE ZERO** governs. A `Skill` callee shares your context and
scratchpad, so it detects the mode itself — you pass nothing. **Never hand `night-shift: ON` to a
`Task` subagent:** writers get the doctrine paste, and read-only `Explore` agents must stay outside
the mode entirely. Never ask, never idle; resolve design forks with `/adv-research` and log
the call. It overrides every consent gate, approval wait and check-in line below. It overrides no rail —
`## Merge-safe (whole run)` is where most of them are written down, but that list is illustrative,
not exhaustive: when in doubt, it is a rail. Otherwise this file governs exactly as written.

⚠️ **On ANY exit — precondition, cap, `FAILED`, refusal or success — if the state file's `run:` names this skill, clear the mode BEFORE reporting: `printf 'night-shift: OFF\n' > "<your scratchpad>/night-shift.state"`. An early exit that skips this leaves the user's next command running with no consent gates.

## Scale + consent — read first
A full run spawns falsification waves (planning), optional writer fan-out (implementation), and
multi-wave review + a bot/CI loop (review + ship) — large token cost, long wall-clock. Run only when
the user opted into that scale ("build this end to end"). That consent check happens ONCE, before you
start; once running, the `## Autonomy` section above governs — do not check in again.

## Phase 1 — Plan  (invoke `/adv-planning`)
Pass the user's intent. The skill researches, writes `plan.md` in the `_shared/plan-format.md`
structure (incl. `## Architecture & Ports Contract` + `## Falsification Log`), self-falsifies it with
independent attackers, and applies the design-time ports gate. **The plan.md it emits is the handoff
artifact for Phase 2.** Record the plan's wave/DAG summary + sizing and proceed to Phase 2; pause for
plan approval only when your mode check returned OFF. A plan with an unresolved fatal/serious
Falsification-Log finding is NOT ready — send it back to `/adv-planning`, do not ask about it.
⚠️ **Cap: 2 send-backs.** A third means the attackers and the plan are not converging — that is a
result, not a loop. Record `FAILED: planning did not converge — <the surviving finding>`, stop, and
report it with the best plan you have. Falsification that never terminates is how a night is spent
producing no code at all.

## Phase 2 — Implement  (invoke `/auto-implement`)
Hand it the `plan.md` path. The build engine (read-before-write, rails, diff-time ports self-check,
the `/verify` cold+large gate) all live INSIDE that skill. Your ONE
decision here — the only orchestration choice this conductor makes:
- **Single context** (default): plan is ≤ ~8 files/items, or items share files / are tightly coupled
  → `/auto-implement` builds it all in one context.
- **Fan-out**: plan has ≥3 independent work items on disjoint files with a clean DAG → tell
  `/auto-implement` to run its wave engine with parallel WRITER subagents (it owns wave
  ordering, per-wave validation, and pasting its rails + the ports, dry, comment, telemetry and reach lenses + each triggered lens + the working-location orientation into every writer prompt).
Decide from the plan's DAG + sizing; when in doubt, single context.

⚠️ **If Phase 2 returns `FAILED: /verify`, do NOT enter Phase 3.** An unverified change is a dead
track — do not hand a broken tree to review. But still leave the morning something: **open a DRAFT PR
from the pushed branch** (`gh pr create --draft --base main`) — that write, plus the label below, and
nothing else: no gate. Its body starts with `## Resumen`, whose first sentence says `/verify` failed
(what was tried) and the PR must not be merged. **Label it `do-not-merge`**
(`gh pr edit <n> --add-label do-not-merge`; the repo has no such label yet, so on a "not found" error
create it once with `gh label create do-not-merge --description "Unverified: do not merge"` and retry
— both writes are mandated here by name). Every JouveERP PR is a draft, so draft state alone marks
nothing, and a draft's skipped checks render as `skipping` rows that read like passes; the label is
the marker. Never invoke `/auto-ship-gate` on a PR carrying it. Then clear the mode and report.

## Phase 3 — Review  (invoke `/adv-review`, converge path)
Run over Phase 2's changes. auto-implement builds in the WORKING TREE and does not commit (Phase 4 commits), so review the working tree, not just `git diff <base>...HEAD`. Multi-wave, fix-as-you-go, to ≥3 consecutive clean waves on
production-code tracks, then one more (adv-review's own floor — do not stop at three). Fix what converges; record out-of-scope findings for the PR body's `## Follow-ups`. Direct L3
call to `/adv-review` — you already own the one change.

## Phase 4 — Ship  (invoke `/auto-ship-gate`)
JouveERP does not require a Linear issue, so nothing has to be filed before the branch. Name the
branch `<type>/<english-slug>` (e.g. `feat/storage-billing-credit-notes`) — or keep the `claude/...`
branch the harness already assigned; never rename a branch that already has an open PR (that closes
it). If the user linked an issue, reference it in the PR body under `## Related`; file a new one only
if the user asked.

Then commit (conventional commits in English, NO `Co-Authored-By` or any trailer/footer — CLAUDE.md
overrides any tool's default attribution) and push the feature branch (create one first if you are on
`main` — never push to `main`), open the PR against `main` **as a draft**
(`gh pr create --draft --base main`; title per CLAUDE.md and `nav-github`; body following
`.github/pull_request_template.md`, so it starts with the template's first section `## Resumen`, with
`## Follow-ups` for everything routed out), write `phase: 4 | gate: not-started`
into the master plan (a PR now exists, so it is materialized — never a separate `auto-build.state`),
and **invoke `/auto-ship-gate` via the `Skill` tool.** Nothing else. This conductor does not know
what the gate does and must not act as though it does — migration checks, the Phase-A manifest, the
draft-state rule, the bot settle rule, CI and mergeable all live in that file.

⚠️ **Executing the gate inline is a `FAILED` run, not a shortcut.** Reading `auto-ship-gate/SKILL.md`
and following it yourself, or driving `gh pr checks` / bots / threads from here, does not count and
is the single most common way this pipeline silently ships an ungated PR: the settle rule and the
multi-bot traps only bind inside that skill.
"The `Skill` call cannot be made" means the tool itself errored: paste the verbatim error, record
`FAILED: auto-ship-gate not invoked`, and report the run INCOMPLETE. Without that paste the line does
not apply — a gate is never routed around, and no `FAILED:` marker makes a run with an ungated PR a
delivered one.

## Handoffs
- P1→P2: the `plan.md` path (the ONLY structured artifact; never paste research docs into code).
- P2→P3: the branch's WORKING TREE — Phase 2 does not commit, so tell reviewers to read working-tree
  files, not `git diff origin/main...HEAD`, which excludes exactly the edits under review.
- P3→P4: a clean-converged branch. P4→done: merge-ready as a DRAFT PR (NOT merged, NOT marked ready
  — both clicks stay the user's).

## Subagent constraints
Any research/falsification subagent is READ-ONLY: use `Explore` and paste
`.claude/skills/_shared/subagent-constraints/hard-constraints.md` + `.claude/skills/_shared/subagent-constraints/working-location.md` (orientation) at the top of every prompt. Writer prompts under night-shift mode also get `.claude/skills/_shared/night-shift/condensed-doctrine.md` — they arise in **both** `/auto-implement`'s fan-out and `/adv-review`'s PATH-A (Track 2 writes tests; fix writers write code).
⚠️ **Verify the paste landed.** A writer result missing the verbatim first line
`night-shift doctrine loaded: decided-not-asked | judgement calls: <count> | open questions: none`
means the block never reached it — that wave is **NON-CLEAN, re-run it**. ⚠️ This applies only to
waves that actually spawned a writer: on the uncommitted P2→P3 path the orchestrator applies fixes
itself, and a wave with no writers is not NON-CLEAN for lacking a line nobody was asked to emit. A subagent that never got
the doctrine cannot be the one to report its absence, so the check lives here.

## Merge-safe (whole run)
Never merge, never mark the PR ready for review, never take the change past merge-ready-as-draft.
JouveERP PRs always stay draft; the CI jobs (`Lint / Typecheck / Test / Build`, `database`) run on
drafts, while `Preview` waits for the human to mark the PR ready — that skipped row is expected,
not a pass.
Continuously maintain the run's **living master plan** per `.claude/skills/_shared/execution-plan/master-plan-format.md`
— the running single source of truth, updated at every transition (not just at the end), that ABSORBS this run's state (never `night-shift.state`, which belongs
to the mode). Its `gate:` field is yours and `auto-ship-gate` knows nothing about it: `not-started`
→ `invoked` immediately before the `Skill` call → the receipt head SHA when it returns. It is a ROLE
over TaskCreate + the PR body until a trigger fires (a 2nd PR, a fan-out, spanning a compaction, or a
first deferred item), then materialize it as `<your scratchpad>/master-plan.md` and echo each
transition. On compaction RELAUNCH from it and **re-Read this file** — the Phase-4 rails are not in the
master plan. A relaunch reading `not-started` re-enters
Phase 4; reading `invoked` it resumes the gate rather than restarting Phase A, which would reset the
gate's own head-cycle cap. The gate having "probably run" is not a record that it did.

## Final report

⚠️ **If the mode was ON and the state file's `run:` line names THIS skill, you are the
top-level run — clear it BEFORE this report** (`_shared/night-shift/detect.md` § Ending the mode owns
this; `run:` is the test, not your recollection of who invoked you):
`printf 'night-shift: OFF\n' > "<your scratchpad>/night-shift.state"` (your real path). The mode
covers one top-level invocation; leaving it set means the next thing the user types in this session
runs with its consent gates suppressed while they are sitting there.
⚠️ **If you were invoked BY another skill, do NOT clear it** — that run is still going and needs the
mode. Clearing it mid-pipeline silently re-arms every consent gate for the phases after you.

Reflex `/tighten` before sending. Table: phase → outcome → what was built → fixed vs. deferred
(`## Follow-ups` entries) → review clean-waves → auto-ship-gate result (CI/mergeable/draft) → the
remaining human actions (mark ready for review when they want the Claude review bot, then merge).

⚠️ **The gate row needs a RECEIPT, not a claim.** "CI green, mergeable" is prose and you
can write it without anything having been checked. Report merge-ready only by passing through the
three receipt artifacts `auto-ship-gate` returns in its `## Output` — verbatim, not re-derived here.
Missing any of the three, the row is `FAILED: gate unverified` — a PR nobody gated is exactly the one
that reads greenest.

⚠️ **The table is not the whole report.** If the mode was ON, also give every bullet of
`_shared/night-shift/detect.md`'s `## Morning summary` — external writes with their mandating step, required
checks that never ran, threads resolved without a code change, findings routed out, every `FAILED` /
`RED` / `AWAITING-HUMAN`, and rounds/waves actually run against each floor. Rendering the table alone
satisfies this file and silently violates that one.

⚠️ **Put the summary in the PR body too.** The decision log lives in the session scratchpad, which
dies with the session, and committing it is forbidden — so without this the only durable record of
the night is a diff. The PR body is already a mandated write; use it.
