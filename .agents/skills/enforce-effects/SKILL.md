---
name: enforce-effects
description: >-
  The effects lens: is every irreversible or visible effect guarded where it happens, isolated,
  bounded, atomic and safe to replay? For each write, delete, AFIP request (CAE, CAEA, inform),
  Inngest event send, email, notification, storage write and status stamp it traces the guard
  (where, when, which way it fails, what it really tests), the write order (what a kill between
  writes leaves), what an Inngest retry, a cron re-run, a double submit or a concurrent actor does,
  and whether loops and budgets terminate and isolate failure. Use for "is this idempotent", "can
  this race", "what if it dies halfway", "can we issue the CAE twice", "does the guard fail open",
  "can one bad item sink the batch", "timeout vs retry budget", and as an adv-review seat.
---

# Effects — every effect is guarded, atomic, replay-safe and bounded

**The law: an effect happens only after a guard that holds where the effect runs. A crash, retry or
concurrent actor at any point leaves state that is correct, or that converges on re-run.**

**Delivery.** This lens is Read-delivered, not pasted: `/adv-review`'s routing table names this
file, and the seat assigned to it Reads this `SKILL.md` in full and emits the coverage table below.
Invoked directly (`/enforce-effects`), run it over `git diff origin/main...HEAD`, fix every finding
in this change, and list any downgraded item under the PR's `## Follow-ups`.

**Ownership.** Whether the guard is the *right permission* is `enforce-role-isolation`'s; lock
duration and deploy order of a migration are `enforce-deploy-safety`'s; constraint design is
`enforce-data-integrity`'s; query cost inside a loop is the perf lens's. This lens owns ordering,
atomicity, replay and isolation of the effect itself.

## 1. Enumerate the effects

Effects: inserts, updates, deletes, RPC calls that write, AFIP calls that create state
(`FECAESolicitar`, CAEA request and inform), `inngest.send` / `step.sendEvent`, emails
(`lib/email/`), notifications and push (`lib/push.ts`), storage uploads and deletes, `logAudit`
rows, status stamps and markers (`status`, `emitted_at`, `notified_at`, `afip_attempted_numero`),
cache invalidation, shell `rm` in `scripts/`. For each, find:
- its guards: `if`/`throw`, Zod parse, `userCan`, `disabled`, RLS, trigger, check constraint,
  unique index, `WHERE`;
- the loop or batch around it;
- the retry boundary around it:
  - **Inngest** runs a step until it succeeds or exhausts the function's `retries` (house functions
    set it explicitly: `retries: RETRYABLE_LIMIT` = 5 in `lib/inngest/functions/issue-invoice.ts`,
    `retries: 2` in `lib/inngest/functions/document-expiry-alerts.ts`); `onFailure` runs once after the last attempt.
  - **Events are at-least-once.** A duplicate send starts a second run unless the function declares
    `idempotency` (issue-invoice keys on `event.data.idempotency_key`).
  - **Crons re-run** on their schedule regardless of what the last run left (and can be replayed
    from the Inngest dashboard).
  - **Users resubmit** a server action after a timeout or a double click; a resubmit is a new call
    with new server-generated ids.
  - **Scripts get re-run** (`scripts/*.mjs` seeds, imports, backups).

**Inngest replay model (decides most findings).** The function body re-executes from the top on
every step boundary; each completed `step.run(id, ...)` is memoized **by its id** and returns its
stored JSON. So:
- an effect **outside** any `step.run` repeats on every invocation of the run;
- a step that throws re-runs **from scratch** with no memoized partial; an effect inside it before
  the throw happens again;
- renaming, reordering or conditionally skipping a step id re-executes it for runs that are in
  flight across the deploy;
- a per-item step in a loop carries the item in its id (`mark-informed-${inv.id}` in
  `lib/inngest/functions/caea-inform.ts`), so one item's memo cannot answer for another.

## 2. Each guard: where, when, which way, what it really tests

1. **Where.** The guard is enforced on the path that performs the effect: server action, route
   handler, RPC, Inngest step or database. A client-only gate (`disabled` button, hidden menu) is a
   finding when the action is callable directly, and every `"use server"` export is.
2. **When.** It runs before the *first* irreversible step. Trace the real call: an action that
   inserts a draft, then validates; a step that sends the event, then checks status; copy-then-delete.
3. **Failure direction.** Check what it returns on an error, `null`, `undefined`, a pending state, a
   new enum member or role, or SQL NULL. Destructive, fiscal and security effects must deny.
   Deliberate fail-open is stated in the code (the CAEA branch's `getLastAuthorizedNumber` catch in
   `lib/inngest/functions/issue-invoice.ts` is one: AFIP down is the scenario CAEA exists for).
4. **Stand-in.** State the real condition in one sentence, then name an input where the code's test
   and the real condition disagree. Common stand-ins:
   - presence instead of value;
   - latest instead of this run's id;
   - recency instead of completion (`notified_at` within the cooldown vs "this alert was delivered");
   - a flag instead of the structure;
   - non-null instead of past the cutoff;
   - a parameter passed but never branched on;
   - a name instead of an id;
   - get-or-create instead of get.

## 3. Write-set and replay

1. **List the writes in order**, `w1 … wn`, including markers, cursors and `audit_events` rows.
2. **Kill between writes.** For each gap, ask what a crash there leaves. supabase-js has **no
   client-side transactions**: two `.insert`/`.update` calls are two commits, and a compensating
   `.delete()` in a `catch` is not a rollback (the process can die before it runs). Atomic
   multi-table writes go through one plpgsql RPC, as the money paths do (`create_receipt`,
   `create_payment_order`, `create_journal_entry`, `create_transfer`,
   `next_internal_invoice_numero_atomic`, `emit_caea_invoice`). Otherwise reorder so data is stale
   but present: insert new rows before deleting old ones.
3. **Replay after partial success.** Each write is idempotent: an upsert on a natural key
   (`onConflict: "currency,rate_date", ignoreDuplicates: true` in
   `lib/inngest/functions/bcra-exchange-rate.ts`), a unique constraint (`invoices.idempotency_key`),
   or an existence check that tells "complete" from "orphaned partial". The idempotency key is
   generated once, before the first effect, and travels with the event; a key regenerated per call
   only dedupes the event, not the user's resubmit.
4. **Markers go last and come from the source of truth.** A done-flag, cursor, watermark, status
   stamp or audit row is written after the work it certifies, derived from the source (not this
   attempt's counter). `logAudit` runs after the operation with its real outcome. A marker that must
   survive a throw is written before the step that throws, and in its own step (issue-invoice
   records `afip_attempted_numero` **before** calling AFIP, then flips to `emitted` in a later
   `persist-cae` step).
5. **Read, decide, write.** Re-assert the decision inside the write:
   - `.eq("status", expected)` / `.in("status", [...])` on the update (issue-invoice's `onFailure`
     only fails rows still `draft`/`emitting`), plus `.select("id")` when the caller must know
     whether a row was affected;
   - an upsert with `ignoreDuplicates` or SQL `ON CONFLICT DO NOTHING RETURNING`;
   - `SELECT … FOR UPDATE` inside the RPC;
   - the existing `pg_advisory_xact_lock` key, taken by every writer of that resource (including
     migrations and backfills), in sorted-id order for multi-entity loops;
   - Inngest `concurrency` keyed on the contended resource (issue-invoice: `limit: 1` per
     `event.data.punto_venta`, because AFIP numbers per CUIT + punto de venta + tipo).

   A JSONB settings write is a single-key `jsonb_set` or a merge RPC, never a whole-object spread.
   If the decision sits outside the write, name the concurrent actor: a second tab, a cron, another
   run on the same punto de venta, a retry of the same step.
6. **One figure, one snapshot.** A figure built from more than one read (a saldo plus its
   movements, a libro IVA total plus its lines) comes from one statement or one RPC.
7. **Re-run selection.** A reconcile, inform or resume query excludes items by *current* status,
   across every terminal and running state (`failed`, `emitted`, `emitting`, informed).
8. **Retryability.** Classify each failure the diff throws or maps at its source. In Inngest every
   thrown error is retried until `retries` runs out **unless** it is a `NonRetriableError`; the
   `code` on an `AfipError` means nothing to Inngest. The house classification
   (`lib/afip/errors.ts`): **only `TRANSPORT` is retryable**; `CONFIG`, `INPUT`, `SOAP_FAULT` and
   `SERVICE` are deterministic, so the CAE step rethrows them as `NonRetriableError`
   (`lib/inngest/functions/issue-invoice-cae.ts`) instead of resending a rejected payload and holding
   the comprobante in `emitting` for the whole retry schedule. A new throw site that raises a
   deterministic `AfipError` (or any validation or business rejection) without that wrap is
   retried 5 times for nothing. A `catch` that flips the class either way is a finding. A 429 or a
   `Retry-After` maps to Inngest's `RetryAfterError`, not a bare throw.
9. **Unknown outcomes.** A timeout, a lost response or a 5xx after the request left means the
   outcome is unknown, not failed. **AFIP CAE issuance is the canonical irreversible external
   create**: a CAE cannot be withdrawn, only offset with an NC. So after a `TRANSPORT` error, the
   code **consults before retrying**: `reserveNumberAndRequestCae` asks AFIP for the attempted
   number (`getVoucherInfo` → FECompConsultar) and adopts the CAE only if the registered voucher
   matches this invoice (total, date, receptor) and no other live invoice holds that number; only
   then does it rethrow for Inngest to retry. The read of the last authorized number and the
   `FECAESolicitar` share **one** step, so no other emission on the same punto de venta can land
   between them. Any new AFIP write (CAEA inform, a new voucher type, an annulment flow) states its
   consult-before-retry path, or why AFIP's own duplicate rejection makes the replay safe
   (`lib/inngest/functions/caea-inform.ts` treats "already informed" codes as success). Never show an unknown outcome as
   "failed" to the user.
10. **Client side.** Every `Promise.race` or timer cancels the loser; a mutation's `onSuccess`
    invalidates only after the server confirmed.

## 4. Loops, batches and budgets

1. **Isolation.** If item k throws, check what happens to items k+1…n and to results already
   obtained. A bare `Promise.all`, one outer `try`, or one `step.run` wrapping the whole loop is a
   finding unless all-or-nothing is intended and atomic. Per-item work in an Inngest function gets
   a per-item step id (see §1), and a per-item rejection is recorded and logged, not thrown for the
   whole batch (`lib/inngest/functions/caea-inform.ts` returns `{ informed: false }` for a deterministic rejection).
2. **Termination.** A no-progress iteration exits, keyed on the outstanding set, not a success
   counter (`paginateRange` stops on an empty page and on `MAX_DRAIN_ROWS`). Permanently failing
   items must not starve the rest.
3. **Budgets.** For every timeout or retry constant touched, write the arithmetic: `attempts ×
   per-attempt timeout + backoff + sequential sub-steps ≤ the outer budget`. The outer budget of
   one step invocation is the Vercel function limit on the Inngest route
   (`export const maxDuration = 300` in `app/api/inngest/route.ts`); a step that calls AFIP, an AI
   provider or a long loop must finish inside it. A server action has its own platform limit. Grep
   the other constants awaited under the same outer budget. Retries live in exactly one layer:
   an in-step retry loop around an AFIP call multiplies with Inngest's `retries`.
4. **Per-item to batch.** When per-item processing becomes batched, timeouts and parse failures stay
   scoped to the item.

## Coverage table (proof of work)

```
effect | guard: where / when / fails-to / real condition | write order + kill points | replay-safe? (retry, re-run, resubmit) | concurrent actor | loop isolation + exit | status
```

A seat that returns no table has not run this lens.

## Verify before raising

- **A race or stale-write claim** quotes the line, in the producer or the consumer, that lacks the
  guard, and names the concurrent actor.
- **A replay claim** names which replay (step retry, duplicate event, cron re-run, user resubmit)
  and shows the memo or key that does not cover it. A step whose effect Inngest has memoized is not
  re-executed on a later step's retry.
- **Pre-existing non-atomic writes** the diff does not touch are a follow-up, not a blocker; the
  same shape *added* by the diff is a finding.
