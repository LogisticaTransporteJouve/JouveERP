# PR-readiness manifest (auto-ship-gate Phase A pre-flight)

Run ALL of A1–A6 once against the current PR head BEFORE entering the bot/CI loop. Re-run only the
affected item after a later push. **BLOCKING** = must clear, or the PR does not enter the bot/CI loop — attended, STOP and surface it
to the human; unattended, "surface" has no destination, so log it, mark the item
`FAILED: <item> — <reason>`, and keep working every track it does not block
(`_shared/night-shift/detect.md`). Either way the loop does not start. **ADVISORY** =
record + reply, do not block. Adversarially verify every finding with a ≥6-subagent `Explore` wave
(paste `.claude/skills/_shared/subagent-constraints/hard-constraints.md` + `.claude/skills/_shared/subagent-constraints/working-location.md` into each prompt) before
any fix. The only sanctioned writes **in A1–A6** are additive metadata (A4 Intent prepend, A1
`## Follow-ups` section); never merge, dismiss a review, mark the PR ready, or rename an open PR's
branch (that closes the PR).

⚠️ **JouveERP PRs stay DRAFT.** The repo rule is "PRs always draft" (`gh pr create --draft`); the
human marks a PR ready for review when they choose. An agent never runs `gh pr ready`. What that
means for checks: `CI` (lint / typecheck / test / build), `DB types drift` and
`migration-order-check` run on draft PRs, so they are the required signal. The `Claude Code Review`
workflow is gated on `draft == false` and is EXPECTED to show as skipped on a draft — that is not a
green, and it is not a failure; `/adv-review` is the in-session substitute. Report it as
`claude-review: skipped (draft) — runs when the human marks the PR ready`.

## A1 — Follow-ups are in the PR body   [BLOCKING, auto-remedy]
JouveERP does not require a Linear issue (no issue keys in branches or titles). Every finding
routed out of this change — a pre-existing defect a lens raised, deferred work, a post-deploy manual
step — must be written in the PR body under `## Follow-ups` (one bullet each: what, where
`file:line`, why it is out of this PR's scope). If the run produced follow-ups and the section is
missing or incomplete, APPEND it (additive, draft-safe). No follow-ups → the section may be omitted.
If the user did link an issue (GitHub or Linear) in the conversation, also add it under
`## Related`; never invent one, and never file one unless the user asked (`nav-linear` is optional).

## A2 — No overlapping open PR or issue   [ADVISORY]
ONE narrow `gh search prs --repo LogisticaTransporteJouve/JouveERP --state open "<terms>"` (and, only
if the user uses Linear and the MCP is connected, ONE `list_issues` pass) on terms derived from the
changed-file area + this PR's title. Judge the top few candidates; if one looks like the same work,
SURFACE it. Never block — this is heuristic and noisy.

## A3 — No conflicting open PR        [SPLIT: blocking for hard tiers, advisory for soft]
ONE call for every other open PR's file set:
```
gh pr list --repo LogisticaTransporteJouve/JouveERP --state open --limit 200 --json number,headRefName,baseRefName,files,isDraft
```
No `--base main` filter: a PR stacked on a feature branch is still an open PR that can carry a
colliding migration timestamp, and filtering by base drops it out of the blocking tier entirely.
Intersect each PR's file paths with this PR's (`gh pr diff <n> --name-only`). Only for a SHARED
file, deep-dive with `gh pr diff` and tier it:
- **BLOCKING:** both add a `supabase/migrations/*` file with the same or out-of-order timestamp
  (the `migration-order-check` workflow requires each new timestamp > the max on `main`), OR same
  function / overlapping hunks in one file, OR both regenerate `lib/db/database.types.ts`.
- **ADVISORY (merge-order note):** disjoint hunks in the same file, or one PR consumes a shared type the other changes.
Pagination is a false-NEGATIVE risk: without `--limit` gh stops at 30 PRs, and `files` is capped
~100/PR — for a wide PR, confirm migration collisions directly by listing `supabase/migrations/`
across open PRs.

## A4 — PR conventions                [BLOCKING, auto-remedy]
PR is a **draft** against `main`; body starts with `## Intent` (2–4 sentences, whole body <~25
lines plus `## Follow-ups`); title <70 chars, conventional in English (`fix:`/`feat:`/`chore:`…),
`[DESTRUCTIVE]` prefix for a destructive migration, `(N/X)` prefix for a stacked set. Commits are
conventional, English, with NO `Co-Authored-By` or other trailer/footer. Full rules are
single-sourced in the `nav-github` skill's conventions section — Read it, do not restate. Missing
Intent → draft it from the diff, run it through `tighten`, and PREPEND it preserving the rest of the
body (do it — additive, draft-safe). A PR that is not draft is SURFACED, not flipped back silently.

## A5 — Migration apply + DB quality  [BLOCKING, only if `supabase/migrations/` changed]
Static checks always: the new file is `YYYYMMDDHHMMSS_<scope>.sql` with a timestamp > the max on
`origin/main`; no merged migration was edited (`git diff --name-status origin/main...HEAD --
supabase/migrations/` shows only `A`); RLS is enabled with policies in the same migration as every
new table; `lib/db/database.types.ts` was regenerated in the same PR. Run the
`enforce-role-isolation` lens over every policy/grant/function the migration adds or changes
(`(select public.user_has_role(array[...]))` in USING and WITH CHECK, nothing to `anon`, `REVOKE ...
FROM PUBLIC, anon, authenticated` on new functions, `SECURITY DEFINER` with `SET search_path` and an
internal role check).
Dynamic checks ONLY if a local Supabase stack is ALREADY running (`supabase status` succeeds) —
never start one unprompted: confirm the migrations apply on a fresh local database
(`supabase db reset`, local only — never `--linked`/`--db-url`), `pnpm db:types:check` leaves no
diff, and `supabase test db` passes if `supabase/tests/` exists. No local stack → record
`db-dynamic: not run (no local stack)` and rely on the `DB types drift` + `migration-order-check`
CI jobs.
For a new index/FK/RLS/query, also Read the relevant reference file(s) under
`.agents/skills/supabase-postgres-best-practices/` (the index plus only the matched `references/*.md`), and apply any generic PG-perf finding — additive to the defect catalog.

## A6 — Runtime verification evidence  [ADVISORY]
Confirm the change was driven end to end before ship (the implementation ran the real flow — the app
locally with `pnpm dev`, and for job changes the event through the local Inngest dev server
`pnpm dev:inngest` — and recorded it, OR a Playwright spec in `tests/` exercises the flow — not just
unit tests). If neither is present, SURFACE it (tests-only is how deploy-time breakage slips
through); do NOT re-drive the flow from auto-ship-gate and do NOT hard-block — Phase B CI-green (plus the Vercel
preview deployment, when the integration posts one) is the deploy-time real-run proof.
