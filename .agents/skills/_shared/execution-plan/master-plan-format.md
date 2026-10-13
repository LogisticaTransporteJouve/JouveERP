# The living master plan — one source of truth per run (format + protocol)

You ALWAYS maintain a master plan, and you maintain it CONTINUOUSLY AS YOU WORK — it is the running,
single source of truth for the whole run, updated at every transition from your first action to your
last, **never** written up only at the end. It carries the north star, the execution posture, the PR
map + merge order, the tickable substeps, and the post-deploy manual work, so the owner (or another
agent) can **stop you at any moment, download it, and resume cold to completeness**. The ONLY thing that scales with the size
of the work is WHERE the plan lives (see the role section below) — never WHETHER you keep it. A run
that reaches its end without a continuously-maintained plan has already failed this rule.

This is the per-INITIATIVE artifact. It sits ABOVE the per-change `plan.md` (`_shared/plan-format.md`):
a `plan.md` is the machine-parsed detail of ONE substep; the master plan is the human index of the
WHOLE effort and points at each substep's `plan.md`. They do not overlap.

## It SUBTRACTS state, it does not add a doc

The master plan does not add a sixth description of the run. It **absorbs** the ad-hoc run-state the
orchestrators used to scatter, so the net scratchpad file count stays flat or drops:

| Artifact | What it OWNS (authoritative) | What it only REFERENCES |
|---|---|---|
| **master plan** | north star (1 line); execution posture; PR map + merge order; live per-PR gate **status**; substep tick-state; deferred + post-deploy follow-ups | each substep's `plan.md` (by id), PR URLs, any issue the user linked |
| `plan.md` (`_shared/plan-format.md`) | per-substep DETAIL — files, current/target, validation, Ports contract, Falsification Log, Success Criteria | — |
| `night-shift.state` | the mode flag (`ON/OFF`, `run:`) — **NEVER folded in** | — |
| TaskCreate list | the harness-UI checklist — a disposable projection of the substeps | — |
| PR body | the durable EXTERNAL snapshot, written once at handoff | — |

Hard rules that keep it single-source:
- **It REPLACES any orchestrator run-state file (e.g. an `auto-build.state`)** — that state becomes
  *sections* of the master plan (the per-PR table IS the Status section). Do not keep one alongside.
- **It NEVER touches `night-shift.state`.** That stays a 2-line machine file every skill `cat`s at its
  mode check; a mode check must never have to parse narrative.
- **Tick-state lives in the master plan, not TaskCreate.** A cold reader opens the `.md`, not your
  Task list. If the two disagree, the doc wins; TaskCreate is disposable.
- **The PR body is a terminal snapshot, not live.** Do NOT mirror `gate:` into the PR body mid-run —
  that is the drift. The master plan is the only live copy of status.
- **plan.md is referenced, never copied.** A substep line reads `1.2 <one-line label> → plan.md §1.2`;
  never restate Success Criteria or work-item detail in the master plan.

## You always keep it — it is a ROLE that is not always a separate file

You ALWAYS maintain the master plan, continuously, on every run. "Not always a file" is ONLY about
WHERE it lives — never about whether you keep it. On a trivial change the role condenses onto
TaskCreate + the PR body (still maintained, still live at every transition); spinning up a separate
`.md` there would be pure ceremony. The moment the work outgrows those, the plan becomes its own file.

**The `.md` is born the first moment those cannot hold the state.** Materialize it (write
`<your scratchpad>/master-plan.md` — substitute your real scratchpad path from your system prompt) the
instant ANY trigger fires:
- the run will open **more than one PR**, or
- it **fans out** to parallel writer subagents, or
- it will **span a compaction** (a long single-context run), or
- it accrues its **first deferred / out-of-scope item**, or
- it is **about to invoke a ship gate** — Phase 4's `gate: not-started → invoked` needs a durable
  home, so a mid-gate compaction resumes the gate rather than restarting Phase A and resetting the
  head-cycle cap. (This is why `auto-build` Phase 4 says the plan "is materialized" once the PR opens
  on the single-PR path — opening the PR to invoke the gate IS the trigger.)

Until a trigger fires: no `.md`, but the plan is still maintained continuously on TaskCreate + the PR
body. This is what makes a standing, always-on rule weightless on small work and complete on large work
— it is always kept, it just does not always occupy a file.

## Section schema — sections earn their place by entry count

Emit only what has content; "one line until it needs two." A section materializes when it holds more
than one entry.

1. **North star** — ALWAYS, exactly one sentence: the objective. Point at `CLAUDE.md` / the user's
   request for "what this means"; do not restate the Success Criteria (those live in each `plan.md`).
2. **Status & handoff** — ALWAYS, kept live. Per active PR/substep: worktree path + branch + base;
   **local HEAD sha vs pushed sha** (and "N commits local, not pushed"); the exact gate position
   (planning / implementing / review-wave k-of-N / `gate:invoked` / bot head-cycle k of ~6 / CI /
   mergeable); `night-shift: ON|OFF` and who clears it. The real validation commands (test/lint/build)
   if there is no `plan.md` to carry them.
3. **Substeps** — the tick list. `- [ ] 1.2 <label> → plan.md §1.2 · <status>`; tick as executed.
4. **Execution posture** — appears ONLY when it deviates from the default (`off main, PRs draft,
   no cleanup, nothing deferred`): the safety/speed stance, how `main` + existing PRs get cleaned up,
   what is deferred and WHY.
5. **PR map + merge order** — appears ONLY at PR #2 (a 1-PR run never renders it): current + intended
   PRs, each with status; the merge ordering + end-state (what the tree looks like when done); and
   file-overlap dependencies as explicit rows (which PRs touch the same files and need `origin/main` merged in
   after the first merges).
6. **Blocked & deferred** — live `FAILED` / `RED` / `AWAITING-HUMAN` items with *what was tried*
   (not only in the terminal summary); deferred work as the **`## Follow-ups` entries already written**
   (and any issue links the user asked for) so nobody re-files them.
7. **Post-deploy / operational follow-ups** — appears at follow-up #1 (else the status line reads
   `follow-ups: none`): manual steps, backfills, by-hand data fixes, migrations to run out of band.

## Liveness — a stale master plan is worse than none

A confidently-wrong handoff is the one failure this artifact must never produce. Liveness is enforced
structurally, not by a reminder:

- **The doc IS the resume file.** Because it absorbed the orchestrator's run-state, the
  mandatory writes the run already makes (gate `not-started → invoked → sha`, per-PR
  `status/rounds/verdict`) ARE edits to the master plan — you cannot advance a gate without editing
  it. The rule "on compaction, RELAUNCH from state, never reconstruct from memory" now points here.
- **Transition echo (a load-proof line).** At EVERY substep transition (start / PR opened / pushed /
  gate passed / merge-ready / deferred / blocked), emit in that same turn:
  ```
  master-plan @ <abs path> updated: substep <id> <from>→<to> | pushed: <sha|LOCAL-ONLY> | gate: <state>
  ```
  A missing or garbled line means the transition did not durably land — treat it as NON-CLEAN and
  re-do the write. (When the role has not materialized a file yet, echo `master-plan: role-only (no
  trigger) | …` instead.)
- **Git cross-check on relaunch.** If the master plan's last-transition marker is older than the
  branch's last commit or last push, the doc is **STALE** — reconcile it from `git` (the ground truth
  the narrative is checked against) BEFORE proceeding.

## The final report is a snapshot of this doc

The terminal report / morning summary is the master plan's final state, not a separate narrative — and
it still goes in the PR body (the scratchpad dies with the session; committing it is forbidden). The
master plan is the LIVE version; the PR body is the frozen handoff copy.

## Consumers — explicit-Read wiring (keep in sync)

Each orchestrator maintains the master plan at the state-writing points it already has; it Reads THIS
file (by absolute path, with a step-1 imperative Read) rather than restating the format:

- `/auto-build` — at the point it used to persist `auto-build.state`: that state IS the master plan now. Materialize the
  `.md` on the first trigger; echo each transition; put the final snapshot in the PR body.
- `/auto-implement` — single-context builds keep NO state file today (the resume hole): adopt the
  master-plan role; materialize the `.md` the moment the run spans a compaction or accrues a deferred
  item.
- `/auto-ship-gate` — update the driven PR's row (bot head-cycle count, CI, mergeable) at each gate
  transition.

Cite this file by absolute path (`.claude/skills/_shared/execution-plan/master-plan-format.md`) with a
negative gate: if you have not read it, do not claim to be maintaining a master plan.
