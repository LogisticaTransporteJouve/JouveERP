---
name: td-review
description: >-
  Review a JouveERP PR or branch with adv-review (its lens seats, premise gate and tiers) and hand
  the user a review page: the verdict, what the PR does as a today/after diagram, findings by tier
  with where and the smallest fix, and what was verified clean. On the user's own branch it fixes
  what survives (conventional one-line commits, no push); on someone else's PR it is read-only and
  prepares a native GitHub review (inline comments on each finding's line, one-click suggestions, a
  short summary) for the user to post. Use for "/td-review", "/td-review 482", "revisá este PR con
  página", "review page", "prepare a GitHub review for this PR". A review with no page is /adv-review.
argument-hint: "[PR number] [verdict]"
---

# td-review

## 0. Pick the path

- **Fix (default on the user's own branch, no argument):** review the current branch and fix what
  survives. This is adv-review's PATH A.
- **Verdict only:** a PR number by someone else, or the user says "verdict", "solo veredicto", "is
  this safe to merge". Read-only end to end: no edits, commits, pushes, comments, issue or Linear
  writes. This is adv-review's PATH B.

Find the PR: the number given, or the current branch's PR (`gh pr view --json number,url`, or the
GitHub MCP's `list_pull_requests` / `pull_request_read` where `gh` is not signed in). A linked
issue comes from the PR body's `## Related` (GitHub issue), or Linear only when one is named and the
MCP is connected (read-only).

## 1. Review

Follow `.agents/skills/adv-review/SKILL.md` exactly: its mode check, scope (fetch `origin/main`; a PR
you're not on goes in a detached worktree in the scratchpad), the pre-pass (ticket, scope, in-flight
PRs, readiness, evidence, one-way doors), lens routing from its Step 3 table, read-only `Explore`
seats with the output contract, the premise gate, then Step 6a (fix) or Step 6b (verdict). The lenses
are the ones that table routes: always `enforce-ports-and-adapters`, `enforce-clean-code`,
`enforce-comment-value`, `enforce-reach`, the perf and telemetry lenses in `_shared/`,
`enforce-outcomes`, `enforce-effects` and `enforce-claims`; by surface `enforce-role-isolation`,
`enforce-data-integrity`, `enforce-deploy-safety` and `enforce-ui-state`. A migration or query
change goes through its EXPLAIN gate (`not run` without an already-running local stack).

On the fix path:
- Fixes follow 6a (smallest change, a test when one can pin it, red first). Keep adv-review's
  convergence rule: ≥3 consecutive clean waves (no surviving blocking or should-fix finding), each a
  full seat set over the whole diff, then one more, under its wave ceiling. Report the clean-wave
  count after each wave and never call the review done before the floor.
- Commit once per wave with green checks: one conventional English line, `fix(scope): what it
  fixes`, plus a `(KEY)` suffix only when a Linear key exists; no body, no `Co-Authored-By` or other
  trailer, no mention of Claude.
  Never push; never reply to or resolve a human's thread.
- A one-way-door question goes to the user, never into a fix.

## 2. Build the review page

Same visual language and theme as `.agents/skills/td-explain/SKILL.md`: start from
`.agents/skills/td-explain/reference/shell/head.html` (light + dark tokens and the
`box`/`ar`/`list`/`matrix` SVG helpers), without its walk markup. In this order:

1. **Verdict banner:** MERGE / MERGE WITH FOLLOW-UPS / DO NOT MERGE (verdict path), or "Revisado y
   corregido" / "Reviewed and fixed" with waves run (fix path). Chips: blocking / should-fix / nit
   counts, PR link, head SHA.
2. **What the PR does:** two sentences and a today / after diagram of the mechanism it changes
   (removed paths dashed, new ones in the accent). This is where the reader learns the PR.
   On the verdict path (someone else's PR) the user hasn't seen this code, so put a **Context**
   block first: what the linked issue asks and who asked and why, how the feature behaves today for
   a user (one concrete case, in the app's Spanish UI words), the author's stated deviations and
   `## Follow-ups` from the PR body, and a file-by-file map of the diff (one line per file: its role
   in the change). Enough to follow the findings cold.
3. **Findings, by tier:** one card each: tier, confirmed or suspected, `file:line`, the trigger,
   expected vs actual in one line each, the smallest fix. When a finding is about a flow (a race, a
   lost write, a wrong IVA or balance total), draw it: a small sequence or the equation with the
   wrong term marked. On the fix path, each card says "fixed in <sha>" or why it wasn't.
4. **One-way doors**, one line each. Question-tier findings are dropped: they go on neither the
   page nor the GitHub review. A finding worth raising is tiered blocking, should-fix or nit.
5. **Verified clean:** the risky areas checked and found sound, one line each.
6. **Lenses run:** which seats ran and what each searched, folded.
7. **GitHub review** (verdict path only): how the prepared review (§2b) looks, and the command
   that posts it, in a copy box.

Follows the system theme (td-explain §Theme). ES/EN toggle. One headless screenshot per theme
(td-explain §6), fix overlaps once, publish with the Artifact tool.

**Both languages complete.** Every visible string goes through the language switch, diagram labels and
sublabels included; only code identifiers, paths and SHAs stay as they are. Before publishing, render
the page with the language forced to EN, strip `<script>` and `<style>`, and grep the visible text for
Spanish (accents, `¿¡`, common words like `de la con sin para que tarea`). Do the same for ES with
English. A hit is fixed before publishing, not after.

## 2b. Prepare the GitHub review (verdict path)

The verdict reaches the PR as a native GitHub review, not a pasted text block. Write it to
`<scratchpad>/review-<pr>.json` for
`POST /repos/LogisticaTransporteJouve/JouveERP/pulls/<pr>/reviews`:

- `commit_id`: the reviewed head SHA (an inline comment on a stale head lands in the wrong place).
- `event`: `REQUEST_CHANGES` for DO NOT MERGE, `COMMENT` otherwise; `APPROVE` when the user says so
  (they post it, so approval stays their call).
- A migration older than `main`'s newest (CI's "New migrations (name, version, …)" step: "must
  have a version after the latest one") is fixed with `pnpm db:restamp` (`/restamp-migrations`) and
  is never blocking: the author restamps before merging anyway. It goes as a plain comment on the migration and doesn't change the verdict.
- Language: Spanish (Argentina), like the PR template, unless the PR is written in English.
- `body`: the summary, short: the verdict and its reason in one line; open one-way doors
  and findings outside the diff (one line each, they have no single line to anchor to). No link to
  the review page. Plain words; `/tighten` it.
- `comments[]`: one per finding that has a line, on the line in the head (`path`, `line`, `side:
  "RIGHT"`, plus `start_line` for a range). Few comments, each one clear: three to four
  sentences in prose. Say what the code does today, then one concrete case of what goes wrong for
  a user, then why it matters, then `Fix:` in a line or two. Noise comes from the number of
  comments, not their length, so explain enough that the author doesn't need the review page. Prefix `Nit:` on nits;
  no other tier labels. A suspected finding says so in a few words. Add a ```` ```suggestion ````
  block when the fix is a change to those lines. Leave out mechanism the author can read in their
  own code, lists of consequences, verification steps and anything the PR body covers. The summary
  is the verdict line plus those lines; no questions, no tier counts, no "verified clean" paragraph.

  A line outside the diff can't take a comment: put that finding in the summary instead.
- Nits and one-way-door naming points stay on the review page only; the GitHub review carries
  blocking and should-fix findings and nothing else. Nits stay within adv-review's cap. Drop a
  finding the review page marks pre-existing unless it changes the verdict.

Check the payload: every `line` exists in the PR diff at `commit_id` (`gh pr diff <pr>`).
Never post it yourself. Hand the user the command, and post only when they say so:
`gh api repos/LogisticaTransporteJouve/JouveERP/pulls/<pr>/reviews --input <scratchpad>/review-<pr>.json`.
Where `gh` is not signed in, the same review goes through the GitHub MCP: `pull_request_review_write`
(`create`, pending) → `add_comment_to_pending_review` per comment → `pull_request_review_write`
(`submit_pending`) with the body and event, again only when the user says so.

## 3. Hand off

Reply in the user's language: the page link, the verdict in one line, the blocking findings in one
line each, and the commits made (fix path). On the verdict path, also show the review summary and
each inline comment's `file:line`, plus the command that posts it.
