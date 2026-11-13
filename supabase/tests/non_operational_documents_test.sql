-- «Corresponde a la actividad de Jouve» (20261112170000/170100): the flag
-- defaults to true; false posts the net to «Cuenta particular de socios»
-- with IVA unchanged; flipping it re-posts; a closed period refuses the flip;
-- the management P&L (accrual and cash) and the AI summaries leave the
-- document out while aging keeps it. One transaction, rolled back.

begin;

select plan(14);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000006a0a01', 'Banco No Jouve', 'bank', 'ARS');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000006a0b01', '30700000771', 'Proveedor Particular', 'responsable_inscripto');
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000006a0c01', true, '30700000772', 'Cliente Particular', 'responsable_inscripto');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000006a0d01', 'jouve_fiscal', '00000000-0000-0000-0000-0000006a0b01',
   'factura', 'A', 7, 1, '1991-03-10', '1991-03-20', 100, 21, 121, 'received');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_iva, imp_total, status, is_operational)
values
  ('00000000-0000-0000-0000-0000006a0d02', 'jouve_fiscal', '00000000-0000-0000-0000-0000006a0b01',
   'factura', 'A', 7, 2, '1991-03-11', '1991-03-21', 200, 42, 242, 'received', false);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, is_operational)
values
  ('00000000-0000-0000-0000-0000006a0e01', 'jouve_fiscal', '00000000-0000-0000-0000-0000006a0c01',
   'factura', 'A', 3, 6901, '1991-03-12', '1991-03-22', 2, 80, '30700000772',
   1000, 210, 1210, 'PES', 1, 1, 1, 'emitted', 'non-op-sale-1', false);

create function pg_temp.posted(p_table text, p_id uuid, p_role text) returns numeric
language sql as $$
  select coalesce(sum(l.credit + l.debit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts a on a.id = l.chart_of_accounts_id
   where je.source_table = p_table and je.source_id = p_id
     and je.id in (select public.current_journal_entries(p_table, p_id))
     and a.system_role::text = p_role;
$$;

-- 1-2: the account and the default ---------------------------------------------------------

select results_eq(
  $$select a.name, a.account_type::text, p.code
      from public.chart_of_accounts a join public.chart_of_accounts p on p.id = a.parent_id
     where a.system_role = 'cuenta_particular_socios' and a.is_active$$,
  $$values ('Cuenta particular de socios'::text, 'activo'::text, '1.1'::text)$$,
  '1. the partners'' account is an active asset under 1.1'
);

select is(
  (select is_operational from public.purchase_invoices where id = '00000000-0000-0000-0000-0000006a0d01'),
  true,
  '2. a document is Jouve''s by default'
);

-- 3-6: posting -------------------------------------------------------------------------------

select results_eq(
  $$select pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000006a0d02', 'cuenta_particular_socios'),
           pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000006a0d02', 'compras'),
           pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000006a0d02', 'iva_credito')$$,
  $$values (200::numeric, 0::numeric, 42::numeric)$$,
  '3. a purchase that is not Jouve''s debits its net to the partners'' account, IVA unchanged'
);

select results_eq(
  $$select pg_temp.posted('invoices', '00000000-0000-0000-0000-0000006a0e01', 'cuenta_particular_socios'),
           pg_temp.posted('invoices', '00000000-0000-0000-0000-0000006a0e01', 'ventas'),
           pg_temp.posted('invoices', '00000000-0000-0000-0000-0000006a0e01', 'iva_debito')$$,
  $$values (1000::numeric, 0::numeric, 210::numeric)$$,
  '4. a sale that is not Jouve''s credits its net to the partners'' account, IVA unchanged'
);

update public.purchase_invoices set is_operational = false
 where id = '00000000-0000-0000-0000-0000006a0d01';
set constraints all immediate;
set constraints all deferred;

select results_eq(
  $$select pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000006a0d01', 'cuenta_particular_socios'),
           pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000006a0d01', 'compras')$$,
  $$values (100::numeric, 0::numeric)$$,
  '5. flipping a purchase to not Jouve''s re-posts it'
);

update public.invoices set is_operational = true
 where id = '00000000-0000-0000-0000-0000006a0e01';
set constraints all immediate;
set constraints all deferred;

select results_eq(
  $$select pg_temp.posted('invoices', '00000000-0000-0000-0000-0000006a0e01', 'ventas'),
           pg_temp.posted('invoices', '00000000-0000-0000-0000-0000006a0e01', 'cuenta_particular_socios')$$,
  $$values (1000::numeric, 0::numeric)$$,
  '6. flipping an emitted sale back to Jouve''s re-posts it to ventas'
);

update public.invoices set is_operational = false
 where id = '00000000-0000-0000-0000-0000006a0e01';
set constraints all immediate;
set constraints all deferred;

-- 7-8: NC/ND follow their origin ---------------------------------------------------------------

create temp table t_pnc as select public.create_purchase_invoice(jsonb_build_object(
      'channel_id', 'jouve_fiscal', 'supplier_id', '00000000-0000-0000-0000-0000006a0b01',
      'kind', 'nc', 'letter', 'A', 'punto_venta', 8, 'numero', 99, 'fecha', '1991-03-15',
      'imp_neto', 50, 'imp_iva', 10.5, 'imp_total', 60.5,
      'invoice_origin_id', '00000000-0000-0000-0000-0000006a0d02')) as id;

select is(
  (select is_operational from public.purchase_invoices where id = (select id from t_pnc)),
  false,
  '7. a purchase NC without the flag follows its origin'
);

create temp table t_snc as select public.create_invoice_draft(
      jsonb_build_object(
        'channel_id', 'jouve_fiscal', 'client_id', '00000000-0000-0000-0000-0000006a0c01',
        'kind', 'nc', 'letter', 'A', 'cbte_tipo_afip', 3, 'punto_venta', 3, 'fecha', '1991-03-16',
        'concepto', 2, 'doc_tipo', 80, 'doc_nro', '30700000772', 'iva_condition_receptor', 1,
        'imp_neto', 100, 'imp_iva', 21, 'imp_trib', 0, 'imp_tot_conc', 0, 'imp_op_ex', 0,
        'imp_total', 121, 'moneda', 'PES', 'cotizacion', 1, 'motivo_nc_nd', 'Prueba',
        'invoice_origin_id', '00000000-0000-0000-0000-0000006a0e01', 'idempotency_key', 'non-op-nc-1'),
      '[{"sort_order":0,"description":"x","quantity":1,"unit_price":100,"iva_rate_id":5,"line_neto":100,"line_iva":21,"line_total":121}]'::jsonb) as id;

select is(
  (select is_operational from public.invoices where id = (select id from t_snc)),
  false,
  '8. a sale NC draft without the flag follows its origin'
);

-- 9-12: reads ---------------------------------------------------------------------------------

select is(
  (select coalesce(sum(amount_ars), 0) from public.management_pnl_lines('1991-03-01', '1991-03-31', 'accrual')
    where source_id in ('00000000-0000-0000-0000-0000006a0d01', '00000000-0000-0000-0000-0000006a0d02',
                        '00000000-0000-0000-0000-0000006a0e01')),
  0::numeric,
  '9. the accrual P&L has no line for them'
);

select public.create_receipt('jouve_fiscal', 1, 6901, '00000000-0000-0000-0000-0000006a0c01',
  '1991-03-25', 1210, 'ARS', 'cobro particular',
  '[{"account_id":"00000000-0000-0000-0000-0000006a0a01","amount":1210}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-0000006a0e01","amount_applied":1210}]'::jsonb,
  '[]'::jsonb);

select is(
  (select coalesce(sum(amount_ars), 0) from public.management_pnl_lines('1991-03-01', '1991-03-31', 'cash')
    where bucket = 'service_revenue'),
  0::numeric,
  '10. on the cash basis, collecting it is no service revenue'
);

select is(
  (select count(*)::int from public.ai_client_net_revenue('1991-03-01', '1991-03-31')
    where client_id = '00000000-0000-0000-0000-0000006a0c01'),
  0,
  '11. the AI net revenue leaves it out'
);

select is(
  (select coalesce(sum(purchased_ars), 0) from public.ai_supplier_purchases_summary('1991-03-01', '1991-03-31',
     '00000000-0000-0000-0000-0000006a0b01')),
  0::numeric,
  '12. the AI purchases summary leaves them out'
);

select ok(
  exists (select 1 from public.v_supplier_aging_documents
           where purchase_invoice_id = '00000000-0000-0000-0000-0000006a0d02'),
  '13. the purchase stays in the supplier aging'
);

-- 14: closed period ----------------------------------------------------------------------------

insert into public.accounting_closed_periods (period) values ('1991-03');

select throws_ok(
  $$update public.purchase_invoices set is_operational = true
     where id = '00000000-0000-0000-0000-0000006a0d02'$$,
  '55006', null,
  '14. a closed accounting period refuses the flip'
);

select * from finish();

rollback;
