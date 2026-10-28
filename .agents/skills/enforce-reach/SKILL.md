---
name: enforce-reach
description: >-
  The reach lens: did the change reach every place that must learn it? For each behavioural delta
  it lists the peers outside the diff (writers, readers, entry points, exits, variants), other code
  answering the same question, what a replaced unit used to do, and what a deletion leaves behind;
  it also owns the one-fork rule for dual-representation identities. Use for "did I miss a call
  site", "who else reads this", "is every path covered", "sibling check", "consumer sweep", "does the
  AI CFO tool match the UI", "did the refactor drop anything", "is every channel/currency covered".
---

# Reach — the change reaches every place that must learn it

The lens body lives in ONE file: `.agents/skills/_shared/reach-lens/condensed-lens.md`. Read it
and apply it; there is no separate fat version.

- **Always on** in `/adv-review` (and the planning/build skills that paste lenses): the orchestrator
  pastes the fenced block of that file verbatim into EVERY seat's prompt, like the ports, dry,
  comment, perf and telemetry lenses. A "see enforce-reach" reference is inert — subagents inherit
  only their prompt.
- **Load-proof:** each seat emits the `reach-lens loaded:` line from that file in its header block;
  a missing or garbled line makes the wave NON-CLEAN.
- **Invoked directly** (`/enforce-reach` on a diff or branch): run the five laws over
  `git diff origin/main...HEAD`, fill the coverage table, fix every MISSING/LOST/dangling finding in
  this change, and list any downgraded item under the PR's `## Follow-ups`.
- **Ownership:** refactor debris belongs to `enforce-clean-code`; change-narration comments to
  `enforce-comment-value`; RLS/`userCan` correctness to `enforce-role-isolation` (this lens only
  checks that a permission change REACHES every gate).
