-- Audit w12 S1 (20261104194000-194001): one void rule for cargas,
-- liquidaciones and storage (billing_invoice_is_void); a carga whose fiscal
-- factura is credited in full is freed by its claim, can be edited, and
-- reads void in the list; a billed carga keeps its live invoice and only the
-- billing roles link one; a liquidación credited by an internal NC is not
-- cancelled; the storage claim returns the runs it relinked. Every
-- legitimate writer of shipments.invoice_id still works. One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(33);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000020f1', 'ops@carga-w12.test'),
  ('00000000-0000-0000-0000-0000000020f2', 'admin@carga-w12.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000020f1', 'operations'),
  ('00000000-0000-0000-0000-0000000020f2', 'admin');

-- c1: Ventas; c2: Otras ventas.
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000020cc01', true, '30777777778', 'Cliente fiscal w12', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000020cc02', false, null, 'Cliente interno w12', null);

-- Fiscal facturas of c1: f1 credited in full, f2 in part, f3 live, f7 billed
-- by a liquidación and credited in full.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000020df01', 'jouve_fiscal', '00000000-0000-0000-0000-00000020cc01',
   'factura', 'A', 3, 98201, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'carga-w12-f1'),
  ('00000000-0000-0000-0000-00000020df02', 'jouve_fiscal', '00000000-0000-0000-0000-00000020cc01',
   'factura', 'A', 3, 98202, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'carga-w12-f2'),
  ('00000000-0000-0000-0000-00000020df03', 'jouve_fiscal', '00000000-0000-0000-0000-00000020cc01',
   'factura', 'A', 3, 98203, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'carga-w12-f3'),
  ('00000000-0000-0000-0000-00000020df07', 'jouve_fiscal', '00000000-0000-0000-0000-00000020cc01',
   'factura', 'A', 3, 98207, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'carga-w12-f7');

-- Internal remitos of c2: f4 credited in full by an internal NC, f5 a draft
-- that fails later, f6 a draft that is deleted, f8 billed by a liquidación.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000020df04', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'factura', null, 9001, 98204, current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'carga-w12-f4'),
  ('00000000-0000-0000-0000-00000020df05', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'factura', null, 9001, null, current_date, 2, 99, '0', 100, 0, 100, 'draft', 'carga-w12-f5'),
  ('00000000-0000-0000-0000-00000020df06', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'factura', null, 9001, null, current_date, 2, 99, '0', 100, 0, 100, 'draft', 'carga-w12-f6'),
  ('00000000-0000-0000-0000-00000020df08', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'factura', null, 9001, 98208, current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'carga-w12-f8');

-- Cargas, linked while their invoice was live (as «Facturar flete» does):
-- k1 → f1, k2 → f2, k3 → f3, k4 → f4, k5 → f5, k6 unbilled, k7 → f6;
-- k8 and k9 go into liquidaciones.
insert into public.shipments (id, client_id, freight_amount, status, invoice_id) values
  ('00000000-0000-0000-0000-00000020ab01', '00000000-0000-0000-0000-00000020cc01', 100, 'delivered',
   '00000000-0000-0000-0000-00000020df01'),
  ('00000000-0000-0000-0000-00000020ab02', '00000000-0000-0000-0000-00000020cc01', 100, 'delivered',
   '00000000-0000-0000-0000-00000020df02'),
  ('00000000-0000-0000-0000-00000020ab03', '00000000-0000-0000-0000-00000020cc01', 100, 'delivered',
   '00000000-0000-0000-0000-00000020df03'),
  ('00000000-0000-0000-0000-00000020ab04', '00000000-0000-0000-0000-00000020cc02', 100, 'delivered',
   '00000000-0000-0000-0000-00000020df04'),
  ('00000000-0000-0000-0000-00000020ab05', '00000000-0000-0000-0000-00000020cc02', 100, 'delivered',
   '00000000-0000-0000-0000-00000020df05'),
  ('00000000-0000-0000-0000-00000020ab06', '00000000-0000-0000-0000-00000020cc01', 100, 'delivered', null),
  ('00000000-0000-0000-0000-00000020ab07', '00000000-0000-0000-0000-00000020cc02', 100, 'delivered',
   '00000000-0000-0000-0000-00000020df06'),
  ('00000000-0000-0000-0000-00000020ab08', '00000000-0000-0000-0000-00000020cc02', 100, 'delivered', null),
  ('00000000-0000-0000-0000-00000020ab09', '00000000-0000-0000-0000-00000020cc01', 100, 'delivered', null);

-- Liquidaciones: s1 internal (c2, k8), s2 fiscal (c1, k9), confirmed and
-- linked to their invoice by the RPC.
insert into public.freight_settlements (id, client_id, period_start, period_end, total) values
  ('00000000-0000-0000-0000-00000020a501', '00000000-0000-0000-0000-00000020cc02', '1996-01-01', '1996-01-31', 100),
  ('00000000-0000-0000-0000-00000020a502', '00000000-0000-0000-0000-00000020cc01', '1996-01-01', '1996-01-31', 100);
insert into public.freight_settlement_items (settlement_id, shipment_id, amount, price_source) values
  ('00000000-0000-0000-0000-00000020a501', '00000000-0000-0000-0000-00000020ab08', 100, 'freight'),
  ('00000000-0000-0000-0000-00000020a502', '00000000-0000-0000-0000-00000020ab09', 100, 'freight');
update public.freight_settlements set status = 'confirmed', channel = 'internal'
 where id = '00000000-0000-0000-0000-00000020a501';
update public.freight_settlements
   set status = 'confirmed', channel = 'fiscal', remito_pos = 9002, remito_number = 99999901
 where id = '00000000-0000-0000-0000-00000020a502';
select public.link_freight_settlement_invoice(
  '00000000-0000-0000-0000-00000020a501', '00000000-0000-0000-0000-00000020df08');
select public.link_freight_settlement_invoice(
  '00000000-0000-0000-0000-00000020a502', '00000000-0000-0000-0000-00000020df07');

-- The NCs, emitted after the links.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000020de01', 'jouve_fiscal', '00000000-0000-0000-0000-00000020cc01',
   'nc', 'A', 3, 98211, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'carga-w12-nc1', '00000000-0000-0000-0000-00000020df01'),
  ('00000000-0000-0000-0000-00000020de02', 'jouve_fiscal', '00000000-0000-0000-0000-00000020cc01',
   'nc', 'A', 3, 98212, current_date, 2, 80, '30777777778', 50, 0, 50, 'PES', 1, 3, 1,
   'emitted', 'carga-w12-nc2', '00000000-0000-0000-0000-00000020df02'),
  ('00000000-0000-0000-0000-00000020de07', 'jouve_fiscal', '00000000-0000-0000-0000-00000020cc01',
   'nc', 'A', 3, 98217, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'carga-w12-nc7', '00000000-0000-0000-0000-00000020df07');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000020de04', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'nc', null, 9001, 98214, current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'carga-w12-nc4',
   '00000000-0000-0000-0000-00000020df04'),
  ('00000000-0000-0000-0000-00000020de08', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'nc', null, 9001, 98218, current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'carga-w12-nc8',
   '00000000-0000-0000-0000-00000020df08');

-- Storage: a run left pending an hour ago whose invoice (under its id) is
-- live, and a run linked on the normal path, also keyed by its id.
insert into public.storage_billing_runs
  (id, client_id, channel_id, period_start, period_end, total, pending_since)
values
  ('00000000-0000-0000-0000-00000020ee01', '00000000-0000-0000-0000-00000020cc02', 'jouve_internal',
   '1996-01-01', '1996-01-31', 100, now() - interval '1 hour');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000020d901', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'factura', null, 9001, null, current_date, 2, 99, '0', 100, 0, 100, 'draft',
   '00000000-0000-0000-0000-00000020ee01'),
  ('00000000-0000-0000-0000-00000020d902', 'jouve_internal', '00000000-0000-0000-0000-00000020cc02',
   'factura', null, 9001, null, current_date, 2, 99, '0', 100, 0, 100, 'draft',
   '00000000-0000-0000-0000-00000020ee02');
insert into public.invoice_items
  (invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total)
values
  ('00000000-0000-0000-0000-00000020d901', 'Almacenaje', 1, 100, 3, 100, 0, 100),
  ('00000000-0000-0000-0000-00000020d902', 'Almacenaje', 1, 100, 3, 100, 0, 100);
insert into public.storage_billing_runs
  (id, client_id, channel_id, period_start, period_end, total, invoice_id)
values
  ('00000000-0000-0000-0000-00000020ee02', '00000000-0000-0000-0000-00000020cc02', 'jouve_internal',
   '1996-02-01', '1996-02-29', 100, '00000000-0000-0000-0000-00000020d902');

-- 1. The rule ---------------------------------------------------------------------------

select ok(
  public.billing_invoice_is_void('00000000-0000-0000-0000-00000020df01')
  and not public.billing_invoice_is_void('00000000-0000-0000-0000-00000020df02')
  and not public.billing_invoice_is_void('00000000-0000-0000-0000-00000020df03')
  and not public.billing_invoice_is_void('00000000-0000-0000-0000-00000020df04')
  and public.billing_invoice_is_void('00000000-0000-0000-0000-0000000020ff') is null,
  'void: a fiscal factura credited in full; not in part, not live, not an internal NC; null for none'
);

select ok(
  public.storage_invoice_is_void('00000000-0000-0000-0000-00000020df01')
  and not public.storage_invoice_is_void('00000000-0000-0000-0000-00000020df04'),
  'storage_invoice_is_void answers the same rule'
);

select is(
  (select array_agg(id order by id) from public.billing_void_invoice_ids(array[
     '00000000-0000-0000-0000-00000020df01', '00000000-0000-0000-0000-00000020df01',
     '00000000-0000-0000-0000-00000020df02', '00000000-0000-0000-0000-00000020df03',
     '00000000-0000-0000-0000-00000020df04']::uuid[]) as id),
  array['00000000-0000-0000-0000-00000020df01'::uuid],
  'billing_void_invoice_ids answers the void ones, once each'
);

-- 2. As operations: a live link stays, a void one frees the carga --------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000020f1","role":"authenticated"}', true);

select throws_ok(
  $$update public.shipments set invoice_id = null
     where id = '00000000-0000-0000-0000-00000020ab03'$$,
  '55006',
  'La carga ya tiene su factura: no se desvincula ni se cambia mientras esa factura esté vigente.',
  'operations does not clear a live link'
);

select throws_ok(
  $$update public.shipments set invoice_id = null, freight_amount = 1,
       client_id = '00000000-0000-0000-0000-00000020cc02'
     where id = '00000000-0000-0000-0000-00000020ab03'$$,
  '55006',
  'La carga ya tiene su factura: no se desvincula ni se cambia mientras esa factura esté vigente.',
  'nor clears it to change the client and flete in the same statement'
);

select throws_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000020df02'
     where id = '00000000-0000-0000-0000-00000020ab03'$$,
  '55006',
  'La carga ya tiene su factura: no se desvincula ni se cambia mientras esa factura esté vigente.',
  'nor swaps it for another'
);

select throws_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000020df03'
     where id = '00000000-0000-0000-0000-00000020ab06'$$,
  '42501',
  'Solo administración o finanzas vinculan la factura de una carga.',
  'operations does not link an invoice'
);

select lives_ok(
  $$update public.shipments set notes = 'revisada', invoice_id = invoice_id
     where id = '00000000-0000-0000-0000-00000020ab03'$$,
  'a full-row PATCH that keeps the invoice still passes'
);

select throws_ok(
  $$update public.shipments set freight_amount = 5
     where id = '00000000-0000-0000-0000-00000020ab03'$$,
  '55006',
  'La carga ya está facturada: para cambiar cliente, canal, ruta o flete, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.',
  'a carga with a live factura keeps its flete'
);

select throws_ok(
  $$delete from public.shipments where id = '00000000-0000-0000-0000-00000020ab02'$$,
  '55006',
  'La carga ya está facturada: para borrarla, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.',
  'a carga whose factura is credited in part is not deleted'
);

select throws_ok(
  $$update public.shipments set freight_amount = 5
     where id = '00000000-0000-0000-0000-00000020ab04'$$,
  '55006',
  null,
  'an internal NC does not free a carga'
);

select lives_ok(
  $$update public.shipments set freight_amount = 120
     where id = '00000000-0000-0000-0000-00000020ab01'$$,
  'a carga whose fiscal factura is credited in full can be corrected'
);

-- 3. As admin: the claim frees it, and the credited factura is not linked again --------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000020f2","role":"authenticated"}', true);

create temp table t_claim1 on commit drop as
  select * from public.claim_shipment_for_invoicing('00000000-0000-0000-0000-00000020ab01');

select results_eq(
  $$select claimed, freed_invoice_id from t_claim1$$,
  $$values (true, '00000000-0000-0000-0000-00000020df01'::uuid)$$,
  'the claim frees a carga whose fiscal factura is credited in full, and names it'
);

select ok(
  (select invoice_id is null and invoicing_claimed_at is not null
     from public.shipments where id = '00000000-0000-0000-0000-00000020ab01'),
  'the carga is unlinked and claimed'
);

create temp table t_claim3 on commit drop as
  select * from public.claim_shipment_for_invoicing('00000000-0000-0000-0000-00000020ab03');

select results_eq(
  $$select claimed, freed_invoice_id from t_claim3$$,
  $$values (false, null::uuid)$$,
  'a carga with a live factura is not claimed'
);

select is(
  (select invoice_id from public.shipments where id = '00000000-0000-0000-0000-00000020ab03'),
  '00000000-0000-0000-0000-00000020df03'::uuid,
  'and keeps its link'
);

create temp table t_claim1b on commit drop as
  select * from public.claim_shipment_for_invoicing('00000000-0000-0000-0000-00000020ab01');

select is(
  (select claimed from t_claim1b),
  false,
  'a fresh claim is not claimed twice'
);

create temp table t_claim2 on commit drop as
  select * from public.claim_shipment_for_invoicing('00000000-0000-0000-0000-00000020ab02');

select is(
  (select claimed from t_claim2),
  false,
  'nor a carga whose factura is credited in part'
);

select throws_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000020df01'
     where id = '00000000-0000-0000-0000-00000020ab01'$$,
  '55006',
  'La factura del flete tiene notas de crédito por el total: volvé a facturar la carga.',
  'a factura credited in full is not linked again'
);

select lives_ok(
  $$update public.shipments
       set invoice_id = '00000000-0000-0000-0000-00000020df03', invoicing_claimed_at = null
     where id = '00000000-0000-0000-0000-00000020ab01'$$,
  'admin links the claimed carga to a live factura of its client'
);

select throws_ok(
  $$select * from public.claim_shipment_for_invoicing('00000000-0000-0000-0000-00000020ab09')$$,
  '55006',
  null,
  'a carga billed by a liquidación is not freed by its own claim'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 4. Liquidaciones ---------------------------------------------------------------------

select throws_ok(
  $$select public.cancel_freight_settlement('00000000-0000-0000-0000-00000020a501', null)$$,
  '55006',
  'La liquidación está facturada: antes de cancelarla, anulá el remito si es interno, o emití una nota de crédito por el total si la factura es fiscal.',
  'a liquidación whose remito interno has an internal NC for the total is not cancelled'
);

select lives_ok(
  $$select public.cancel_freight_settlement('00000000-0000-0000-0000-00000020a502', null)$$,
  'a liquidación whose fiscal factura is credited in full is cancelled'
);

select is(
  (select invoice_id from public.shipments where id = '00000000-0000-0000-0000-00000020ab09'),
  null,
  'and its carga drops the link'
);

-- 5. The other writers still work -----------------------------------------------------

select lives_ok(
  $$update public.invoices set status = 'failed' where id = '00000000-0000-0000-0000-00000020df05'$$,
  'a draft linked to a carga still fails'
);

select is(
  (select invoice_id from public.shipments where id = '00000000-0000-0000-0000-00000020ab05'),
  null,
  'and release_invoice_billing_links frees the carga'
);

select lives_ok(
  $$delete from public.invoices where id = '00000000-0000-0000-0000-00000020df06'$$,
  'a draft linked to a carga is still deleted'
);

select is(
  (select invoice_id from public.shipments where id = '00000000-0000-0000-0000-00000020ab07'),
  null,
  'and the carga drops the link'
);

select lives_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000020df03'
     where id = '00000000-0000-0000-0000-00000020ab06'$$,
  'the service role links a live factura'
);

-- 6. Storage: the claim names the runs it relinked ------------------------------------

create temp table t_storage on commit drop as
  select * from public.claim_storage_billing_period_with_relinks(
    '00000000-0000-0000-0000-00000020cc02', 'jouve_internal', '1996-03-01', '1996-03-31');

select ok(
  (select run_id is not null from t_storage),
  'a free period is claimed'
);

select is(
  (select relinked_run_ids from t_storage),
  array['00000000-0000-0000-0000-00000020ee01'::uuid],
  'and only the stale run it relinked is returned, not the one linked on the normal path'
);

select is(
  public.claim_storage_billing_period(
    '00000000-0000-0000-0000-00000020cc02', 'jouve_internal', '1996-04-01', '1996-04-30') is not null,
  true,
  'the old claim still answers a run id'
);

-- 7. Privileges -----------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.claim_shipment_for_invoicing(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_shipment_for_invoicing(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.billing_void_invoice_ids(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.billing_void_invoice_ids(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.billing_invoice_is_void(uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.claim_storage_billing_period_with_relinks(uuid, text, date, date)', 'execute')
  and not has_function_privilege('anon',
    'public.claim_storage_billing_period_with_relinks(uuid, text, date, date)', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_billed_shipment()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_shipment_invoice()', 'execute'),
  'the claims and the void list are callable by signed-in users only; the guards are not'
);

select * from finish();
rollback;
