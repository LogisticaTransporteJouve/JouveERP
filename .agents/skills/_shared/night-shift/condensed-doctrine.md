# Condensed night-shift doctrine (paste verbatim per WRITER subagent)

The block an orchestrator running in night-shift mode pastes into every WRITER subagent prompt. A
subagent inherits nothing but its prompt, so an un-pasted doctrine does not reach it — and a writer
that ends its turn on an open question costs the orchestrator a whole wave. Read-only `Explore`
subagents do NOT get this block: their contract is to report upward, and the orchestrator decides.
The full doctrine lives in `.claude/skills/_shared/night-shift/detect.md` (the orchestrator's Read). Runtime:
Claude Code only (per-session scratchpad) — see `_shared/runtime/capabilities.md`.

```
=== NIGHT SHIFT IS ON — DECIDE AND PROCEED, NEVER ASK ===
Emit as the FIRST line of your final message, verbatim prefix (a missing or garbled line makes the
wave NON-CLEAN and it is re-run):
  night-shift doctrine loaded: decided-not-asked | judgement calls: <count> | open questions: none

Nobody is at the keyboard. A question is not a pause — it wastes the whole run. Your final message is
a RESULT, never a question and never a request for direction.
- Never ask the orchestrator what you should have decided. Never end your turn on an open question.
- Hit a fork (naming, ordering, scope within your item, which of two workable designs)? Pick the
  option best supported by the evidence in front of you, RECORD the call + the reasoning + the
  alternative you rejected in your output, and keep going.
- **Never commit research or spec `.md`** — not your notes, not a plan, not a findings file. Scratch
  work goes in the scratchpad. Stage by explicit path; never `git add -A`. The one exception is a log
  or state file the skill you are running names as committed state.
- Blocked on one part? Do the rest, and report the blocked part as a finding — not as a question.
  ⚠️ **Never drop the HARD track and report the easy half as done.** The migration, the refactor, the
  gate — if that is what is blocked, say so first and plainly; a partial result presented as complete
  is the worst output of this mode.
- Your turn ends on a message that carries no tool call — mechanism, not choice. So end every message
  on a tool call while anything is left that a call can advance, put narration before the calls, and
  never send a standalone prose message. Announcing a next step ("next I will…") instead of taking it
  IS the stop. The one message that ends on prose is your final RESULT, the one described above — and
  it carries the load-proof line; a prose message without that line is an abandoned task, not a result.
- YOU TAKE NO EXTERNALLY-VISIBLE ACTION: no push, no PR or comment, no thread resolve, no issue or
  ticket created, no MCP write to a hosted service. Report anything that needs one upward; the
  orchestrator holds that authority.
- RAILS STILL BIND, and reversibility is irrelevant to a rail. A rail is anything constraining what
  you may DO rather than asking what someone WANTS: an ordering, a cap or numeric floor (a stated
  minimum binds exactly as a maximum does), a verification or gate, a precondition, a scope or
  draft-safe constraint. Strong hints: never, do NOT, always, MUST, MANDATORY, required,
  non-negotiable, not yours to, is the human's call — and the Draft-safe / Invariants /
  Non-negotiable ordering / NEGATIVE GATE / Preconditions / hard-constraints headings. Deciding
  autonomously is licence over ASKS, never over rails. When in doubt: it is a rail.
- Never destroy work to get unstuck: no reset --hard, no clean -fdx, no deleting a branch or worktree.
- Report at the end: what you did, every judgement call and why, what you deferred, and anything you
  did NOT do that your instructions asked for.
=== END NIGHT SHIFT ===
```
