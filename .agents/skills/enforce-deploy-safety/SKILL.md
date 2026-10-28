---
name: enforce-deploy-safety
description: >-
  The deploy-safety lens for JouveERP: does the change survive the running system? Checks
  migrations against existing production data and a fresh apply, Inngest changes against runs
  already in flight (step ids, event names and payload schemas, function ids), every contract that
  crosses the deploy boundary against old and new code live at once (Vercel ships `main` before the
  approved migration job runs), env vars and secrets set out of band, and CI workflow and tooling
  changes against when and where they run. Use for "is this migration safe", "what about runs in
  flight", "version skew", "deploy window", "env var or secret added", "will CI run this", and as
  an adv-review seat. CONDITIONAL: a no-op on a diff with no migration, Inngest, cross-deploy
  contract, env var, or CI/tooling surface.
---

# Enforce Deploy Safety: every state the deploy passes through works

**Delivery.** A conditional lens with no condensed copy. adv-review's routing table names this
file, and the review seat that owns it Reads this SKILL.md itself. It fires on a diff that touches
`supabase/migrations/`, `lib/inngest/` or `app/api/inngest/route.ts`, a DB object or RPC signature
the app calls, an env var or secret, `.github/workflows/`, `.github/scripts/`, `scripts/`,
`package.json`, or ESLint config. Otherwise the seat emits exactly:
`deploy-safety: N/A — no migration, Inngest, cross-deploy contract, env or CI surface in diff.`

**The law: every state the deploy passes through works: old and new code on old and new schema,
Inngest runs started on the old build finishing on the new one, and config present before the code
that reads it.**

## House facts the diff doesn't show

- **Code ships first, the schema waits.** Vercel's Git integration deploys `main` as soon as it
  lands (`vercel.json` only disables `claude/*` branches). Migrations deploy in
  `.github/workflows/ci.yml` through `approve` (environment `production-gate`, required reviewers)
  then `deploy-migrations` (`Push migrations to production`, `supabase db push --include-all`).
  Between merge and approval, which can be hours, **new code runs against the old schema**. A
  Vercel instant rollback runs **old code against the new schema**.
- **The house tolerance pattern** for that window: a read of a table the pending migration
  creates treats `42P01` / `PGRST205` as "not there yet", returns the safe empty answer and warns
  once per instance (`lib/auth/denies.ts`); a call to an RPC whose new signature is pending
  catches `PGRST202` and retries the old signature, narrowing in TS
  (`features/search/actions/search-actions.ts`). Each tolerance branch names its death condition
  (the migration is in production) and is listed under the PR's `## Follow-ups`. Postgres codes the
  app checks live in `lib/db/pg-error-codes.ts`.
- **CI applies migrations only fresh.** The `database` job starts a local stack from every file in
  `supabase/migrations/`, so it proves a fresh apply and never sees production data. It also
  checks new migration names/timestamps and that merged migrations are append-only. With this PR
  `scripts/check-migrations.sh` and squawk (`.squawk.toml`) add lock-risk and header checks on
  added files; squawk cannot see DDL generated inside a `DO` block.
- **Inngest memoizes completed steps by id.** A run in flight replays the function on the new
  build: completed `step.run` results are looked up by step id, everything outside a step re-runs.
  Functions are registered only in `app/api/inngest/route.ts` (`maxDuration = 300`, the outer
  budget for any single step's request); event names and Zod payload schemas live in
  `lib/inngest/events.ts`; the client id is `jouve-erp` (`lib/inngest/client.ts`).
- **Out-of-band config.** Env vars are documented in `.env.local.example` and set by hand in the
  Vercel project (Production and Preview separately). CI secrets live in GitHub environments
  (`production`, `production-gate`, `vercel-preview`) and repo secrets (`FORBIDDEN_WORDS`,
  `backup-daily.yml`'s). Nothing in the repo proves a value is set.

## 1. Migrations: existing data and a fresh apply

1. **Existing data.** For a new UNIQUE, CHECK or NOT NULL constraint, a narrowed
   `check (x in (...))` list (house style for persisted categories), an FK, a type change, or a
   predicate on a newly added column: count the violating rows, NULLs and distinct values, read-only
   on production. The owner runs the count; agents never `supabase link` or `db push`. Reconcile a
   non-zero count inside the migration, or add the constraint `NOT VALID` and validate it in a later
   migration once the data is clean. A `NOT VALID` constraint must also be satisfied by the app's
   own UPDATE paths.
2. **Fresh apply.** Every function, table, type or overload the file references or replaces exists
   in an earlier-timestamped file, and you replace its **latest** definition (`grep -l "function
   public.<name>(" supabase/migrations/ | tail -1`). `create or replace` with a different argument
   list adds an overload rather than replacing one; two overloads callable with the same named
   arguments are ambiguous to PostgREST. A changed return type needs `drop function` then
   `create`, and the drop discards its grants and comment: re-issue the REVOKE/GRANT pair.
3. **Locks and timeouts.**
   - New migrations open with `SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15min';`
     and never `set row_security` (older files' `set row_security = off` is not a precedent).
   - Size timeouts to the real table; a large backfill runs in separately committed chunks rather
     than one statement holding locks on a table the app writes.
   - An index on a large live table is built `CONCURRENTLY` (which cannot run inside the
     migration's transaction: give it its own migration file and say so in the PR body).
   - `ALTER TABLE` on a hot table (`invoices`, `journal_entries`, `transactions`) takes an
     ACCESS EXCLUSIVE lock: keep it to metadata-only changes, or justify the rewrite.
4. **Renamed or removed objects** break the code already on Vercel the moment the migration
   applies, and break a rollback. Expand first (add the new column, view or RPC alongside), ship
   code that uses it, contract in a later PR. A renamed persisted value (`status`, `kind`) ships its
   data migration and keeps old readers working through the window.

## 2. Inngest: runs already in flight

**Trigger:** any change under `lib/inngest/` or to an event a server action sends.

Classify each change:
- **(A) Changes what an in-flight run memoized.** Renaming a `step.run` id, or inserting or
  reordering a step with the same id as another (repeated ids are memoized by occurrence),
  re-executes that step for every run already past it. For a step with an external side effect
  (AFIP `FECAESolicitar`, an email, a push, a storage write) that is a duplicate effect: a CAE is
  an irreversible external create. Keep the id, or prove no run is in flight, or make the step
  idempotent the way `issue-invoice` is (it records `afip_attempted_numero` before calling AFIP so
  a re-run adopts the existing CAE through `FECompConsultar`).
- **(B) Changes an event contract.** A renamed event name stops triggering on events already
  queued under the old one; a renamed function `id` is a new function and the old one's queued and
  in-flight runs are dropped at the next sync. A changed payload schema meets events queued by the
  old code: new fields are optional until every queued event carries them, as
  `InvoiceIssueRequestedSchema` keeps `channel_id` and `punto_venta` optional "for events queued
  before these fields existed" (`lib/inngest/events.ts`). A `concurrency` or `idempotency` key that
  reads a new field evaluates to empty for old events.
- **(C) Changes only code inside a step, retries, or timeouts.** Not a replay break. Ask what an
  already-retrying step does with its old input on the new code, and whether a step still fits
  inside `maxDuration`.

Also check:
- Code outside `step.run` re-runs on every replay: no side effect, no clock read or random value
  that must stay stable, no DB write there.
- A new function is added to the `functions` array in `app/api/inngest/route.ts`; a removed one
  is removed there and its queued events are accounted for.
- A cron schedule change takes effect at the next sync; say in the PR body whether a run is
  skipped or doubled at the cutover.

## 3. Two versions live

**Trigger:** any contract that crosses the deploy boundary: a DB column, view, RPC signature,
CHECK list or RLS policy the app reads; an Inngest event payload; an API route response; an env
var or secret.

1. **Fill the skew matrix**: {old code, new code} × {old schema, new schema}. Every cell works, or
   an *enforced* ordering, not a documented one, makes the cell impossible. The cell that always
   exists in Jouve is new code × old schema (merge before approval); old code × new schema exists
   on every rollback.
2. **A missing new field means unknown.** Its default is on the safe side and never unlocks a
   write, an emission or a widened read.
3. **A deploy-window fallback triggers on the error shape that actually occurs**: a missing table
   (`42P01`/`PGRST205`) is not a missing function (`PGRST202`) or a missing column (`42703`).
   Every sibling caller of the same table or RPC carries the same fallback, and the fallback fails
   closed on any other error.
4. **Out-of-band inventory.** For each new or renamed env var or secret: it is in
   `.env.local.example` with a comment, the PR body says which Vercel environments and GitHub
   environments need it, and the code behaves safely when it is absent (the `SENTRY_DSN` pattern:
   no value, no-op) or fails loudly at the point of use, never silently with a wrong default.
5. **Companion work.** If correctness depends on a backfill, a manually set secret, or a companion
   PR, the PR body says so and the change gates on it being in production.

## 4. CI and tooling: when and where it runs

For every changed CI or tooling file, answer each question in writing, then check it against the
config.
1. **Trigger.** Read `on:`, `paths:`, `branches:` and job `if:`.
   - `.github/workflows/ci.yml` runs on PRs to `main` and pushes to `main`; its `database` job does
     real work only when the `relevant` regex in "Detect relevant changes" matches, so a new file
     the DB checks must cover is added to that regex.
   - `.github/workflows/preview.yml` deploys only non-draft `claude/*` PRs from this repo. Jouve PRs
     stay draft, so it does not run on them until the human marks one ready.
   - `.github/workflows/forbidden-words.yml` runs on pushes to every branch but `main`.
   - `.github/workflows/backup-daily.yml` runs on a cron (03:00 UTC) and `workflow_dispatch`, never
     on a PR: a change to it is untested until it fires.
   - Every `steps.X.outputs.Y` a step reads is set by a step `X` in the same job.
2. **Shell.**
   - Under `set -euo pipefail`, a `grep` that matches nothing (including on empty input) exits the
     step.
   - `**` without `shopt -s globstar` matches one level only.
   - Hook scripts (`scripts/hooks/`) and `scripts/setup/doctor.sh` run on developer machines and
     may meet macOS's bash 3.2.
   - Untrusted `${{ github.* }}` values reach `run:` only through `env:`
     (`.github/scripts/check-run-script-input.py`).
3. **Authority.** Check every API call against `permissions:`, every secret against the
   `environment:` the job enters, and keep production jobs behind approval
   (`.github/scripts/check-production-jobs-gated.py`) and checkouts at `persist-credentials: false`
   (`.github/scripts/check-checkout-persist-credentials.py`).
4. **Merge rules.** Read the tool's merge rule, not the intent:
   - ESLint flat config (`eslint.config.mjs`, `eslint.fences.mjs`): a later block's rule options
     replace an earlier block's for the same rule; they do not merge.
   - `package.json`: a dependency with a postinstall needs `pnpm.onlyBuiltDependencies`; check
     `engines`, `packageManager` and `pnpm.overrides`.
   - `scripts/supabase-cli-version` pins the CLI for every job that installs it.

## Coverage table (proof of work)

```
surface | trigger | check run (query, grep, skew-matrix cell, replay class) | result
```

## Verify before raising

- **A deploy-window hazard** names the population actually exposed: a request path the new code
  serves before approval, runs in flight or events queued, rows in production.
- **A migration that only adds** a nullable column, a new table, or a new function that no old code
  calls has no old-code cell to break; don't raise skew on it.
