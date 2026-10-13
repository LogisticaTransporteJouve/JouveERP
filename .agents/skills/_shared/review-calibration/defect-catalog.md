# Review defect catalog — shared calibration

The single shared calibration data file for this repo's PR reviews. Both `adv-review`
(both its converge-and-fix and verdict-only paths) Reads this file
BEFORE their first pass, so every reviewer looks hardest where this repo actually breaks. This
is a KNOWLEDGE file, not a workflow — it lists calibrated defect classes, their real frequency,
where to look, and the confirmed fix. It does not tell you how to run a review.

Ports-and-adapters violations are NOT catalogued here — that lens has its own full guide. Load
`.claude/skills/enforce-ports-and-adapters/SKILL.md`: adapter-specific logic lives ONLY inside
its adapter behind the shared contract; nothing else — handlers, tests, components, helpers,
seeds — may branch on which concrete implementation is in play, and everything flows through the
injected port. Read that file for the enforcement language.

DRY-progression / when-to-extract is not fully catalogued here either — load
`.claude/skills/enforce-clean-code/SKILL.md` for the mandatory 2nd-occurrence check, the
same-concept/changes-together discriminator, and the wrong-abstraction guard. The `[DRY-progression /
copy-paste drift]` class below is only the look-here index; the rule lives in that guide.

Comment value / when a comment earns its keep is not fully catalogued here either — load
`.claude/skills/enforce-comment-value/SKILL.md` for the bug-filing test, the derivable/recoverable
classifier, the change-narration rule, and the five verdicts. The `[code comment narrates the change…]`
class below is only the look-here index; the rule lives in that guide.

## Contents
- [How to use](#how-to-use)
- [Entry schema](#entry-schema-every-catalogued-class)
- [Curated](#curated-auto) — the calibrated defect classes (what recurs, where to look, the confirmed fix)
- [Emerging](#emerging) — weaker-signal / single-PR candidates; graduate on frequency
- [Known false-positives](#known-false-positives--never-raise) — never raise these

## How to use
- Read the whole file before Pass 1 / Wave 1. Treat every Curated class as a place a bug is
  statistically likely — go look there, don't wait for it to jump out.
- Frequency = how often this class actually breaks (high / occasional; "seed" = carried over from a
  codebase with the same stack and from the house rules in CLAUDE.md, not yet
  measured here). Higher = look harder. Recalibrate from JouveERP's own PR history as it accumulates.
- Check "Known false-positives" before raising a finding — the listed shapes are correct as
  written; raising them wastes a finding.
- Curated = confirmed recurring, human-authored or human-confirmed. Emerging = weaker signal,
  advisory. This file is append-safe: automated/manual additions go ONLY between the AUTO-APPEND
  sentinels, in the correct tier, using the entry schema below.

## Entry schema (every catalogued class)
**[class name]**
- Pattern: the defect shape in one line.
- Frequency: ~N over last ~200 PRs (or high-sev/occasional).
- Where: the files / layers / query shapes to inspect.
- Example: a concrete instance (PR#/symptom) when known.
- Fix: the confirmed correct resolution.
- source: where the class was calibrated from.

<!-- AUTO-APPEND:START -->

## Curated (auto)

**[money / financial math]**
- Pattern: amount/IVA/FX math that rounds through a float, mixes currencies, uses the wrong date's rate, or lets a document's lines drift from its total.
- Frequency: high (seed).
- Where: invoices and their items (neto, IVA 21/10.5/27, percepciones, total), receipts / payment orders and their lines, purchase invoices, exchange rates (`features/exchange-rates`, BCRA cron), inflation adjustment, aging, balances, libro IVA, trial balance, anything converting ARS↔USD.
- Example: `Number(total)` / `parseFloat` summed in JS and compared with `===` to a DB `numeric`; a USD invoice added to an ARS total; a conversion at today's rate on a document dated last month; `?? 0` turning a missing rate into a real zero; IVA computed per line and rounded differently from the AFIP payload.
- Fix: money is `numeric(18, 2)` in Postgres and validated as a decimal in Zod; totals and balances are computed in SQL/RPC, not by summing in JS; round once, at the place AFIP's rules say; every amount carries its currency and is converted with an explicit dated rate; missing value → "sin dato", not 0.
- source: house rules (CLAUDE.md), adapted seed.

**[double-entry / accounting integrity]**
- Pattern: a journal entry whose debits ≠ credits, an automatic entry missing for a business event (or created twice), a write into a closed accounting period, a ledger account referenced by code instead of id (or the reverse) inconsistently.
- Frequency: occasional, high-sev.
- Where: `features/journal-entries`, automatic entries from invoices/receipts/payment orders, `accounting_periods`, `chart-of-accounts`, libro mayor, balance.
- Example: a receipt RPC creates transactions but its asiento only on the happy path; cancelling an invoice reverses the transactions but not the entry; a back-dated edit lands in a closed period.
- Fix: entries are created by the same RPC/transaction as the business document and validated balanced in SQL; cancellation reverses through the existing trigger/RPC; period-closed check in the DB; see `docs/accounting-patterns.md`.
- source: house rules; `docs/accounting-patterns.md`.

**[idempotency / concurrency / atomicity]**
- Pattern: a retry or two concurrent writers corrupts state; multi-step writes outside one RPC orphan a row; a correlative number computed in TS races another insert.
- Frequency: high (seed).
- Where: invoice issue (Inngest `issue-invoice`, CAE request), CAEA inform, receipts / payment orders (`create_receipt`, `create_payment_order`), numbering (`get_next_numero`, UNIQUE `(channel_id, punto_venta, numero)`), Document Intelligence confirm, every Inngest step (re-runs on retry), insert+update+fan-out, delete-then-insert.
- Example: the CAE step requests a new number on retry instead of reconciling with `getLastAuthorizedNumber` / `getVoucherInfo` → duplicate voucher at AFIP; a random `idempotency_key` on `afip.emit`; a confirm double-submit creates two purchase invoices; a server action inserting `receipt_payment_lines` directly instead of through the RPC.
- Fix: one RPC (one transaction) per business document, child rows only through it; idempotency keys derived from the document id; state transitions guarded by the expected prior state; reconcile with AFIP before re-requesting; stable Inngest step ids; unique indexes as the last guard.
- source: house rules; adv-review.

**[fiscal invoicing / AFIP rules]**
- Pattern: a non-fiscal channel reaching AFIP, a CAE'd invoice mutated, an NC/ND without its associated voucher or motive, an AFIP error string parsed instead of the typed code.
- Frequency: occasional, high-sev.
- Where: `features/invoices`, `lib/afip/*`, `lib/inngest/functions/{issue-invoice,caea-*}.ts`, `features/afip-admin`, channel config (`invoicing_channels.is_fiscal`, POS mapping).
- Example: `inngest.send` of the emit event for a `*_interno` channel; an UPDATE on an invoice with `cae` set; retrying an `AfipError` with code `SERVICE` (deterministic) as if it were `TRANSPORT`.
- Fix: only `is_fiscal = true` channels emit; CAE'd vouchers are immutable (corrected only by NC/ND); `motivo_nc_nd` + `CbtesAsoc` required for NC/ND; retry only `TRANSPORT`; branch on `AfipError.code`.
- source: house rules (CLAUDE.md).

**[PostgREST truncation / keyset pagination soundness]**
- Pattern: an un-ranged select over a table that can exceed `max_rows = 1000` (silently truncated); offset paging over a live table; `range` without `order`; missing tie-break / has-more; a huge `.in()` exceeding URL length.
- Frequency: high (seed).
- Where: any PostgREST list/scan, exports (`app/api/export`), libro IVA / mayor, aging, treasury summaries, AI tools that read lists, drain loops.
- Example: a balance computed by summing `transactions` fetched without `.range()` — correct until the 1001st row, then silently wrong; offset paging over `audit_events` skips rows mid-write.
- Fix: aggregate in SQL; when rows are needed, chunk with `.range()` in a loop until a short page, ordered by a total order (`date, id`); chunk `.in()`; explicit `order` before `range`. See `_shared/perf-lens/`.
- source: house rules; adv-review.

**[migration EXPLAIN gate + non-sargable predicates + RLS initplan]**
- Pattern: DB-executed SQL (query/RPC/function/view/trigger/index) shipped without an EXPLAIN plan against a large dataset; non-sargable predicates; RLS helpers evaluated per row.
- Frequency: occasional, CRITICAL when present.
- Where: every migration and every RPC/query reachable via PostgREST as `authenticated`; the large tables (`transactions`, `journal_entry_lines`, `invoices`, `receipts`, `audit_events`, `ai_usage`).
- Example: `COALESCE(...)`/function on a column in WHERE/JOIN; a `Seq Scan` inside a correlated `SubPlan` with `loops=N`; a policy calling `public.user_has_role(...)` or `auth.uid()` bare, re-evaluated per row.
- Fix: EXPLAIN against a seeded large dataset (only on an already-running local stack); reshape to sargable / expression index; index every FK and filter column; wrap helpers as `(select ...)`; the index ships in the SAME PR.
- source: adv-review migration gate.

**[migrations — ordered, append-only, typed]**
- Pattern: timestamp ≤ the max on `main`; editing a merged migration; RLS missing from the creating migration; RPC/table shape changed without regenerating `lib/db/database.types.ts`; missing `set_updated_at()` trigger on a table with `updated_at`; unflagged large-table lock risk; a destructive change without the `[DESTRUCTIVE]` PR-title prefix.
- Frequency: occasional (seed).
- Where: `supabase/migrations/`, `lib/db/database.types.ts`, `ci.yml` jobs `database` and `deploy-migrations` (applies on merge to `main`).
- Example: two open PRs with the same timestamp prefix; a fix applied by editing an already-deployed migration (never re-applied in prod); a new column used in WHERE with no index.
- Fix: `YYYYMMDDHHMMSS_<scope>.sql` > max on `main`; a NEW migration for every change; RLS + policies in the same file; regenerate and commit types; index new filter/FK columns; flag lock/rewrite risk in the PR body. See `/new-migration`.
- source: CLAUDE.md; `/new-migration`.

**[authorization / role-gating / IDOR]**
- Pattern: a `"use server"` action or route reaching `getServiceClient()` without `requireUserContext()` + the matching `userCan`; a write gated by a `:read` permission; a self-scoped row read by a client-supplied id; a DEFINER function trusting a parameter; an AI tool bypassing its action.
- Frequency: occasional but highest severity.
- Where: `features/*/actions/**`, `app/**/route.ts`, RLS policies and grants, `features/ai/tools/**`, Inngest event payloads, `lib/auth/permissions.ts`.
- Example: an action exported "for reuse" from a `"use server"` file with no gate; `cancelInvoiceAction` checking `invoices:read`; a notification marked read by id without `.eq("user_id", ctx.userId)`.
- Fix: gate first, then service client; the permission matching the operation; Zod-parse every input; `user_id` filter on self-scoped rows; policies with `(select public.user_has_role(...))` in USING and WITH CHECK. See `enforce-role-isolation`.
- source: house rules; adv-review.

**[stale cache / state after mutation, user-switch, retry, error]**
- Pattern: a mutation invalidates only its own query key (cross-feature data stays stale); local state not reset after failure; cache not cleared on sign-out; a Realtime subscription without a server-side filter or not re-keyed.
- Frequency: high (seed).
- Where: `features/*/hooks/use-*.ts` mutations, `features/*/lib/*-keys.ts`, `useRealtimeInvalidate`, sign-out listeners.
- Example: `useCreatePaymentOrder` invalidating `paymentOrdersKeys` but not `transactionsKeys`, `purchaseInvoicesKeys`, `suppliersKeys`, `checksKeys`, `issuedChecksKeys`; a Realtime channel without `filter: "column=eq.X"` refetching on every unrelated change.
- Fix: invalidate every affected feature's keys on settle; reset local state from the server row; clear the cache on sign-out; filter Realtime server-side.
- source: house rules (CLAUDE.md).

**[silently-swallowed / unchecked errors]**
- Pattern: reading `.data` while ignoring `.error`; an action that throws instead of returning `ActionResult`; a catch that maps a non-retryable failure to retryable (or the reverse); a synthetic success.
- Frequency: occasional, high-sev.
- Where: every Supabase call, `Promise.all` legs, Inngest step catch blocks, `AfipError` handling, Document Intelligence extraction, shell scripts.
- Example: an extraction failure mapped to an empty draft ("success, 0 items"); an `AfipError` of code `SERVICE` rethrown as a plain `Error` so Inngest retries a deterministic rejection; `set -uo pipefail` without `-e`.
- Fix: check `.error` everywhere and return `{ ok: false, error }` with a safe Spanish message (and `captureException` for the unexpected); throw Inngest `NonRetriableError` for deterministic failures; no synthetic success.
- source: adv-review.

**[provider-name leak / cross-feature business logic]**
- Pattern: a provider name (anthropic/gemini/openai, wsfev1/wsaa, sentry, the mail provider) in feature code or shared identifiers; a business-logic action imported across features; shared logic duplicated into a feature instead of `lib/`.
- Frequency: occasional (seed).
- Where: `features/**` outside `features/ai/model.ts` and the AFIP/admin paths; `lib/**`.
- Example: a component branching on `servedModel() === "gemini-..."`; `loans` calling `createTransactionAction` from `transactions`.
- Fix: route through the seam (`features/ai/model.ts`, `lib/afip`, `lib/inngest`); move shared write logic to `lib/` (only `issueFiscalInvoiceAction` crosses, by documented exception). See `enforce-ports-and-adapters`.
- source: CLAUDE.md feature-slice rules.

**[no silent identity/categorical defaults]**
- Pattern: currency / channel / IVA condition / voucher type / any closed enum falling back to a hardcoded member.
- Frequency: occasional, silent-wrong-data.
- Where: product code, Document Intelligence normalization, scripts, migrations alike.
- Example: an extracted purchase invoice with no detectable currency defaulted to `ARS`; an unknown IVA condition defaulted to `responsable_inscripto`; a missing channel defaulted to `DEFAULT_CHANNEL_ID` on a server write (the default is for pre-selecting a form, not for writes).
- Fix: fail loudly, return `unknown` for user review, or require explicit input — never guess a member.
- source: adv-review Rules.

**[type-tightness / no primitive obsession / no casts]**
- Pattern: a domain identity travelling as a bare primitive; the same field-shape re-inlined across files; `as`/`as unknown as`/`any` to silence the compiler.
- Frequency: occasional (cleanliness), but `as`/`any` violate repo rules outright.
- Where: action inputs/outputs, Supabase row mapping, generated types (`lib/db/database.types.ts`).
- Fix: Zod schema + inferred type in `features/<f>/schemas`; reuse generated `Tables<>`/`Enums<>` types; narrow with type guards, never `as`. (This is the repeated-TYPE case; a repeated BEHAVIOUR/RULE/constant is `[DRY-progression / copy-paste drift]` below.)
- source: CLAUDE.md (no `any`, no `as`).

**[DRY-progression / copy-paste drift]**
- Pattern: a 2nd occurrence of one concept copy-pasted / re-implemented (incl. re-implementing an existing `lib/` helper) instead of extracted; OR a forced/flag-parameterized abstraction over coincidental similarity.
- Frequency: occasional; highest-drift = cross-feature copies + TS↔SQL rules (a total computed in both the RPC and the component).
- Where: a new fn/constant/guard whose body already exists in `lib/` (`format.ts`, `date-range.ts`, `scope.ts`) or another feature; numbering/format helpers; IVA math.
- Fix: run the mandatory 2nd-occurrence check — extract genuine same-concept/changes-together duplication (or reuse the existing helper), else LEAVE with a falsifiable rationale. See `enforce-clean-code`.
- source: enforce-clean-code (single source).

**[persisted category must be constrained in the DB]**
- Pattern: a persisted closed string category stored as free `text` with no CHECK or enum; a speculative value no code emits.
- Frequency: occasional (completeness criterion).
- Where: new persisted columns (status, kind, channel, voucher type, check status).
- Fix: a Postgres enum or `text` + CHECK matching the house form of the sibling table; point TS at the generated type and derive the Zod enum from one source; verify prod distinct values before tightening.
- source: adv-review.

**[no version markers in code]**
- Pattern: `v2`/`old`/`new`/`legacy`/`next` in identifiers, types, filenames, or comments.
- Frequency: occasional (cleanliness).
- Where: everywhere — files, consts, functions, comments.
- Fix: name things by what they ARE. EXEMPT: external SDK identifiers you can't rename and `next` as iteration semantics.
- source: house convention.

**[code comment narrates the change instead of stating current behavior]**
- Pattern: a code comment describing the EDIT, not current behaviour — EXPLICIT ("was X, now Y", "previously", "no longer") or IMPLICIT/comparative ("rather than X", "instead of X", "unlike X").
- Frequency: occasional (cleanliness).
- Where: comments and docstrings added or touched by the diff, especially beside edited/renamed/moved logic.
- Example: `// this was in USD, now ARS` → `// ARS`; `// keyset-paginate, rather than OFFSET` → `// keyset-paginate`.
- Fix: see `enforce-comment-value` — state only current behaviour; change narrative and migration notes live in the PR body, not the code.
- source: user directive (comment-vs-PR split).

**[doc / PR-body over-claim vs implementation]**
- Pattern: the PR body or a comment claims behavior the diff doesn't deliver (or a refactor silently reverts a shipped feature / drops a returned field).
- Frequency: occasional.
- Where: PR description vs diff; stacked chains (check the MERGED result, not one diff); `docs/pendientes.md` / `docs/roadmap.md` claims.
- Fix: reconcile claim with code; treat a silent feature revert / dropped field as a finding.
- source: adv-review.

**[AI boundary — untrusted text, gated tools, confirm before write]**
- Pattern: document/user text treated as instructions; an AI tool that writes or bypasses its read action; extracted data persisted as a business document without the user's confirm step; a model call outside `features/ai/model.ts`; usage not metered.
- Frequency: occasional, high-sev.
- Where: `features/ai/{agent,tools,document,insights,skills}`, `app/api/ai/chat/route.ts`, `lib/inngest/functions/{document-extraction,ai-analyst}.ts`, `ai_usage`.
- Example: OCR text of a supplier invoice interpolated into a system prompt; a new tool taking a `userId`/`role` argument; an extraction auto-creating a purchase invoice on job completion.
- Fix: untrusted text stays in the user/content role, delimited, never in system instructions; tools wrap gated read actions; keep the review-then-confirm gate; record tokens/cost in `ai_usage`; see `docs/ai-patterns.md`.
- source: `docs/ai-overview.md`, `docs/ai-patterns.md`.

**[perf: cost × call frequency]**
- Pattern: a query cheap in isolation but run per-row/per-page/per-step on a hot table, or whose result isn't used every call; sequential awaits of independent queries.
- Frequency: occasional.
- Where: drain loops, batch fan-out, Inngest step loops, retries, per-invoice rate lookups, server components that `await` queries one after another.
- Example: an exchange-rate lookup per invoice line instead of one batched query; three independent selects awaited sequentially in a page's prefetch.
- Fix: multiply per-call cost by call frequency; hoist invariants; batch lookups; `Promise.all` independent queries.
- source: adv-review.

**[deploy / CI wiring / torn-deploy]**
- Pattern: a new Inngest function not registered in `app/api/inngest/route.ts`; code that needs a migration merged before the migration is applied; an env var added locally but not in `.env.*.example` / Vercel; a cron without `TZ=America/Argentina/Buenos_Aires`.
- Frequency: occasional, real incidents.
- Where: `lib/inngest/functions/*`, `app/api/inngest/route.ts`, `.env.local.example`, `.env.production.example`, `ci.yml` (`deploy-migrations`).
- Fix: register every function; land migrations with or before the code that needs them (they apply on merge to `main`); add every new variable NAME to the examples; verify the running deployment, not just the merge.
- source: `/new-inngest-fn`; adv-review.

**[user-facing copy speaks the user's language, not engineering]**
- Pattern: implementation vocabulary in any human-read UI string (toast, dialog, error `message`, empty state, nav label).
- Frequency: occasional.
- Where: user-facing copy only (Spanish from Argentina, for an accounting/operations team). EXEMPT: LLM prompt text, dev logs, code comments, schema `.describe()`, internal enum strings.
- Example: banned — `job`, `step`, `payload`, `RLS`, `RPC`, "the provider", "SOAP fault", raw AFIP error dumps. KEEP accounting and fiscal terms the team uses (`comprobante`, `CAE`, `nota de crédito`, `asiento`, `libro IVA`, `percepción`, `cheque en cartera`, `orden de pago`).
- Fix: rewrite in plain Spanish the user can act on, one or two sentences (an AFIP rejection → what to correct).
- source: adv-review Rules.

**[UI conventions — Dialog, monochrome, forms]**
- Pattern: CRUD in a `Sheet` instead of a centered `Dialog`; a brand/semantic color where the app is 100% monochrome; `<input type="date">` instead of `<DatePicker>`; reinvented primitives instead of shadcn/ui; an item outside its sidebar group; a `useSuspenseQuery` with no RSC prefetch upstream.
- Frequency: occasional.
- Where: `features/*/components/**`, `app/(dashboard)/**/page.tsx`.
- Fix: `Dialog` for create/edit; tokens only (danger = copy + icon, not red); `<DatePicker>` with ISO `YYYY-MM-DD`; shadcn primitives; prefetch + `Hydrate` for suspense queries.
- source: CLAUDE.md.

**[data exposure / audit logging / telemetry leaks / inbound callbacks]**
- Pattern: server-only fields (tokens, secrets, AFIP cert/key, service-role results) reaching client payloads or a widened `select *`; an audit event written before the op runs, with the wrong actor, or missing on a sensitive mutation; amounts, CUIT/DNI/CBU, tokens, or extracted JSON in logs, Sentry, or error messages; an inbound callback (e.g. `/api/inngest`) served without signature verification.
- Frequency: occasional, high-sev.
- Where: action return payloads, `logAudit()` call sites, `logger`/`captureException` call sites, error handlers that echo input, route handlers.
- Fix: explicit column lists; `logAudit()` after the op with `ctx.userId` and ids only; log ids and counts, never values; keep Inngest signing-key verification on. See `_shared/telemetry-lens/`.
- source: adv-review.

## Emerging
<!-- Advisory / weaker-signal classes land here (single-PR or unconfirmed signal). Auto-appended by a catalog-calibration pass. Graduate to Curated on confirmation + frequency >=2 distinct PRs. -->

## Known false-positives — never raise
<!-- Negative signal. These shapes are correct as written; raising them wastes a finding. Pre-filters both sections above. -->
- A to-many embed does not duplicate parent rows — `(entry_date, id)` on the parent PK IS a total order; a tiebreak is needed only for a `RETURNS TABLE` RPC projecting a real JOIN.
- An owner-only check written as `ctx.roles.includes("owner")` (e.g. client/supplier opening balances) is the documented house form, not an ad-hoc role check.
- `issueFiscalInvoiceAction` imported from another feature is the documented exception to the no-cross-feature-actions rule.
- `CREATE OR REPLACE FUNCTION` preserves the ACL — do NOT flag a missing re-GRANT; only a fresh CREATE or DROP+CREATE resets EXECUTE to PUBLIC.
- The JSON string `"now()"` coerces fine to timestamptz via PostgREST.
- Radix uncontrolled `Select` updates its own displayed value — `defaultValue` isn't automatically a bug.
- Supabase `SIGNED_OUT` is a precise "session removed" signal — a global reset listener on it is correct, not noisy.

<!-- AUTO-APPEND:END -->
