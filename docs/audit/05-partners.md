# AUDIT — purchases/partners (agent audit-partners)

## SYSTEM MAP
suppliers/clients near-identical masters. cuit text unique + CHECK ^[0-9]{11}$. soft-delete is_active; NO DELETE policy — hard delete only via service-role in action. suppliers add default_channel_id, default_payment_term_days, category_id (SET NULL).
purchase_invoices: header (neto/iva/trib/total, moneda+cotizacion). dup guard unique nulls not distinct (supplier_id,kind,letter,pv,numero). NO CHECK total=neto+iva+trib. invoice_origin_id self-FK for NC. status received|cancelled.
purchase_invoice_items: RPC replace_purchase_invoice_items deletes+reinserts, recomputes header from items (imp_trib preserved). No line-math validation.
supplier_opening_balances+_allocations: owner-only definer RPC FIFO. SELECT finance-only.
products: 3PL catalog no price; pallets.product_id SET NULL.
Balances fully derived. cta cte = TS running sum over v_*_account_movements. Aging = v_supplier_aging_documents (alloc+NC) / v_aging_documents (alloc+opening). Journal: AFTER INSERT posts (fiscal only); AFTER UPDATE of status posts reversal.
Search: parameterized RPCs, no injection.

## FINDINGS
[C1][accounting] `20260516120000_purchase_nc_origin_aging_fix.sql:31` (current def 20260704120000:45-82) — supplier aging LOST opening-balance deduction. 20260514221909 subtracted supplier_opening_balance_allocations; NC-fix rebuild dropped join, all later redefs kept only alloc+nc. Client twin still subtracts opening. Set opening settling $70M of $100M → supplier aging shows settled $70M as open. CONFIRMED. Fix: re-add opening LEFT JOIN; regression test comparing view defs. [CORROBORATES treasury agent]
[C2][balances] `suppliers/actions/account-actions.ts:324-341` — supplier running balance DOUBLE-COUNTS when opening coexists with pre-cutoff invoices. Clients: signed=round2(target-running) (jump). Suppliers: running+=signed_amount for every row incl opening_balance (raw target) + view emits all pre-cutoff invoices at full value. Pre-cutoff $100k, real debt $30k → tab shows $130k. Also missing clients' date-tie sort putting opening last. CONFIRMED. Fix: port jump logic + tie-sort from clients.
[C3][accounting] `20260517700000:311-315`+`purchase-invoices-actions.ts:399-494` — journal emitted on INSERT, reversed on status change ONLY (after update of status). updatePurchaseInvoiceAction lets you change neto/iva/trib/total/fecha/channel_id/supplier_id of posted invoice; replace_purchase_invoice_items rewrites totals via UPDATE — none re-emit. Edit total $121k→$242k → cta cte+libro say 242k, mayor says 121k forever. CONFIRMED. Fix: block amount edits once posted or add update trigger reverse+re-emit.
[H1][deletion] `suppliers-actions.ts:307-310`, `clients-actions.ts:302-305` — reference check gating service-role hard delete is EMPTY ARRAY with real tables commented out (// K.2). refs.total always 0 → dialog tells user "se puede eliminar definitivamente" for supplier with hundreds of invoices. (a) with invoices → FK RESTRICT saves but useless error; (b) cascade-side only → SILENT DATA LOSS: supplier_opening_balances (CASCADE), file_attachments (CASCADE), storage_tariffs.client_id (CASCADE), shipments/issued_checks (SET NULL). CONFIRMED. Fix: populate dependents lists or information_schema-driven count.
[H2][validation] `purchase-invoices/schema.ts:131-172`+form:229-239 — NO validation neto+iva+trib=total, no DB CHECK, no refine. Fiscal: deferred jel_enforce_balance incidentally rejects (generic error). INTERNAL: journal skipped → inconsistent totals persist; updates never checked even fiscal (C3). Internal neto 100k total typo 1M → OP pays 1M against 100k expense. CONFIRMED. Fix: zod refine + DB CHECK.
[H3][money-parsing] `purchase-invoice-items-editor.tsx:40-45`+schema.ts:62-70 — parseNumber/zod strip ALL dots as thousands: "1234.56"→123456 (100×). Items editor uses text inputs (inputMode decimal, iOS emits "."); header uses type=number+Number(); onSubmit sends quantity:Number() (comma→NaN) but line_neto from parseNumber. Three parsers disagree. qty "0.5" → line_neto uses qty 5, stored quantity 0.5 → quantity×unit_price≠line_neto, RPC inserts unchecked. CONFIRMED. Fix: one locale-aware parser + validate line math in RPC.
[H4][CUIT] `suppliers/schema.ts:45-48`, `clients/schema.ts:53-56` — NO check-digit (mod-11) validation anywhere. Server zod ^[0-9]{11}$ (accepts 12345678901); VerifyCuitSchema adds ^[23]\d{10}$ used only by optional padrón button; DB CHECK digits-only; client input no validation. Applies create+update. Typo'd CUIT → libro IVA Compras TXT (L.6) → AFIP rejection. CONFIRMED. Fix: shared isValidCuit (weights 5432765432) in lib/ + DB CHECK.
[M1][fiscal-consistency] purchase-invoice-form.tsx:533-561 — NO letter vs supplier iva_condition check: monotributista/exento supplier + letter A (IVA crédito computed); RI + C. Edit mode fabricates iva_condition:"responsable_inscripto" for chip. Monotributo supplier letter A imp_iva 21k → fictitious IVA crédito. CONFIRMED. Fix: server rule RI→A/B, mono/exento→C imp_iva=0.
[M2][NC integrity] purchase-invoices-actions.ts:252-376 — invoice_origin_id validated only as any UUID. Server accepts NC pointing at another supplier's invoice, ND, or cancelled; aging NC-netting nets by origin regardless of supplier → cross-supplier corruption. No cap: ΣNC>origin → open_amount≤0, doc silently vanishes. CONFIRMED. Fix: validate origin supplier/kind/status; warn on over-credit.
[M3][cancel] purchase-invoices-actions.ts:496-532 — cancel doesn't check payment allocations: cancel invoice w/ issued-OP allocations leaves OP issued + allocation dangling → cta cte loses +invoice keeps −OP (negative), aging drops doc. Dialog claims "se puede revertir editando" — FALSE (update schema has no status; DB CHECK forbids un-cancel). Cancel of already-cancelled silently succeeds+audits. CONFIRMED.
[M4][items data-loss] purchase-invoice-form.tsx:174-188,374-392 — edit mode itemsPayload defaults [] (clear all) when with_items false; with_items true only after non-suspense usePurchaseInvoiceItems resolves. Fetch errors → saving header edit SILENTLY DELETES every line item. CONFIRMED path. Fix: send items:undefined unless user toggled off after hydration.
[M5][RBAC leak] suppliers/account-actions.ts:193-198, clients/account-actions.ts:76-87 — account feeds gated only by suppliers:read/clients:read. operations role has both but NO purchase_invoices/payment_orders/invoices/receipts:read — yet account tab hands it every invoice amount/OP/receipt (purchase_invoices SELECT using(true)). supplier_opening_balances SELECT finance-only → for operations opening row drops → same supplier different balance per role. CONFIRMED. Fix: gate account actions on document perms; align opening RLS.
[M6][audit] supplier-categories-actions (3 mutations), suppliers/account-actions.ts:81-152, clients/account-actions.ts:344-416 — category CRUD + opening-balance set/clear (owner-only, rewrites aging) emit NO audit_events. CONFIRMED.
[M7][numbering] `20260516170000:117-133` — next_internal_purchase_numero filters status='received' (comment: "para no reusar números de anulados") but does OPPOSITE: excluding cancelled returns cancelled invoice's number again → hits unique constraint (no status carve-out). Cancel internal #5 → next create auto-fills 5 → "Ya cargaste esta factura". Dead-ends auto-numbering. CONFIRMED. Fix: drop status filter or exclude status from uniqueness.
[M8][multicurrency] 20260514221909 v_supplier_account_movements + running sum — form offers DOL invoices w/ cotización but movements view exposes no moneda; running balance adds USD imp_total to ARS OPs 1:1. #198 fixed this for aging but cta cte still mixes. CONFIRMED code, PLAUSIBLE impact.
[M9][truncation] suppliers/clients/products list*Action unpaginated select order by name. PostgREST db.max_rows 1000 silently truncates: client #1001+ never appears in combobox/products form. CONFIRMED mechanism. Fix: chunk or use search RPCs.
[L1] 20260517850000 unique key includes letter → same comprobante loaded once letter A once NULL = two rows.
[L2] products-actions.ts:171-186 no ref pre-check; delete product w/ pallets SET-NULLs pallets.product_id; deleteProductAction takes unvalidated {id}; products RLS SELECT excludes finance while products:read may include.
[L3] cross-feature imports: suppliers/schema←clients; purchase-invoices←suppliers; suppliers/account-actions←payment-orders. Rule ignored.
[L4] monochrome: yellow/amber/emerald across supplier/client forms, tables, aging, padron (16 hits).
[L5] 20260704120000:57-63 days_overdue/buckets from fecha even though fch_vto_pago added; due-in-60-days is "overdue 31" on day 31.
[L6] suppliers/account-actions.ts:329-336 per-doc outstanding nets OPs+opening but NOT NCs-by-origin while aging nets NCs → "Parcial" in one tab, absent in other.
[L7] LIKE needles don't escape %/_; search "100%" matches everything.

## DESIGN TENSIONS
1. Two sources of truth for totals (header-only trusts user math; itemized trusts RPC recompute; ledger trusts INSERT-time). C3+H2 guarantee divergence.
2. "RLS blocks hard delete" is theater — delegates to app-level check that is empty commented array (H1).
3. Mirror features drifted — suppliers/clients built as mirrors then fixed independently (opening jump, aging opening, moneda). Every asymmetry (C1,C2,M8) is one-sided maintenance. Shared helpers collapse the class.

## EXPECTATION GAPS
- Purchases have no imp_op_ex/imp_tot_conc (exempt/non-taxable); sales side does. Libro IVA Compras can't discriminate exempt vs gravado at header.
- Supplier/client creation hard-locked to AFIP padrón (legal_name+iva_condition disabled): foreign supplier / CUIT missing from padrón / AFIP outage → creation impossible.
- account_id/cost_center_id absent from PurchaseInvoiceUpdateSchema — AI-classified expense account can't be corrected via edit.
- Duplicate-CUIT prevention good (DB unique + friendly msg + proactive banner) — one hunt item fully passes.

## OPEN QUESTIONS
1. Another surface (accounting/AI) reclassifying purchase_invoices.account_id post-create? Found none.
2. Production rows in supplier_opening_balance_allocations? If yes C1 is live corruption; if never used, C1/C2 latent.
3. Do DOL purchase invoices exist? Determines M8 urgency.
4. Cross-feature rule cover type-only/component imports or only actions?
