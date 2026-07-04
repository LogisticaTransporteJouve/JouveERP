# AUDIT REPORT — Inngest jobs layer (agent audit-inngest)

## SYSTEM MAP — job inventory

All 14 exported functions are registered in `app/api/inngest/route.ts:29-44` — registration is complete, no drift. Event payload contracts at all 3 `inngest.send` sites match `lib/inngest/events.ts` schemas exactly (chat `{message_id}`, invoices `{invoice_id, idempotency_key}`, ai-document `{extraction_id, file_id, declared_type}`). No sender/consumer drift.

| Function | Trigger | Writes | Idempotency status |
|---|---|---|---|
| issue-invoice | event `invoice/issue.requested` | invoices (status/numero/CAE), pdf hash | event `idempotency_key` + DB unique on key + status guard + unique numbering index. **No concurrency limit; crash-mid-CAE gap** |
| document-extraction | event `document/extraction.requested` | ai_document_extractions | event `extraction_id`; save is single write. Good |
| notifications-dispatch | event `notifications/dispatch` | none (push side-effects) | event `message_id`; per-recipient steps. Good |
| aging-weekly-summary | cron Mon 09:00 ART | none (email/log) | none needed; duplicate email possible on replay edge |
| ai-analyst | cron Mon 07:00 ART | ai_insights (delete+insert, 1 step) | self-healing on retry; non-transactional swap |
| bcra-exchange-rate | cron 11:00 ART Mon–Fri | exchange_rates | ON CONFLICT DO NOTHING. Good |
| caea-request | cron 09:00 ART days 11,26 | caea_codes | `ensureCaea` read-then-upsert + AFIP 15008 recovery. Good |
| caea-inform | cron 08:15 ART daily | invoices.caea_informed_at, caea_codes.no_movement_pvs | AFIP 702-704 already-informed codes as idempotency. Mostly good; no-movement loop is one fat step |
| document-expiry-alerts | cron 08:00 ART daily | notifications, employee_documents.notified_at | cooldown-based; insert/mark in separate steps (dup window) |
| fleet-document-expiry-alerts | cron 08:00 ART daily | notifications, fleet_documents.notified_at | same pattern as above |
| files-sweep-orphans | cron 03:00 ART daily | storage blobs, files rows | delete-by-id; re-run safe |
| search-index-refresh | cron every 1 min (no TZ, irrelevant) | search_index MV | dirty-flag RPC, row-lock serialized in DB. Good |
| ttl-cleanup | cron 03:15 ART daily | rate_limit_buckets, padron_cache | pure deletes. Good |
| vacation-balances-grant | cron Oct 1 00:00 ART | vacation_balances via RPC | RPC skips existing (employee, year). Good |

No function anywhere sets `concurrency`; no function uses `NonRetriableError` (grep for it returns zero hits in the repo).

## FINDINGS

**[high] [idempotency/error-handling] `lib/inngest/functions/issue-invoice.ts:437-471`** — Crash/timeout AFTER `requestCAE` reached AFIP but BEFORE the step result is memoized (serverless kill, OOM, deploy) → Inngest re-executes `request-cae` → AFIP rejects the re-request for an already-authorized number with a SERVICE error (10016-family), which is NOT `AfipTransportError`, so the `getVoucherInfo` recovery at :442-467 never runs → error thrown → retried 5× → `onFailure` marks the invoice `failed`. Result: AFIP has an authorized comprobante N; the DB shows numero N, no CAE, status `failed`. Re-issuing creates a new draft whose `reserve-numero` returns N+1 — the authorized N is permanently unaccounted in the ERP (fiscal divergence). The recovery comment at :36-38 describes intent, but the code only consults on transport errors within the same execution. VERDICT: PLAUSIBLE (needs a crash in a narrow window, but this is the exact window durable-execution exists for). Direction: run `getVoucherInfo` unconditionally at the top of `request-cae` (numero is already persisted by then), or also trigger recovery on the specific "already registered" service codes.

**[high] [error-handling] `lib/inngest/functions/issue-invoice.ts:469` (and errors hierarchy `lib/afip/errors.ts`)** — Comment claims `throw err; // service / soap-fault errors are deterministic, no retry`, but `AfipServiceError`/`AfipSoapFaultError` extend plain `Error`, and `NonRetriableError` is never imported anywhere in the repo. CONFIRMED — every thrown error retries. A deterministic AFIP validation failure re-calls `FECAESolicitar` 5 more times over ~hours before `onFailure` finally flips the invoice to `failed`. Direction: wrap SERVICE/SOAP_FAULT/CONFIG/INPUT errors in `NonRetriableError` at step boundaries.

**[medium] [concurrency/idempotency] `lib/inngest/functions/issue-invoice.ts:420-435` (fiscal CAE) and `:357-401` (CAEA)** — No `concurrency` config. Two users issuing on the same POS concurrently: both `reserve-numero` steps call `getLastAuthorizedNumber` → both get N+1. First wins; second's `persist-numero` UPDATE violates `invoices_unique_numbering` (migration `20260509160000`), but the reserved numero is **memoized** — every retry re-attempts the same doomed UPDATE 5× and the invoice dies as `failed`, requiring manual re-draft. The internal branch was already fixed for exactly this (B2 advisory-lock RPC, migration `20260517700000:377`) — the fiscal and CAEA branches were left with the same race. VERDICT: CONFIRMED. Direction: `concurrency: { key: punto_venta, limit: 1 }` or serialize-per-POS advisory lock.

**[medium] [error-handling/dead-letter] `lib/inngest/functions/issue-invoice.ts:184-206`** — `onFailure` writes `status: "failed"` but the supabase result is discarded — if that UPDATE fails, invoice stuck in `emitting` forever, no reconciliation cron for stale `emitting` rows, no in-app notification created on failure. CONFIRMED. Direction: check update error + insert notifications row; add sweeper for `emitting` older than N hours.

**[medium] [step-granularity/silent-failure] `lib/inngest/functions/caea-inform.ts:130-191`** — Entire no-movement sweep (N expired CAEAs × M POSs) in ONE `step.run`. Per-PV failures `continue`d (:173-180) and step returns success — a PV that permanently fails is silently never declared until `fch_tope_inf` passes, earning observación 15014. Only a `logger.warn`. VERDICT: CONFIRMED. Direction: one step per (caea, pv); alert when deadline near with undeclared PVs.

**[medium] [dead-letter] `lib/inngest/functions/caea-inform.ts:104-126`** — Non-transport AFIP rejections swallowed into `rejected[]` (logged warn only). Invoice keeps `caea_informed_at = null` → daily cron re-attempts forever — infinite daily retry of a deterministic rejection, no human notified before deadline. CONFIRMED. Direction: persist `caea_inform_error` on invoice + notify finance.

**[medium] [idempotency] `lib/inngest/functions/document-expiry-alerts.ts:86-118` + `fleet-document-expiry-alerts.ts:80-116`** — `insert-notifications` and `mark-notified` are separate steps, no dedup key on notifications. If run fails between them, next day's cron re-inserts full docs×recipients batch — duplicate alerts. CONFIRMED but low-probability. Direction: unique (recipient, document_id, day) key.

**[low] [non-determinism] `lib/inngest/functions/aging-weekly-summary.ts:161`** — `new Date().toISOString()` outside step feeds email step. Also `caea-request.ts:25-27` (todayInAR + quincena math outside steps — retry spanning quincena boundary shifts period; near-impossible) and `vacation-balances-grant.ts:27`. Cosmetic. Direction: compute inside a step or from `event.ts`.

**[low] [error-handling] `features/chat/actions/messages.ts:206-209`** — `} catch { // Silent log: ... }` — comment promises a log; there is none. Misconfigured Inngest key in prod → chat pushes silently vanish. CONFIRMED. Direction: add logger.warn.

**[low] [unbounded-work] `lib/inngest/functions/caea-inform.ts:29,62`** — PENDING_LIMIT=200, no pagination: backlog >200/day drains at 200/day against ~8-day deadline. Also document-expiry-alerts loads whole view unbounded. Acceptable at this data size.

**[low] [cron-overlap] `search-index-refresh.ts:17`** — 1-min cron, no concurrency limit. Disproved as correctness bug: `refresh_search_index_if_dirty` (migration `20260517810000:207-227`) row-locks in one transaction; overlapping runs serialize in Postgres. Residual: connection pile-up only if MV refresh exceeds ~1 min.

**[timezone — audited, clean]** Every business cron uses TZ=America/Argentina/Buenos_Aires (all 11 cron triggers). UTC-date computations inside them execute 07:00–11:00 ART = 10:00–14:00 UTC where UTC date == AR date, so no wrong-day window. `todayInAR` (lib/format.ts:150-152) correct fixed −3h (no DST in AR). Vacation-grant 00:00 ART = 03:00 UTC uses UTC getFullYear — same year, fine.

**[env/security — mostly clean]** No NEXT_PUBLIC Inngest vars; keys in .env.production.example:32-33. `inngest.send` only from "use server" actions gated by requireUserContext+userCan (all 3 sites) — no client event injection. Note: `lib/inngest/client.ts:17` `isDev: NODE_ENV !== "production"` disables signature verification on /api/inngest in any non-prod deployment — staging box via `next dev` exposes unauthenticated function-invocation endpoint. Low.

## DESIGN TENSIONS
1. **Memoized reservation vs. self-healing.** Freezing `reserve-numero` in a step enables CAE recovery (must retry SAME number) but makes the concurrent-reservation race unrecoverable. B2 advisory-lock RPC is the template, applied to only 1 of 3 numbering paths.
2. **"Deterministic errors don't retry" asserted in comments, enforced nowhere.** AFIP error taxonomy (TRANSPORT vs SERVICE) built to drive retry policy, never wired into Inngest retry semantics.
3. **Crons as alerting substitute.** Failures degrade to logger.warn; the product's own notifications table is never used to report job failures to deadline owners (CAEA 15014, invoice emission).

## EXPECTATION GAPS
- Expiry notifications (HR + fleet) are in-app only; push exists but only chat sends the dispatch event.
- issue-invoice onFailure flips status but tells no one.
- issue-invoice event idempotency is 24h (Inngest window); beyond that the status guard at issue-invoice.ts:223-227 is the real defense — holds, but comment implies event-level dedup is the mechanism.
- caea-inform reuses buildAfipInput with synthetic DraftLoad `origenes: []` (caea-inform.ts:82) — NC/ND under CAEA informed WITHOUT CbtesAsoc; AFIP may reject. Verify vs WSFEv1 CAEA spec.

## OPEN QUESTIONS
1. Which AFIP error code does FECAESolicitar return for an already-authorized cbteNro — determines exact guard for crash-recovery fix.
2. Does Inngest onFailure fire on step-exhausted failure of request-cae before later steps run, or only after full function failure?
3. Any operational alerting on Inngest Cloud configured outside the repo? If yes, several dead-letter findings drop a severity level.
