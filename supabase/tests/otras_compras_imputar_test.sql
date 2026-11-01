-- Imputing remitos internos de compra to a fiscal purchase factura
-- (docs/otras-ventas.md §6): each remito is credited by an NC interna linked
-- to the factura, its internal payment orders pass to the factura, the remito
-- stays frozen while the factura is live, and anulando the factura un-imputes.
-- One transaction, rolled back.

begin;

select plan(27);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000750f1', true, '30999999994', 'Proveedor Compras Imp', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-0000000750a1', false, null, 'Proveedor Otras compras Imp', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000007ac01', 'Caja Imp Test', 'cash', 'ARS');

-- Two remitos internos (1000 paid by an OP, 500 unpaid) and a fiscal factura.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000770a1', 'jouve_internal', '00000000-0000-0000-0000-0000000750a1',
   'factura', null, 1, 1, current_date, 1000, 1000, 'received'),
  ('00000000-0000-0000-0000-0000000770a2', 'jouve_internal', '00000000-0000-0000-0000-0000000750a1',
   'factura', null, 1, 2, current_date, 500, 500, 'received'),
  ('00000000-0000-0000-0000-0000000770a3', 'jouve_internal', '00000000-0000-0000-0000-0000000750a1',
   'factura', null, 1, 3, current_date, 400, 400, 'received'),
  ('00000000-0000-0000-0000-0000000770f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000000750f1',
   'factura', 'A', 7, 41, current_date, 1500, 1815, 'received');

create temp table t_op on commit drop as
select public.create_payment_order(
  'jouve_internal', 9001,
  (select coalesce(max(numero), 0) + 1 from public.payment_orders
    where channel_id = 'jouve_internal' and punto_venta = 9001),
  '00000000-0000-0000-0000-0000000750a1', current_date, 1000, 'ARS', null,
  '[{"account_id":"00000000-0000-0000-0000-00000007ac01","amount":1000}]'::jsonb,
  '[{"purchase_invoice_id":"00000000-0000-0000-0000-0000000770a1","amount_applied":1000}]'::jsonb,
  null) as id;

-- 1. Only the imputation links an NC to a factura.
select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
       imp_neto, imp_total, status, invoice_origin_id, imputed_to_id)
    values ('jouve_internal', '00000000-0000-0000-0000-0000000750a1', 'nc', null, 1, 90,
            current_date, 1, 1, 'received', '00000000-0000-0000-0000-0000000770a3',
            '00000000-0000-0000-0000-0000000770f1')$$,
  '23514', 'Solo la imputación de remitos vincula una nota de crédito a una factura.',
  'an NC cannot be linked to a factura by hand');

-- 2. What is refused before anything moves.
select throws_ok(
  $$select public.impute_purchase_remitos('00000000-0000-0000-0000-0000000770a1',
      array['00000000-0000-0000-0000-0000000770a2']::uuid[], null)$$,
  '23514', 'Solo se imputan remitos a una factura de Compras recibida.',
  'the target must be a fiscal factura');
select throws_ok(
  $$select public.impute_purchase_remitos('00000000-0000-0000-0000-0000000770f1',
      array['00000000-0000-0000-0000-0000000770f1']::uuid[], null)$$,
  '23514', 'Solo se imputan remitos internos de compra recibidos.',
  'only internal remitos are imputed');
select throws_ok(
  $$select public.impute_purchase_remitos('00000000-0000-0000-0000-0000000770f1',
      array['00000000-0000-0000-0000-0000000770a1','00000000-0000-0000-0000-0000000770a2',
            '00000000-0000-0000-0000-0000000770a3']::uuid[], null)$$,
  '23514', 'Los remitos suman más que la factura: revisá cuáles imputar.',
  'remitos adding up to more than the factura are refused');
select throws_ok(
  $$select public.impute_purchase_remitos('00000000-0000-0000-0000-0000000770f1',
      '{}'::uuid[], null)$$,
  '23514', 'Elegí al menos un remito.',
  'an empty selection is refused');

-- 3. The blocker.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000770b1', 'jouve_internal', '00000000-0000-0000-0000-0000000750a1',
   'factura', null, 1, 10, current_date, 400, 400, 'received');
create temp table t_op_split on commit drop as
select public.create_payment_order(
  'jouve_internal', 9001,
  (select coalesce(max(numero), 0) + 1 from public.payment_orders
    where channel_id = 'jouve_internal' and punto_venta = 9001),
  '00000000-0000-0000-0000-0000000750a1', current_date, 300, 'ARS', null,
  '[{"account_id":"00000000-0000-0000-0000-00000007ac01","amount":300}]'::jsonb,
  '[{"purchase_invoice_id":"00000000-0000-0000-0000-0000000770b1","amount_applied":200},
    {"purchase_invoice_id":"00000000-0000-0000-0000-0000000770a3","amount_applied":100}]'::jsonb,
  null) as id;
select is(
  public.purchase_remito_blocker('00000000-0000-0000-0000-0000000770b1'),
  'Una orden de pago de este remito también paga otros comprobantes: anulala, imputá el remito y cargá el pago en Compras.',
  'an OP that also pays another remito blocks');
update public.payment_orders set status = 'canceled', canceled_at = now()
 where id = (select id from t_op_split);
create temp table t_op_acuenta on commit drop as
select public.create_payment_order(
  'jouve_internal', 9001,
  (select coalesce(max(numero), 0) + 1 from public.payment_orders
    where channel_id = 'jouve_internal' and punto_venta = 9001),
  '00000000-0000-0000-0000-0000000750a1', current_date, 300, 'ARS', null,
  '[{"account_id":"00000000-0000-0000-0000-00000007ac01","amount":300}]'::jsonb,
  '[{"purchase_invoice_id":"00000000-0000-0000-0000-0000000770b1","amount_applied":200}]'::jsonb,
  null) as id;
select is(
  public.purchase_remito_blocker('00000000-0000-0000-0000-0000000770b1'),
  'Una orden de pago de este remito tiene saldo a cuenta: anulala, imputá el remito y cargá el pago en Compras.',
  'an OP with a saldo a cuenta blocks');
update public.payment_orders set status = 'canceled', canceled_at = now()
 where id = (select id from t_op_acuenta);
select is(public.purchase_remito_blocker('00000000-0000-0000-0000-0000000770b1'), null,
  'a remito with only cancelled OPs is imputable');
select is(public.purchase_remito_blocker('00000000-0000-0000-0000-0000000770a1'), null,
  'a remito paid whole by its own OP is imputable');

-- 4. Imputing.
create temp table t_nc on commit drop as
select public.impute_purchase_remitos(
  '00000000-0000-0000-0000-0000000770f1',
  array['00000000-0000-0000-0000-0000000770a1','00000000-0000-0000-0000-0000000770a2']::uuid[],
  null) as ids;

select is(cardinality((select ids from t_nc)), 2, 'one NC per remito');
select is(
  (select open_amount from public.v_purchase_invoice_open
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000770a1'), 0::numeric,
  'the paid remito is left at 0');
select is(
  (select open_amount from public.v_purchase_invoice_open
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000770a2'), 0::numeric,
  'the unpaid remito is credited whole');
select is(
  (select status from public.payment_orders where id = (select id from t_op)), 'canceled',
  'the internal OP is anulada');
select is(
  (select count(*)::int from public.transactions where payment_order_id = (select id from t_op)), 0,
  'its treasury movements go with it');
select is(
  (select sum(poa.amount_applied) from public.payment_order_allocations poa
     join public.payment_orders po on po.id = poa.payment_order_id
    where poa.purchase_invoice_id = '00000000-0000-0000-0000-0000000770f1'
      and po.status = 'issued' and po.channel_id = 'jouve_fiscal'), 1000::numeric,
  'the payment passes to the factura on the fiscal side');
select is(
  (select open_amount from public.v_purchase_invoice_open
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000770f1'), 815::numeric,
  'the factura is owed only what was not paid');
select is(
  (select count(*)::int from public.purchase_invoices
    where imputed_to_id = '00000000-0000-0000-0000-0000000770f1' and kind = 'nc'
      and channel_id = 'jouve_internal'), 2,
  'the NCs are internal and linked to the factura');

select throws_ok(
  $$update public.purchase_invoices set imp_total = 1000, imp_neto = 1000
     where id = '00000000-0000-0000-0000-0000000770f1'$$,
  '23514', 'La factura tiene remitos imputados por más que ese total.',
  'the factura keeps room for its imputed remitos');

-- A second call counts the remitos already imputed (1500 + 400 > 1815).
select throws_ok(
  $$select public.impute_purchase_remitos('00000000-0000-0000-0000-0000000770f1',
      array['00000000-0000-0000-0000-0000000770a3']::uuid[], null)$$,
  '23514', 'Los remitos suman más que la factura: revisá cuáles imputar.',
  'a second imputation counts the remitos already imputed');
select is(
  (select blocker from public.purchase_remito_blockers(
     array['00000000-0000-0000-0000-0000000770a3']::uuid[])),
  null, 'the picker reads each remito''s blocker');

-- 5. Frozen while the factura is live.
select throws_ok(
  $$update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
     where id = '00000000-0000-0000-0000-0000000770a2'$$,
  '23514', 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.',
  'an imputed remito cannot be anulado');
select throws_ok(
  $$update public.purchase_invoices set imp_total = 900, imp_neto = 900
     where id = '00000000-0000-0000-0000-0000000770a2'$$,
  '23514', 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.',
  'an imputed remito keeps its amounts');
select throws_ok(
  format($$update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
     where id = %L$$, (select ids[1] from t_nc)),
  '23514', 'Esta nota de crédito acredita un remito imputado a una factura de Compras: no se puede cambiar ni anular mientras la factura esté vigente.',
  'the imputation NC cannot be anulada');
select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
       imp_neto, imp_total, status, invoice_origin_id)
    values ('jouve_internal', '00000000-0000-0000-0000-0000000750a1', 'nd', null, 1, 91,
            current_date, 1, 1, 'received', '00000000-0000-0000-0000-0000000770a2')$$,
  '23514', 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.',
  'an imputed remito takes no ND');
select throws_ok(
  $$select public.impute_purchase_remitos('00000000-0000-0000-0000-0000000770f1',
      array['00000000-0000-0000-0000-0000000770a2']::uuid[], null)$$,
  '23514', 'Un remito ya está imputado a otra factura.',
  'a remito is imputed once');

-- 6. Anulando the factura (after its OP) un-imputes the remitos.
update public.payment_orders set status = 'canceled', canceled_at = now()
 where channel_id = 'jouve_fiscal' and status = 'issued'
   and id in (select payment_order_id from public.payment_order_allocations
               where purchase_invoice_id = '00000000-0000-0000-0000-0000000770f1');
update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000000770f1';
select is(
  (select count(*)::int from public.purchase_invoices
    where imputed_to_id = '00000000-0000-0000-0000-0000000770f1' and status = 'cancelled'), 2,
  'the factura''s NCs are anuladas with it');
select is(
  (select open_amount from public.v_purchase_invoice_open
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000770a2'), 500::numeric,
  'the remito is owed again on the internal side');

select * from finish();
rollback;
