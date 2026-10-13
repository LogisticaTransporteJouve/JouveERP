# Runtime capabilities — the tool-neutral fan-out contract

> **Not running in Claude Code? (Cursor, Codex, or any other tool) — read this first.** A few
> capabilities these skills name are Claude Code specifics: night-shift autonomy, background/scheduled
> runs, the `Task`/`Explore` sub-agent tools, and the per-session scratchpad state file. If your tool
> does not have one of these, nothing is broken and there is **nothing to turn on or off** — the
> mechanism simply does not apply to you. Skip that mechanism and keep following the skill's
> **principle** exactly as written (same lenses, same gates, same acceptance bar). Concretely: when a
> skill is "Claude Code only", you do not disable anything — you run it attended, in one context, and
> still obey every rule it states. The rest of this file spells out how the parallel-wave execution
> maps onto a runtime with, without, or with only weak-tier sub-agents.

These skills describe an engineering **doctrine** (the lenses, the gates, the acceptance bar) that is
independent of any one agent runtime. Some skills also describe **how to execute** that doctrine using
parallel sub-agents. Parallel execution mainly buys wall-clock and independence; for most skills it is
an optimization, not a correctness requirement — with the one exception noted below. This file is the
single source of truth for what "fan out" means across runtimes, so no skill body has to hardcode one
tool's sub-agent API as the only way.

## The contract

Where a skill says "fan out parallel read-only sub-tasks", "spawn a wave", "spawn N subagents", or
"paste this block into every subagent prompt":

- **If your runtime has parallel sub-agents you can rely on, use them.** Run the wave as written — the
  parallelism buys wall-clock and independence. Claude Code: `Task` for writers, `Explore` for read-only,
  with the paste blocks in `_shared/subagent-constraints/`. Other runtimes: use that runtime's own
  sub-agent mechanism when the runtime or operator vouches for its tier — otherwise the weak-tier case below.
- **If your runtime has no sub-agents (e.g. Codex), run the passes SEQUENTIALLY in one context.** Same
  lenses, same gates, same floors, same acceptance bar — just serial instead of parallel. A "wave of 4
  attackers" becomes 4 independent passes you run one after another; a "writer per work item" becomes
  you implementing each item in turn. Nothing about the acceptance bar relaxes; only the concurrency
  changes (with the independence nuance below).
- **If your runtime has sub-agents but you cannot rely on their tier (weak-by-default, e.g. Cursor's
  Composer), treat them as no-sub-agent** — run the passes serially in your own context (the Codex case
  above). A weak stage silently caps quality: a judge can falsify a wrong claim but cannot see one never
  gathered, so neither the gather nor the judgment is safe to hand off.

The stated minimums are floors on the DOCTRINE, not on the concurrency: "≥4 attackers per round",
"≥3 consecutive clean waves", "run one more round than you think" all still bind when you run serially —
you perform that many independent passes, you do not skip them because they are not parallel.

**What serial execution does not fully reproduce — independence.** A few skills rely on a sub-agent
being *blind* to the author's own reasoning: adv-planning's falsification hands each attacker only the
plan and the codebase, never the author's rationale, so it cannot rationalize. A single sequential
context holds its own reasoning and cannot un-know it, so serial falsification keeps the premises and
the coverage but is strictly weaker on blindness. Running serially, adopt each falsifying premise as an
adversary would and actively distrust your own prior reasoning. This is the one exception the opening
flags: for that falsification step, independence is a correctness input, not merely speed.

**Paste-blocks and load-proof echoes are cross-context devices.** "Paste this block into every subagent
prompt" and the load-proof echoes (the catalog / ports / dry counts, the read-only fence) exist to
inject into — and verify — a fresh sub-agent that inherits nothing. With no sub-agents there is nothing
to paste into: read those files directly into your one context. That read satisfies the echo / NON-CLEAN
gates (they do not bind as separate gates), and the read-only fence is moot — there is no separate agent
to fence.

## Frontmatter core

The portable, load-bearing frontmatter is `name` + `description` (the open Agent Skills core). Runtimes
that only understand those two still route correctly. Other keys (`allowed-tools`, `argument-hint`,
`model`, `effort`) are Claude Code hints — harmless to ignore. `disable-model-invocation` is a Claude
Code **safety** key: see below.

## Runtime: Claude Code only

Two mechanisms in this package depend on Claude Code specifics and have no portable equivalent yet:

- **Night-shift autonomy** (`_shared/night-shift/`) keys on Claude Code's per-session scratchpad path
  (`<scratchpad>/night-shift.state`). A runtime without a session-scoped scratchpad has no equivalent
  signal, so night-shift is **unavailable** there and every run is attended. A portable arming signal
  (an explicit `--night-shift` argument or a `NIGHT_SHIFT=1` env var) is future work.
- **`disable-model-invocation: true`** is what stops a passing phrase from auto-loading a skill that
  must be invoked deliberately. No skill in this package sets it today; if one is added, a runtime that
  does NOT honor this key must treat that skill as **manual-invoke-only** — never auto-routed from a
  description match — because auto-firing a mode-arming skill would strip its consent gates.
