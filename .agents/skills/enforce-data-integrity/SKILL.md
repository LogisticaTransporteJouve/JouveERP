---
name: enforce-data-integrity
description: >-
  The data-integrity lens for JouveERP: every money figure (IVA, percepciones and retenciones,
  totals, balances, aging, libro IVA, ARS/USD conversions, figures handed to the AI) is an equation
  whose components are counted once, under one convention, with unknown kept apart from zero; every
  persisted entity (comprobante, recibo, orden de pago, asiento, opening balance, exchange rate)
  keeps its user overrides, existing rows and invariants through every writer, trigger and
  transition, including NC/ND, cancellation and closed periods. It writes each figure as an
  equation and walks each entity's lifecycle. Use for "is this balance right", "double count", "IVA
  or FX or percepciones math", "will the override survive", "backfill", "what about existing rows",
  "closed period", and as an adv-review seat. CONDITIONAL: a no-op on a diff with no money figure
  and no persisted entity.
---

# Enforce Data Integrity: figures add up, entities keep their facts

**Delivery.** A conditional lens with no condensed copy. adv-review's routing table names this
file, and the review seat that owns it Reads this SKILL.md itself. It fires when the diff computes,
converts, stores, aggregates or displays a money or quantity figure, or writes, replaces or derives
rows of a persisted entity. Otherwise the seat emits exactly:
`data-integrity: N/A — no money figure or persisted entity in diff.`

**The law: every figure is one equation whose components are counted exactly once, under one
convention, with unknown kept apart from zero. Every entity keeps its user-set facts and its
invariants through every writer and every transition.**

## House facts the diff doesn't show

- **Storage and rounding.** Money columns are `numeric` (comprobante amounts are `numeric(15,2)`,
  `supabase/migrations/20260509130000_invoices.sql`), never a float type. In TS money is a JS
  `number`: money rounds through `round2` (`lib/format.ts`), and es-AR input parses through
  `parseArAmount` in the same file. A new parser gets a table of ambiguous es-AR inputs
  (`1.234`, `1,5`, `-0,01`) with expected values.
- **Two channels.** `invoicing_channels` holds `jouve_fiscal` and `jouve_internal` (DZ was
  retired on 2026-10-31; read via `lib/channels.ts`; scope filter in `lib/scope.ts`, where `null` means
  "do not filter", which is not the same as an empty channel list). Only fiscal channels post
  asientos and enter the libro IVA (`is_channel_fiscal`,
  `supabase/migrations/20260516250000_journal_skip_internal_and_double_counting_fix.sql`), so cash
  across all channels differs from accounting cash by design. Every figure states which channel
  population it covers.
- **IVA.** AFIP rate id → percent lives in `lib/afip/codes.ts` (`IVA_RATE`, `IVA_RATE_PERCENT`: 0,
  2.5, 5, 10.5, 21, 27). Per-alícuota buckets are built from `invoice_items` (`iva_rate_id`,
  `line_neto`, `line_iva`) by the emission path (`lib/inngest/functions/issue-invoice.ts`,
  `lib/inngest/functions/caea-inform.ts`), the PDF (`lib/pdf/generate-and-store.ts`) and the SQL
  books (`libro_iva_ventas`, `libro_iva_compras`). One document must yield the same buckets in
  every one of them, and in the asiento.
- **Percepciones and retenciones.** Percepciones on a comprobante are `imp_trib`, kept apart from
  IVA. Retenciones a client applies to a recibo live in `receipt_retentions`:
  `total_amount = Σ payment lines + Σ retentions`, and a retención is fiscal credit, not cash
  (`supabase/migrations/20260510160926_receipt_retentions.sql`).
- **ARS/USD.** `lib/fx.ts`: `toArs` and `arsEquivalent` return `null` for dollars with no rate, and
  `fetchLatestUsdRate` returns `null` when no rate is loaded. That is the house shape of "unknown
  is not zero". The ledger and the libro IVA convert each component with the document's stored
  `cotizacion` and round once per component; the counterparty line is the sum of the rounded lines,
  so the entry balances to the cent; original-currency amounts stay as `*_orig`
  (`supabase/migrations/20260701130000_journal_multicurrency.sql`,
  `supabase/migrations/20261016140000_multicurrency_reports.sql`).
- **Sign.** Amounts are stored positive and the sign comes from `kind` (`factura`, `nc`, `nd`): an
  NC posts with factor −1 (`build_purchase_invoice_journal_lines`), an ND adds like a factura.
- **Voucher keys.** AFIP numbers per (CUIT, punto de venta, comprobante type) and never resets
  yearly. Sales uniqueness is the index `invoices_unique_numbering` on (`channel_id`,
  `punto_venta`, `kind`, `coalesce(letter, '')`, `numero`); purchases are
  `unique nulls not distinct (supplier_id, kind, letter, punto_venta, numero)`
  (`supabase/migrations/20260517850000_purchase_invoices_unique_nulls_not_distinct.sql`). `numero`
  is set only once AFIP authorizes; the number sent is recorded first in `afip_attempted_numero`
  (`supabase/migrations/20260706090000_invoice_afip_attempted_numero.sql`).
- **Ledger.** Asientos go through `create_journal_entry`; the deferred constraint trigger
  `enforce_journal_balance` rejects Σdebit ≠ Σcredit. Auto-posting triggers
  (`emit_journal_for_invoice`, `emit_journal_for_purchase_invoice`, `emit_journal_for_receipt`,
  `emit_journal_for_payment_order`, `generate_journal_for_transaction`, the check transitions)
  derive asientos from source documents; transactions linked to a recibo or OP are skipped because
  the header already posts them.
- **Two period conventions.** `journal_entries.accrual_period` (`YYYY-MM`) drives balances and
  period close; `entry_date` drives the libro mayor (`get_ledger`). A figure that mixes them is
  wrong at month edges.
- **Closed periods.** `accounting_closed_periods` plus the trigger `guard_journal_period_closed`
  (BEFORE INSERT/UPDATE/DELETE on `journal_entries`, keyed on `accrual_period`, errcode `55006`),
  `supabase/migrations/20260704250000_audit_t6_period_close.sql`. It guards `journal_entries` rows
  only, not `journal_entry_lines` directly.
- **Opening balances.** `client_opening_balances`, `supplier_opening_balances`,
  `account_opening_balances` (and the `_allocations` tables). `apply_client_opening_balance`
  imputes FIFO net of receipt allocations that already exist
  (`supabase/migrations/20260513221512_opening_balance_respect_receipts.sql`).
- **Inflation adjustment.** RECPAM (RG 4667) is a manual asiento to account `4.2.2`, recorded in
  `inflation_adjustments` (period, coefficient, `journal_entry_id`); see `features/inflation/`.
- **Cancellation.** Fiscal `emitted → cancelled` is blocked once a CAE exists: it requires an NC
  (`check_fiscal_cancel_requires_nc`). `guard_cancel_invoice_with_allocations` blocks cancelling an
  allocated invoice; `handle_receipt_cancellation` and `handle_payment_order_cancellation` delete
  the linked `transactions`; check guards block cancelling over cashed or phantom checks.
- **Reads.** PostgREST `max_rows = 1000` (`supabase/config.toml`) silently truncates. A JS sum over
  a list drains through `lib/supabase/paginate.ts` (`paginateRange`, deterministic total order) or
  is computed in SQL.
- **AI.** A number the assistant returns through `features/ai/registry/` is a figure under this
  lens. AI cost lands in `ai_usage`, priced per model id by `features/ai/lib/pricing.ts`.

## 1. The composed-figure ledger (money and quantities)

1. **List every figure** the diff creates or changes: a returned total or balance, an aging bucket,
   a libro IVA row, a PDF total, a grid cell, a number handed to the model, a price.
2. **Write each as an equation**, `figure = Σ componentᵢ`. For each component, record five facts
   taken from the source's own definition, not from the caller's assumption:
   - **source**: table, view, RPC or function;
   - **basis**: opening-inclusive level, or movement;
   - **window**: `[from, to]`, each end inclusive or exclusive, with its grain and column
     (`accrual_period` month, `entry_date` day, `fecha` of the comprobante);
   - **currency**: ARS, USD, or converted, and at which rate (stored `cotizacion`, rate on date,
     latest rate);
   - **sign**: and whether it comes from `kind` (NC) or from the stored value.
3. **Ask of the equation:**
   - **Counted once.** Does any component already contain another? Watch for an opening balance in
     both the seed and the movements, a transaction posted by its own trigger and by its recibo or
     OP header, internal channels entering a fiscal figure, a cancelled document still summed, or
     a retención counted as cash. Does the diff drop a filter that excluded a component (status
     `cancelled`, `is_fiscal`, the `receipt_id`/`payment_order_id` skip)?
   - **One convention.** Do the components share window inclusivity, grain, period column,
     currency and sign? Is every NC term negated exactly once? Is it converted, then split, with
     the cent remainder assigned the way the asiento assigns it?
   - **Unknown is not zero.** What does each component return on empty, NULL or unresolved input:
     no rate, no rows, a truncated read, a failed AFIP lookup? Look for `?? 0` or `Number(null)`
     where `lib/fx.ts` would return `null`. Does that zero reach a balance, a tie-out, a gate or
     the model as a confirmed figure? A missing comparison renders as absent, not as 0.
4. **Write the boundary tests the equation implies** (Vitest), with expected values worked by
   hand from the domain:
   - the cutoff day itself, and the first and last day of a month;
   - a closed period next to an open one;
   - empty and NULL input, and USD with no rate;
   - a mixed ARS/USD case and a mixed-alícuota comprobante (21 + 10.5 + 27);
   - an NC against its factura, and a cancelled document;
   - an internal-channel row next to a fiscal one.
5. **Keys and rounding.** A money key for a comprobante includes every column of its uniqueness
   index above (punto de venta and comprobante type, not just `numero`). Money rounds through
   `round2`, once per component at the same point the ledger rounds; a TS total that must tie to a
   SQL figure reproduces the SQL rounding order, not its own.
6. **Only when their files are touched:**
   - Pricing (`features/ai/lib/pricing.ts`): a price row is keyed on every dimension that changes
     the rate (model id, input/output/cache tokens) and on the model that actually answered.
   - IVA, percepción or retención logic and AFIP codes: cite the AFIP resolution (RG) or the
     WSFEv1 manual section for every changed branch. Never accept a symmetric "computed equals
     booked" check as the test; it masks a bug present on both sides.

Check the result against the accounting definition and AFIP's own rules, not intuition.

## 2. The lifecycle walk (persisted entities)

For each entity whose rows the diff writes, replaces or derives:

1. **Writers and transitions.** Grep every writer of the table: server actions, RPCs and triggers in
   `supabase/migrations/` (the latest definition of each function wins), Inngest functions in
   `lib/inngest/functions/`, AI confirm paths, `scripts/`. List the transitions: create, edit,
   re-derive (an auto-posting trigger rebuilding an asiento), emit (draft → emitted, CAE),
   NC/ND against an origin, cancel, delete, reopen a period.
2. **Preserved fields.** Name the entity's user-set or override fields (a human-confirmed
   `account_id` on a purchase invoice, a manual `exchange_rates` row with `source = 'manual'`, a
   cost center, an opening-balance target). For each writer:
   - Is the write a merge or a full replace?
   - Do omitted fields keep their values, or get defaulted by an upsert, a Zod `.partial()` or
     `.default()`, or a whole-array write?
   - Is the override sticky in both directions against the automatic derivation? The house
     example: the BCRA cron inserts with `ignoreDuplicates`, so a manual rate for that date wins
     (`lib/inngest/functions/bcra-exchange-rate.ts`).
   - When a row is deleted and rebuilt (an asiento regenerated on edit), are its overrides carried
     over?
3. **Existing rows.** If the diff adds a derived column, flag, invariant or meaning:
   - What do rows written before this PR hold?
   - Is there a backfill, and does its predicate match the live deriver's (same filter, same join)?
   - Does a backfill that writes asientos respect closed periods, or does it document why it may
     not?
4. **Guards and dependents.**
   - A closed-period guard holds at every writer: a new path that writes `journal_entry_lines`
     without touching its `journal_entries` row, or a source-document edit whose trigger re-posts
     into a closed `accrual_period`, must still hit `guard_journal_period_closed` or an equivalent
     check. The guard is computed from durable state (`accounting_closed_periods`), never from a
     client-sent flag.
   - A fiscal comprobante with a CAE is corrected by an NC/ND, never edited or deleted; a new
     cancel or delete path keeps `check_fiscal_cancel_requires_nc` reachable.
   - Derived rows (asientos, allocations, linked `transactions`, the PDF and its hash) are
     cleared, reversed or carried on cancel and delete, by the same mechanism the existing
     cancellation triggers use.
5. **Repairs.** Check a data-repair predicate against the rows actually in the bad state in
   production (a read-only count the owner runs; agents never `supabase link` or `db push`), and
   explain any gap.

## Coverage table (proof of work)

```
figure or entity | equation (component: source / basis / window / currency / sign) or writers × transitions | counted once / one convention / unknown≠0, or preserved fields / existing rows / guards | status
```

## Verify before raising

- **A double count** needs the equation written from the current code. If both terms don't cover
  the same rows, the finding dies.
- **An accounting shape with no referent in production** (a currency, comprobante type or channel
  that never occurs) fails closed if that is cheap, or is dropped.
- **Internal channels missing from the ledger** are by design, not a finding.
