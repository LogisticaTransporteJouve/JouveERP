-- The nota de crédito interna that settles a billed remito
-- (docs/otras-ventas.md §4–5): once the factura of Ventas is emitted, the
-- remito must stay credited, whatever happens to that NC afterwards, and
-- "Reintentar acreditación" (settle_billed_remito again) must be able to
-- recover it. One transaction, rolled back.

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000006c0f1', true, '20999999992', 'Cliente Ventas NC', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000006c0a1', false, null, 'Cliente Otras ventas NC', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000006ac01', 'Caja NC Test', 'cash', 'ARS');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000006e0a1', 'jouve_internal', '00000000-0000-0000-0000-00000006c0a1',
   'factura', null, 9001, 99980, current_date, 2, 99, '0', 1000, 0, 1000, 'emitted', 'nc-remito-1'),
  ('00000000-0000-0000-0000-00000006e0a2', 'jouve_internal', '00000000-0000-0000-0000-00000006c0a1',
   'factura', null, 9001, 99981, current_date, 2, 99, '0', 800, 0, 800, 'emitted', 'nc-remito-2');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, source_remito_id)
values
  ('00000000-0000-0000-0000-00000006e0f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000006c0f1',
   'factura', 'A', 3, null, current_date, 2, 80, '20999999992', 1000, 210, 1210, 1, 1,
   'draft', 'nc-factura-1', '00000000-0000-0000-0000-00000006e0a1'),
  ('00000000-0000-0000-0000-00000006e0f2', 'jouve_fiscal', '00000000-0000-0000-0000-00000006c0f1',
   'factura', 'A', 3, null, current_date, 2, 80, '20999999992', 800, 168, 968, 1, 1,
   'draft', 'nc-factura-2', '00000000-0000-0000-0000-00000006e0a2');
update public.invoices set status = 'emitted', numero = 99980
 where id = '00000000-0000-0000-0000-00000006e0f1';
update public.invoices set status = 'emitted', numero = 99981
 where id = '00000000-0000-0000-0000-00000006e0f2';

create temp table t_nc on commit drop as
select public.settle_billed_remito('00000000-0000-0000-0000-00000006e0f1') as nc1,
       public.settle_billed_remito('00000000-0000-0000-0000-00000006e0f2') as nc2;

-- 1. The settlement NC, once numbered, cannot be anulado: that would reopen a
-- remito whose sale already counts on the factura.
update public.invoices set status = 'emitted', numero = 99982
 where id = (select nc1 from t_nc);
select throws_ok(
  format($$update public.invoices set status = 'cancelled' where id = %L$$, (select nc1 from t_nc)),
  '23514', null,
  'the NC that settles a billed remito cannot be anulado');
select is(
  public.invoice_open_amount('00000000-0000-0000-0000-00000006e0a1'),
  0::numeric, 'the billed remito stays credited');

-- 2. An NC whose issue failed (issue-invoice onFailure) leaves the remito open;
-- the retry must issue it again instead of returning the failed one.
update public.invoices set status = 'failed'
 where id = (select nc2 from t_nc);
create temp table t_retry on commit drop as
select public.settle_billed_remito('00000000-0000-0000-0000-00000006e0f2') as nc;
select ok(
  (select status in ('draft', 'emitting', 'emitted') from public.invoices
    where id = (select nc from t_retry)),
  'a retry after the NC failed leaves a live NC to issue');
select is(
  public.invoice_open_amount('00000000-0000-0000-0000-00000006e0a2'),
  0::numeric, 'after the retry the remito is credited');

-- The freeze: while the NC failed, no other NC or cobro may slip in.
select throws_ok(
  $$select public.create_receipt('jouve_internal', 9001, 99983, '00000000-0000-0000-0000-00000006c0a1',
      current_date, 100, 'ARS', 'cobro sobre un remito facturado',
      '[{"account_id":"00000000-0000-0000-0000-00000006ac01","amount":100}]'::jsonb,
      '[{"invoice_id":"00000000-0000-0000-0000-00000006e0a2","amount_applied":100}]'::jsonb,
      '[]'::jsonb)$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a remito whose settlement NC failed is still frozen');

select * from finish();
rollback;
