-- The freeze and the settlement of a billed remito interno after the second
-- review (docs/otras-ventas.md §4–5): the settlement NC cannot be anulada in
-- any status while its factura is live, a failed NC is put back to draft (and
-- only a failed one), a recibo with saldo a cuenta blocks billing at the
-- factura insert and again at settlement, an emitted factura of Ventas is
-- never anulada by status (an NC compensates it), and only a factura that
-- AFIP rejected (or that never left draft) releases the remito. Only the
-- settlement may write the NC the freeze lets through. One transaction,
-- rolled back.

begin;

select plan(23);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000007c0f1', true, '20999999992', 'Cliente Ventas Freeze', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000007c0a1', false, null, 'Cliente Otras ventas Freeze', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000007ac01', 'Caja Freeze Test', 'cash', 'ARS');

-- Remitos 1..6 of the internal client, 500 each.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
select ('00000000-0000-0000-0000-0000000780' || lpad(n::text, 2, '0'))::uuid,
       'jouve_internal', '00000000-0000-0000-0000-00000007c0a1',
       'factura', null, 9001, 99930 + n, current_date, 2, 99, '0',
       500, 0, 500, 'emitted', 'fz-remito-' || n
from generate_series(1, 6) n;

-- The factura of Ventas for remito n, as billRemitoAction drafts it.
create function pg_temp.draft_factura(p_n int) returns uuid language sql as $f$
  insert into public.invoices
    (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
     doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
     iva_condition_receptor, status, idempotency_key, source_remito_id)
  values (('00000000-0000-0000-0000-0000000781' || lpad(p_n::text, 2, '0'))::uuid,
     'jouve_fiscal', '00000000-0000-0000-0000-00000007c0f1', 'factura', 'A', 3, null,
     current_date, 2, 80, '20999999992', 500, 105, 605, 1, 1, 'draft',
     'fz-factura-' || p_n,
     ('00000000-0000-0000-0000-0000000780' || lpad(p_n::text, 2, '0'))::uuid)
  returning id;
$f$;

-- An NC interna on remito n, as issueFiscalInvoiceAction drafts it.
create function pg_temp.draft_nc(p_n int, p_key text, p_amount numeric) returns uuid language sql as $f$
  insert into public.invoices
    (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
     doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key,
     invoice_origin_id, motivo_nc_nd)
  values ('jouve_internal', '00000000-0000-0000-0000-00000007c0a1', 'nc', null, 9001, null,
     current_date, 2, 99, '0', p_amount, 0, p_amount, 'draft', p_key,
     ('00000000-0000-0000-0000-0000000780' || lpad(p_n::text, 2, '0'))::uuid,
     'nota de crédito de prueba')
  returning id;
$f$;

-- 1. The settlement NC cannot be anulada in any status while the factura lives.

select pg_temp.draft_factura(1);
update public.invoices set status = 'emitted', numero = 99931
 where id = '00000000-0000-0000-0000-000000078101';
create temp table t_nc1 on commit drop as
select public.settle_billed_remito('00000000-0000-0000-0000-000000078101') as id;

select is(
  (select status from public.invoices where id = (select id from t_nc1)),
  'draft', 'settling drafts the NC');
select throws_ok(
  format($$update public.invoices set status = 'cancelled' where id = %L$$, (select id from t_nc1)),
  '23514', 'Esta nota de crédito acredita un remito facturado en Ventas: no se puede anular mientras la factura esté vigente.',
  'a drafted settlement NC cannot be anulada');
update public.invoices set status = 'failed' where id = (select id from t_nc1);
select throws_ok(
  format($$update public.invoices set status = 'cancelled' where id = %L$$, (select id from t_nc1)),
  '23514', 'Esta nota de crédito acredita un remito facturado en Ventas: no se puede anular mientras la factura esté vigente.',
  'a failed settlement NC cannot be anulada either');

-- 2. settle_billed_remito resets only a failed NC, and returns the same one.

select is(
  public.settle_billed_remito('00000000-0000-0000-0000-000000078101'),
  (select id from t_nc1), 'a retry returns the failed NC, not a new one');
select is(
  (select status from public.invoices where id = (select id from t_nc1)),
  'draft', 'a retry puts the failed NC back to draft');
select is(
  (select count(*)::int from public.invoices
    where kind = 'nc' and invoice_origin_id = '00000000-0000-0000-0000-000000078001'),
  1, 'the retry drafts no second NC');

update public.invoices set status = 'emitting' where id = (select id from t_nc1);
select public.settle_billed_remito('00000000-0000-0000-0000-000000078101');
select is(
  (select status from public.invoices where id = (select id from t_nc1)),
  'emitting', 'a retry leaves an NC being issued alone');

update public.invoices set status = 'emitted', numero = 99937 where id = (select id from t_nc1);
select is(
  public.settle_billed_remito('00000000-0000-0000-0000-000000078101'),
  (select id from t_nc1), 'a retry on an emitted NC returns it');
select is(
  (select status from public.invoices where id = (select id from t_nc1)),
  'emitted', 'a retry never takes an emitted NC back to draft');

-- 3. A recibo interno with saldo a cuenta blocks billing.

select public.create_receipt('jouve_internal', 9001, 99932, '00000000-0000-0000-0000-00000007c0a1',
  current_date, 600, 'ARS', 'recibo con saldo a cuenta',
  '[{"account_id":"00000000-0000-0000-0000-00000007ac01","amount":600}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000078002","amount_applied":500}]'::jsonb,
  '[]'::jsonb);
select is(
  public.billed_remito_blocker('00000000-0000-0000-0000-000000078002'),
  'Un recibo interno de este remito tiene saldo a cuenta: anulalo, facturá el remito y cargá el cobro en Ventas.',
  'a recibo with saldo a cuenta is a blocker');
select throws_ok(
  $$select pg_temp.draft_factura(2)$$,
  '23514', 'Un recibo interno de este remito tiene saldo a cuenta: anulalo, facturá el remito y cargá el cobro en Ventas.',
  'the factura insert refuses a remito whose recibo has saldo a cuenta');

-- A remainder that appears after drafting (a direct write: the app paths are
-- frozen) is caught when settling, and nothing moves.
create temp table t_r3 on commit drop as
select public.create_receipt('jouve_internal', 9001, 99933, '00000000-0000-0000-0000-00000007c0a1',
  current_date, 300, 'ARS', 'recibo exacto del remito 3',
  '[{"account_id":"00000000-0000-0000-0000-00000007ac01","amount":300}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000078003","amount_applied":300}]'::jsonb,
  '[]'::jsonb) as id;
select lives_ok($$select pg_temp.draft_factura(3)$$, 'a recibo applied in full does not block');
update public.invoices set status = 'emitted', numero = 99933
 where id = '00000000-0000-0000-0000-000000078103';
update public.receipts set total_amount = 350 where id = (select id from t_r3);
select throws_ok(
  $$select public.settle_billed_remito('00000000-0000-0000-0000-000000078103')$$,
  '23514', 'Un recibo interno de este remito tiene saldo a cuenta: anulalo, facturá el remito y cargá el cobro en Ventas.',
  'settling re-checks the saldo a cuenta');
select is(
  (select status from public.receipts where id = (select id from t_r3)),
  'issued', 'a refused settlement leaves the recibo interno in place');

-- 4. An emitted factura of Ventas is never anulada by status, so the remito it
-- billed stays frozen.

select pg_temp.draft_factura(4);
update public.invoices set status = 'emitted', numero = 99934
 where id = '00000000-0000-0000-0000-000000078104';
select throws_ok(
  $$update public.invoices set status = 'cancelled' where id = '00000000-0000-0000-0000-000000078104'$$,
  '22023', null,
  'an emitted factura of Ventas cannot be anulada (an NC compensates it)');
select throws_ok(
  $$select public.create_receipt('jouve_internal', 9001, 99934, '00000000-0000-0000-0000-00000007c0a1',
      current_date, 100, 'ARS', 'cobro sobre un remito facturado',
      '[{"account_id":"00000000-0000-0000-0000-00000007ac01","amount":100}]'::jsonb,
      '[{"invoice_id":"00000000-0000-0000-0000-000000078004","amount_applied":100}]'::jsonb,
      '[]'::jsonb)$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'the remito of an emitted factura stays frozen');

-- 5. A factura in flight at AFIP still freezes; a rejected one releases the
-- remito for an NC, its anulación and the NC's anulación.

select pg_temp.draft_factura(5);
update public.invoices set status = 'emitting'
 where id = '00000000-0000-0000-0000-000000078105';
select throws_ok(
  $$select pg_temp.draft_nc(5, 'fz-nc-5', 100)$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a remito whose factura is being issued takes no NC');
select throws_ok(
  $$update public.invoices set status = 'cancelled' where id = '00000000-0000-0000-0000-000000078005'$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a remito whose factura is being issued cannot be anulado');

update public.invoices set status = 'failed'
 where id = '00000000-0000-0000-0000-000000078105';
create temp table t_nc5 on commit drop as select pg_temp.draft_nc(5, 'fz-nc-5', 100) as id;
select isnt((select id from t_nc5), null, 'a remito whose factura failed takes an NC again');
update public.invoices set status = 'emitted', numero = 99935 where id = (select id from t_nc5);
select lives_ok(
  format($$update public.invoices set status = 'cancelled' where id = %L$$, (select id from t_nc5)),
  'an NC on a released remito can be anulada (the freeze does not over-reach)');
select lives_ok(
  $$update public.invoices set status = 'cancelled' where id = '00000000-0000-0000-0000-000000078005'$$,
  'a remito whose factura failed can be anulado');

-- 6. Only the settlement writes the NC the freeze lets through. An NC drafted
-- through the ordinary path with the factura's id as its (client-chosen)
-- idempotency key, while the factura is still in draft, must be refused like
-- any other NC: otherwise settle_billed_remito adopts it as the settlement
-- NC, whatever its amount, and the remito stays partly open.

select pg_temp.draft_factura(6);
select throws_ok(
  $$select pg_temp.draft_nc(6, '00000000-0000-0000-0000-000000078106', 1)$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'an NC keyed with the factura id, drafted before settling, is refused');
update public.invoices set status = 'emitted', numero = 99936
 where id = '00000000-0000-0000-0000-000000078106';
select public.settle_billed_remito('00000000-0000-0000-0000-000000078106');
select is(
  public.invoice_open_amount('00000000-0000-0000-0000-000000078006'),
  0::numeric, 'after settling, the remito is credited in full');

select * from finish();
rollback;
