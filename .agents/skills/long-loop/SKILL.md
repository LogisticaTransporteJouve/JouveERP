---
name: long-loop
description: >-
  Run a per-item pipeline over a LARGE set of items (hundreds+) as one disk-backed, resumable,
  multi-session campaign that survives compaction, rate limits, account switches and process kills.
  Use for "process/triage/migrate/audit/enrich/review N items through the same multi-step pipeline",
  "loop the same job over the whole backlog / every file / every rule / every table", "long-running
  batch that must resume where it left off", "run this over hundreds of things overnight". NOT for a
  single change end-to-end (/auto-build), interval polling (the built-in /loop), or a one-shot
  fan-out that fits one Workflow call.
disable-model-invocation: true
---

# Long loop — a disk-backed, resumable campaign over a large item set

You are running the SAME multi-step pipeline over hundreds of items, for hours or days, across
sessions and interruptions. The whole discipline is: **disk is the source of truth; context is
disposable.** Everything that matters — the item inventory, the rules every worker reads, the
per-item results, the progress ledger, the resume protocol — lives in files under one campaign
directory. When context compacts, a rate limit hits, the user switches accounts, or the process is
killed, you re-read disk and continue exactly where you were. Nothing is held in your head.

## When to use / when not

Use it when ALL hold: the item count is large (roughly >40, where re-running from scratch on a
crash is unacceptable), each item runs through a *multi-step* pipeline (not a one-liner), and the run
will outlive a single uninterrupted session. Examples: promote a backlog to ready, migrate every call
site, audit every RLS policy or server action, enrich every record, deep-improve every rule in a rule set.

Do NOT use it for: a single change taken to merge (`/auto-build`); polling something on a fixed
interval (built-in `/loop`); or a fan-out small enough that one `Workflow()` call finishes it before
anything can interrupt — then just call `Workflow` directly.

## The doctrine (the laws that make it survive)

1. **Disk is truth, context is disposable.** Write inventory, ground-truth rules, per-item outputs,
   progress ledger and the resume pointer to files. Never derive a tally, a "what's left", or a
   decision from memory when a file can hold it. Reconcile from disk, always.

2. **Foundation before any worker runs.** Build, up front: (a) a **ground-truth doc** every worker
   reads (the rules/taxonomy/decision model — so workers decide against ground truth, never guesses);
   (b) a **full inventory** of the items; (c) a **global index** for dedup/context that spans the
   WHOLE space, not just the items in scope (e.g. all items in every state, all call sites, all
   prior work) — cross-item decisions need what's already done, not only what's pending;
   (d) a **semantic clustering** so related items and likely duplicate pairs land in the same batch.

3. **Pilot before scale.** Run the full machine on the smallest cluster first. Then **inspect the
   real side effects** — fetch the actual mutated state, don't trust the workers' self-reports — and
   only scale once the writes are genuinely right.

4. **The per-item pipeline is 3–4 staged agents**, separating read-research from write-action from
   adversarial-gate: **understand** (read-only: research the item + codebase/data, gather dedup
   candidates, judge whether it's still live) → **act** (the write: change the thing in place) →
   **review + gate** (re-verify strictly against ground truth, run dedup + a redundancy/"still worth
   doing" check, decide the terminal disposition) → **resolve** (fires only on genuine ambiguity).
   Force **structured-output schemas** on every stage so returns are machine-reconcilable, not prose.

5. **Per-item isolation is non-negotiable.** One bad item must never abort a batch. Wrap each item's
   pipeline in try/catch; on a throw (a StructuredOutput retry-cap, an agent death, a transient API
   error) return an `error` outcome and move on — it re-runs on the next pass. Without this, a single
   item's failure kills the whole run. (This is the most common way a naive version breaks.) But
   **re-running an errored item is only safe when the act is idempotent** — setting a field/label/state
   converges; appending, creating, or migrating does not. For a mutation that would duplicate or
   corrupt external state on replay, gate the retry: a stable idempotency key, a durable per-item
   marker written *before* the mutation (so a half-completed item is detectable), or a live-state check
   before re-acting. A worker that dies after its external write but before its `final.json` looks
   identical to one that never ran — the reconcile (Law 6) only knows "no final.json → re-run".

6. **Idempotent, stable-id-keyed reconcile.** Each item writes a `<original-id>.final.json`. The
   reconciler scans ALL of them, keyed by the ORIGINAL id (the stable filename), and tallies from
   disk. This is what makes re-runs, partial batches, and item **re-keys** (see below) all reconcile
   without double-counting or loss.

7. **Batch small; re-run only the stragglers.** Batches of ~15–22 items. Small enough that a rate
   limit or kill mid-batch loses at most one batch; after any interruption, reconcile and re-launch
   ONLY the not-done items, not the whole batch. Concurrency is one constant the user tunes.

8. **A resume pointer with a written protocol.** A `loop.json` (or `state/`) holds the current
   batch index, the run id, the tally so far, and a plain-English protocol describing exactly how to
   continue. Write it so a future session — or your post-compaction self — resumes deterministically
   without re-reading this whole conversation. **Persist the pending batch id + the run id AT launch,
   before the batch is in flight** — not after it returns — or a kill mid-batch leaves the pointer
   naming the *previous* batch, and a cold session can't take the `resumeFromRunId` path (and may
   relaunch already-mutating items).

9. **Survive interruptions, don't fight them.** Rate/spend/weekly limits reset at a stated time:
   park on a background timer until then, or resume immediately when the user lifts the limit
   (account switch). For long waits, loop the sleep in ≤10-minute increments and re-arm on each kill
   — sandboxed environments cycle, and every kill re-invokes you, which is a usable heartbeat. An
   in-flight batch that dies leaves its completed items on disk; just reconcile and continue.

10. **End with an adversarial outlier sweep.** Cheap deterministic structural scan FIRST (invariants:
    missing required field, wrong owner, contradiction). Then N *distinct* semantic lenses, each
    hunting one class of anomaly the scan can't see, over a compact table of the results. **Verify
    each candidate independently against live state** before acting (this is where you catch a write
    that silently reverted, or a worker that was confidently wrong). Apply only what converges.

11. **Maintenance = a delta pass.** On a living set, re-scrape and diff by a **stable** signal
    (a creation timestamp), never by mutable keys — keys re-key, timestamps don't. Process only the
    genuine new arrivals; reconcile and re-run the outlier sweep over just the delta.

## Campaign directory layout

```
<campaign>/
  00-ground-truth.md         # the rules every worker reads (routing, taxonomy, decision model)
  inventory.json             # all items in scope
  global-index.json          # the WHOLE space, for dedup/context (built by a subagent, kept off your context)
  clusters/<name>.json       # semantic batches
  engine.workflow.js         # the cached per-item Workflow engine (edit the FILE, re-run by scriptPath)
  reconcile.py               # idempotent, stable-id-keyed tally from disk
  items/<id>.{understanding,enriched,final}.json    # per-item stage outputs
  state/
    progress.json            # per-item stage + outcome, keyed by original id
    loop.json                # resume pointer + written protocol + running tally
    batches.json / runs.json # the ordered batch plan
  adv-review.workflow.js     # the final multi-lens outlier sweep
```

## The engine (cached Workflow)

> **Runtime:** the cached-Workflow engine (`Workflow` / `scriptPath` / `resumeFromRunId`) is a
> Claude-Code capability. On a runtime without it (see `.agents/skills/_shared/runtime/capabilities.md`), drive the
> same per-item pipeline **sequentially or via subagents** — the pipeline shape, batching, disk-keyed
> reconcile and outlier sweep are all unchanged; only the fan-out/cache mechanism differs, and you
> checkpoint each item's `final.json` yourself in place of the run cache.

The per-item pipeline is a Workflow **written to a file** and launched by `scriptPath` — so you
iterate the script by editing the file, never by resending it, and a crash resumes with
`resumeFromRunId` (completed agents replay from cache). Skeleton:

```js
export const meta = { name: 'campaign-engine', description: '...', phases: [...] }
const args = typeof globalThis.args === 'string' ? JSON.parse(globalThis.args) : globalThis.args // args can arrive as a STRING
const { cluster, items } = args

async function runItem(it) {
  try {                                   // LAW 5: isolate — a throw here must not kill the batch
    const u = await agent(understandPrompt(it), { schema: U_SCHEMA, agentType: 'general-purpose' })
    if (!u) return { id: it.id, outcome: 'error', reason: 'understand died' }
    const e = await agent(actPrompt(it, u), { schema: E_SCHEMA, agentType: 'general-purpose' })
    if (!e) return { id: it.id, outcome: 'error', reason: 'act died' }
    let r = await agent(gatePrompt(it, u, e), { schema: R_SCHEMA, agentType: 'general-purpose' })
    if (r?.outcome === 'needs-resolve') { try { const r2 = await agent(resolvePrompt(it, u, e, r), {schema: R_SCHEMA}); if (r2) r = r2 } catch {} }
    return r ?? { id: it.id, outcome: 'error', reason: 'gate died' }
  } catch (err) { return { id: it.id, outcome: 'error', reason: String(err).slice(0, 200) } }
}

const CONC = 3                             // LAW 7: one constant the user tunes
const results = []
for (let i = 0; i < items.length; i += CONC) {
  results.push(...await parallel(items.slice(i, i + CONC).map(it => () => runItem(it))))
  log(`progress: ${Math.min(i + CONC, items.length)}/${items.length}`)
}
return results
```

Each worker writes its own `<id>.final.json` (so reconcile is disk-driven, not dependent on the
Workflow's return). Workflow-script gotchas that will bite: **args may arrive as a JSON string**
(parse defensively); **inner backticks inside a prompt template literal break the parser** (avoid
them); `Date.now()`/`Math.random()` are unavailable in scripts (pass timestamps via args, vary by
index). Prefer `agentType: 'general-purpose'` for workers that must both read code AND write.

## The reconcile loop (main context)

After every batch completes: run `reconcile.py` (scans `items/*.final.json`, updates
`progress.json`, prints the running tally + the next pending batch), then launch the next batch,
then update `loop.json`. On any rate-limit/kill: reconcile, compute the not-done stragglers, re-launch
only those. Keep the main context lean — never read a full batch result into it; drive off the
reconciled tally and the per-item files. Offload the big scrapes (the global index) to a subagent so
their volume never lands in your context.

## The final outlier sweep

A second Workflow: build a compact table of every processed item (id, outcome, key fields), then run
~4 lenses in parallel — each a distinct anomaly class (e.g. wrong owner / wrong label / wrong
disposition / missed duplicate) — reading the table + spot-checking live state. Pipe each raised
candidate through an independent verify agent (default to "not an outlier" unless the live evidence
is clear). Apply only the confirmed, convergent fixes yourself, from the main context. Run the cheap
deterministic invariant scan first — it catches the structural misses for free and shrinks what the
lenses must hunt.

## Pitfalls (learned the hard way)

- A worker's **self-report is not the side effect.** Verify real state, especially before scaling
  and in the outlier sweep — a "set to X" can silently revert under a later same-run write.
- **Stale global index → missed dedup.** Rebuild it for a delta pass; a dedup lens is only as good
  as the index it greps.
- **Don't reprocess re-keyed items.** When an action re-keys an item (e.g. a move renames its id),
  a key-based "already done?" check reports false new work. Diff by creation timestamp.
- **Batches that mix sensitive and trivial items are fine** — the pipeline judges each independently;
  don't hand-gate the batch.
- **Write the resume protocol as if you'll have amnesia**, because after compaction you will.
