-- Segregated channels (20261111205000..205400): the predicate, the dz_fiscal
-- row, the channel accounts in the builders and their guards, the views and
-- searches that leave a segregated channel out unless asked for it, the
-- party predicate (the same for a role that cannot read purchases), the
-- reports, Resultado de gestión, tasks, the aging snapshot, the tax payment's
-- channel pick and channel_summary. The libro IVA keeps the channel. One
-- transaction, rolled back.

begin;

select plan(42);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000005e9001', 'owner@segregated.test'),
  ('00000000-0000-0000-0000-0000005e9002', 'ops@segregated.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000005e9001', 'owner'),
  ('00000000-0000-0000-0000-0000005e9002', 'operations');

-- 1-3: predicate and row ------------------------------------------------------------------

select results_eq(
  $$select public.channel_in_main_scope(null), public.channel_in_main_scope('jouve_fiscal'),
           public.channel_in_main_scope('dz_fiscal')$$,
  $$values (true, true, false)$$,
  '1. NULL and a main channel are in the main scope; a segregated one is not'
);

select results_eq(
  $$select c.name, c.is_fiscal, c.is_active, c.is_segregated, c.division_label, c.short_label,
           s.code, s.name, p.code, p.name
      from public.invoicing_channels c
      join public.chart_of_accounts s on s.id = c.sales_account_id
      join public.chart_of_accounts p on p.id = c.purchase_account_id
     where c.id = 'dz_fiscal'$$,
  $$values ('DZ Instalaciones'::text, true, false, true, 'DZ Instalaciones'::text, 'DZ'::text,
            '4.1.2'::text, 'Venta de productos (Instalaciones)'::text,
            '5.1.2'::text, 'Costo de mercadería vendida (Instalaciones)'::text)$$,
  '2. dz_fiscal is fiscal, segregated, inactive, with its labels and its own accounts'
);

select ok(
  not exists (select 1 from public.invoicing_channels where is_segregated and id <> 'dz_fiscal')
  and not exists (select 1 from public.invoicing_channels
                   where id in ('jouve_fiscal', 'jouve_internal')
                     and (sales_account_id is not null or purchase_account_id is not null)),
  '3. the main channels keep posting to the roles'
);

-- Fixtures: the channel active, as the later data step leaves it ---------------------------

update public.invoicing_channels set is_active = true where id = 'dz_fiscal';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000005e9a01', 'Banco Segregado', 'bank', 'ARS');

insert into public.suppliers (id, cuit, legal_name, iva_condition, default_channel_id) values
  ('00000000-0000-0000-0000-0000005e9b01', '30700000011', 'Solo DZ', 'responsable_inscripto', 'dz_fiscal'),
  ('00000000-0000-0000-0000-0000005e9b02', '30700000022', 'Mixto', 'responsable_inscripto', null),
  ('00000000-0000-0000-0000-0000005e9b03', '30700000033', 'Solo Jouve', 'responsable_inscripto', null),
  ('00000000-0000-0000-0000-0000005e9b04', '30700000044', 'DZ sin comprobantes', 'responsable_inscripto', 'dz_fiscal');
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000005e9c01', true, '30700000055', 'Cliente DZ', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-0000005e9c02', true, '30700000066', 'Cliente Jouve', 'responsable_inscripto');

create temporary table t_leaf as
  select id from public.expense_leaf_accounts order by code limit 1;

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_iva, imp_total, status, account_id)
values
  ('00000000-0000-0000-0000-0000005e9d01', 'dz_fiscal', '00000000-0000-0000-0000-0000005e9b01',
   'factura', 'A', 1, 1, current_date - 20, current_date - 10, 100, 21, 121, 'received', null),
  ('00000000-0000-0000-0000-0000005e9d02', 'dz_fiscal', '00000000-0000-0000-0000-0000005e9b02',
   'factura', 'A', 1, 2, current_date - 20, current_date - 10, 100, 21, 121, 'received',
   (select id from t_leaf)),
  ('00000000-0000-0000-0000-0000005e9d03', 'jouve_fiscal', '00000000-0000-0000-0000-0000005e9b02',
   'factura', 'A', 1, 3, current_date - 20, current_date - 10, 50, 0, 50, 'received', null),
  ('00000000-0000-0000-0000-0000005e9d04', 'jouve_fiscal', '00000000-0000-0000-0000-0000005e9b03',
   'factura', 'A', 1, 4, current_date - 20, current_date - 10, 70, 0, 70, 'received', null);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000005e9e01', 'dz_fiscal', '00000000-0000-0000-0000-0000005e9c01',
   'factura', 'A', 10, 5901, current_date - 20, current_date - 10, 1, 80, '30700000055',
   1000, 210, 1210, 'PES', 1, 1, 1, 'emitted', 'segregated-dz-1'),
  ('00000000-0000-0000-0000-0000005e9e02', 'jouve_fiscal', '00000000-0000-0000-0000-0000005e9c02',
   'factura', 'A', 3, 5902, current_date - 20, current_date - 10, 2, 80, '30700000066',
   500, 105, 605, 'PES', 1, 1, 1, 'emitted', 'segregated-jouve-1');

-- The live entry's lines of a document on one account.
create function pg_temp.posted(p_table text, p_id uuid, p_account uuid) returns numeric
language sql as $$
  select coalesce(sum(l.credit + l.debit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = p_table and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and l.chart_of_accounts_id = p_account;
$$;

-- 4-8: builders ----------------------------------------------------------------------------

select is(
  pg_temp.posted('invoices', '00000000-0000-0000-0000-0000005e9e01',
    (select sales_account_id from public.invoicing_channels where id = 'dz_fiscal')),
  1000::numeric,
  '4. a DZ invoice credits its net to the channel''s sales account'
);
select is(
  pg_temp.posted('invoices', '00000000-0000-0000-0000-0000005e9e02',
    (select id from public.chart_of_accounts where system_role = 'ventas' and is_active)),
  500::numeric,
  '5. a Jouve invoice still credits ventas'
);
select is(
  pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000005e9d01',
    (select purchase_account_id from public.invoicing_channels where id = 'dz_fiscal')),
  100::numeric,
  '6. a DZ purchase with no account of its own debits the channel''s purchase account'
);
select is(
  pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000005e9d02', (select id from t_leaf)),
  100::numeric,
  '7. a DZ purchase with its own account keeps it'
);
select is(
  pg_temp.posted('purchase_invoices', '00000000-0000-0000-0000-0000005e9d03',
    (select id from public.chart_of_accounts where system_role = 'compras' and is_active)),
  50::numeric,
  '8. a Jouve purchase still debits compras'
);

-- 9-10: guards -----------------------------------------------------------------------------

select throws_ok(
  $$update public.chart_of_accounts set is_active = false
     where id = (select sales_account_id from public.invoicing_channels where id = 'dz_fiscal')$$,
  '55006', null,
  '9. the account a channel posts to cannot be deactivated'
);
select throws_ok(
  $$update public.invoicing_channels set is_segregated = false where id = 'dz_fiscal'$$,
  '23514', null,
  '10. a channel with documents cannot stop being segregated'
);

-- 11-16: views -----------------------------------------------------------------------------

select is(
  (select count(*)::int from public.v_supplier_aging where supplier_id = '00000000-0000-0000-0000-0000005e9b01'),
  0,
  '11. supplier aging leaves the DZ-only supplier out'
);
select is(
  (select ars_total_open from public.v_supplier_aging where supplier_id = '00000000-0000-0000-0000-0000005e9b02'),
  50::numeric,
  '12. a mixed supplier''s aging counts only its Jouve purchase'
);
select is(
  (select sum(ars_total_open) from public.v_supplier_aging_by_scope
    where supplier_id = '00000000-0000-0000-0000-0000005e9b02'),
  50::numeric,
  '13. aging by scope leaves DZ out too'
);
select results_eq(
  $$select channel_id, ars_total_open, document_count, channel_is_segregated
      from public.v_supplier_aging_by_channel
     where supplier_id = '00000000-0000-0000-0000-0000005e9b02' order by channel_id$$,
  $$values ('dz_fiscal'::text, 121::numeric, 1::bigint, true), ('jouve_fiscal'::text, 50::numeric, 1::bigint, false)$$,
  '14. aging by channel has one row per channel, DZ included'
);
select ok(
  not exists (select 1 from public.v_client_aging where client_id = '00000000-0000-0000-0000-0000005e9c01')
  and exists (select 1 from public.v_aging_documents
               where client_id = '00000000-0000-0000-0000-0000005e9c01' and channel_is_segregated),
  '15. client aging leaves DZ out; the documents view marks the row'
);
select ok(
  (select bool_and(channel_is_segregated) from public.v_supplier_account_movements
    where supplier_id = '00000000-0000-0000-0000-0000005e9b01')
  and not (select bool_or(channel_is_segregated) from public.v_supplier_account_movements
            where supplier_id = '00000000-0000-0000-0000-0000005e9b03'),
  '16. the account movements mark the segregated rows'
);

-- 17-21: parties ---------------------------------------------------------------------------

select results_eq(
  $$select public.party_in_main_scope('supplier', '00000000-0000-0000-0000-0000005e9b01'),
           public.party_in_main_scope('supplier', '00000000-0000-0000-0000-0000005e9b02'),
           public.party_in_main_scope('supplier', '00000000-0000-0000-0000-0000005e9b03'),
           public.party_in_main_scope('supplier', '00000000-0000-0000-0000-0000005e9b04'),
           public.party_in_main_scope('client', '00000000-0000-0000-0000-0000005e9c01'),
           public.party_in_main_scope('client', '00000000-0000-0000-0000-0000005e9c02')$$,
  $$values (false, true, true, false, false, true)$$,
  '17. DZ-only and DZ-default parties are out of the main scope; mixed and main ones are in'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000005e9002","role":"authenticated"}', true);

select results_eq(
  $$select public.party_in_main_scope('supplier', '00000000-0000-0000-0000-0000005e9b01'),
           public.party_in_main_scope('supplier', '00000000-0000-0000-0000-0000005e9b02')$$,
  $$values (false, true)$$,
  '18. the same answer for a role that cannot read purchases'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000005e9001","role":"authenticated"}', true);

select results_eq(
  $$select id from public.search_suppliers('', true, 0, 200)
     where id::text like '00000000-0000-0000-0000-0000005e9b%' order by id$$,
  $$values ('00000000-0000-0000-0000-0000005e9b02'::uuid), ('00000000-0000-0000-0000-0000005e9b03'::uuid)$$,
  '19. supplier search leaves DZ-only suppliers out'
);
select results_eq(
  $$select id from public.search_suppliers('', true, 0, 200, null, null, 'dz_fiscal', true)
     where id::text like '00000000-0000-0000-0000-0000005e9b%' order by id$$,
  $$values ('00000000-0000-0000-0000-0000005e9b01'::uuid), ('00000000-0000-0000-0000-0000005e9b02'::uuid),
           ('00000000-0000-0000-0000-0000005e9b04'::uuid)$$,
  '20. the channel''s members: a document on it or it as default'
);
select results_eq(
  $$select (select count(*)::int from public.search_clients('', true, 0, 200)
             where id = '00000000-0000-0000-0000-0000005e9c01'),
           (select count(*)::int from public.search_clients('', true, 0, 200, null, 'dz_fiscal')
             where id = '00000000-0000-0000-0000-0000005e9c01')$$,
  $$values (0, 1)$$,
  '21. client search leaves a DZ-only client out unless asked for the channel'
);

-- 22-25: list RPCs -------------------------------------------------------------------------

select results_eq(
  $$select (select count(*)::int from public.search_purchase_invoices('', '00000000-0000-0000-0000-0000005e9b02')),
           (select count(*)::int from public.search_purchase_invoices('', '00000000-0000-0000-0000-0000005e9b02', 'dz_fiscal'))$$,
  $$values (1, 1)$$,
  '22. the purchase search shows the Jouve purchase, or the DZ one when asked for the channel'
);
select ok(
  not exists (select 1 from public.search_purchase_invoices('', '00000000-0000-0000-0000-0000005e9b02')
               where channel_id = 'dz_fiscal'),
  '23. without the channel no DZ purchase is listed'
);
select results_eq(
  $$select (select coalesce(sum(total), 0) from public.invoice_list_totals(
              p_client_id => '00000000-0000-0000-0000-0000005e9c01')),
           (select coalesce(sum(total), 0) from public.invoice_list_totals(
              p_client_id => '00000000-0000-0000-0000-0000005e9c01', p_channel_id => 'dz_fiscal'))$$,
  $$values (0::numeric, 1210::numeric)$$,
  '24. invoice totals: DZ out of the main list, alone in its own'
);
select ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname in ('search_suppliers', 'search_clients', 'invoice_list_totals')
                 and pg_get_function_identity_arguments(p.oid) in (
                   'p_query text, p_only_active boolean, p_offset integer, p_limit integer, p_category_id uuid, p_is_fiscal boolean',
                   'p_query text, p_only_active boolean, p_offset integer, p_limit integer, p_is_fiscal boolean',
                   'p_group text, p_is_fiscal boolean, p_status text, p_types text[], p_punto_venta integer, p_client_id uuid, p_from date, p_to date, p_numero integer, p_client_name text'))
  and has_function_privilege('authenticated', 'public.search_suppliers(text, boolean, integer, integer, uuid, boolean, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.search_suppliers(text, boolean, integer, integer, uuid, boolean, text, boolean)', 'execute'),
  '25. the old signatures are gone; the new ones are for signed-in users'
);

-- 26-29: reports and the libro IVA ---------------------------------------------------------

select is(
  (select count(*)::int from public.ai_supplier_purchases_summary(
     current_date - 90, current_date, '00000000-0000-0000-0000-0000005e9b01')),
  0,
  '26. the AI purchases summary leaves DZ out'
);
select is(
  (select count(*)::int from public.ai_supplier_upcoming_dues(
     365, '00000000-0000-0000-0000-0000005e9b01', 100)),
  0,
  '27. upcoming dues leave DZ out'
);
select is(
  (select count(*)::int from public.ai_client_sales_summary(
     current_date - 90, current_date, '00000000-0000-0000-0000-0000005e9c01')),
  0,
  '28. the AI sales summary leaves DZ out'
);
select ok(
  exists (select 1 from public.libro_iva_compras(to_char(current_date - 20, 'YYYY-MM'))
           where purchase_invoice_id = '00000000-0000-0000-0000-0000005e9d01')
  and exists (select 1 from public.libro_iva_ventas(to_char(current_date - 20, 'YYYY-MM'))
               where channel_id = 'dz_fiscal'),
  '29. the libro IVA keeps DZ'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 30-31: management ------------------------------------------------------------------------

select is(
  (select count(*)::int from public.management_pnl_lines(current_date - 90, current_date, 'accrual')
    where source_id in ('00000000-0000-0000-0000-0000005e9d01', '00000000-0000-0000-0000-0000005e9d02',
                        '00000000-0000-0000-0000-0000005e9e01')),
  0,
  '30. Resultado de gestión leaves DZ''s entries out'
);
select ok(
  exists (select 1 from public.management_pnl_lines(current_date - 90, current_date, 'accrual')
           where source_id = '00000000-0000-0000-0000-0000005e9e02'),
  '31. and keeps Jouve''s'
);

-- 32-34: tasks and the snapshot ------------------------------------------------------------

select public.sync_automatic_tasks(current_date);

select is(
  (select count(*)::int from public.tasks
    where source_id in ('00000000-0000-0000-0000-0000005e9d01', '00000000-0000-0000-0000-0000005e9e01')),
  0,
  '32. an overdue DZ purchase or invoice creates no task'
);
select is(
  (select count(*)::int from public.tasks where source_id = '00000000-0000-0000-0000-0000005e9d04'),
  1,
  '33. an overdue Jouve purchase does'
);

select public.capture_aging_snapshot();

select is(
  (select ars_total_open from public.aging_snapshots where snapshot_date = current_date),
  (select coalesce(sum(open_amount), 0) from public.v_aging_documents
    where coalesce(moneda, 'PES') not in ('DOL', 'USD') and not coalesce(channel_is_segregated, false)),
  '34. the aging snapshot leaves DZ out'
);

-- 35: tax payment picks the main fiscal channel ---------------------------------------------

insert into public.tax_documents (id, kind, period, due_date, amount, account_id, created_by) values
  ('00000000-0000-0000-0000-0000005e9f01', 'iibb', '2096-01', '2096-02-15', 100,
   (select id from public.chart_of_accounts where system_role = 'iva_debito'),
   '00000000-0000-0000-0000-0000005e9001');

create temporary table t_tax as
  select public.pay_tax_document('00000000-0000-0000-0000-0000005e9f01', '2096-02-15',
           '00000000-0000-0000-0000-0000005e9a01', 100) as tx_id;

select is(
  (select t.channel_id from public.transactions t join t_tax on t.id = t_tax.tx_id),
  'jouve_fiscal',
  '35. a tax payment goes to the main fiscal channel even when a segregated one sorts first'
);

-- 36-39: channel_summary --------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.channel_summary(text, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.channel_summary(text, date, date)', 'execute'),
  '36. channel_summary is only for the server'
);
select results_eq(
  $$select sum(sales), sum(costs), sum(margin), sum(payments)
      from public.channel_summary('dz_fiscal', current_date - 20, current_date - 20)$$,
  $$values (1000::numeric, 200::numeric, 800::numeric, 0::numeric)$$,
  '37. channel_summary: sales, costs and margin from the channel''s entries'
);
select is(
  (select count(*)::int from public.channel_summary('dz_fiscal', '2096-01-15', '2096-03-02')),
  3,
  '38. one row per month of the range'
);
select is(
  (select sum(sales) from public.channel_summary('jouve_fiscal', current_date - 20, current_date - 20)),
  500::numeric,
  '39. another channel''s summary does not take DZ'
);

-- 40-42: an inactive channel account raises instead of posting to Jouve's -------------------

alter table public.chart_of_accounts disable trigger guard_account_channel_reference;
update public.chart_of_accounts set is_active = false
 where id = (select sales_account_id from public.invoicing_channels where id = 'dz_fiscal')
    or id = (select purchase_account_id from public.invoicing_channels where id = 'dz_fiscal');

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key)
    values ('dz_fiscal', '00000000-0000-0000-0000-0000005e9c01', 'factura', 'A', 10, 5903,
            current_date, current_date, 1, 80, '30700000055', 100, 21, 121, 'PES', 1, 1, 1,
            'emitted', 'segregated-dz-2')$$,
  '55006', null,
  '40. a DZ invoice refuses an inactive channel account'
);
select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
    values ('dz_fiscal', '00000000-0000-0000-0000-0000005e9b01', 'factura', 'A', 1, 6,
            current_date, 100, 21, 121, 'received')$$,
  '55006', null,
  '41. a DZ purchase refuses an inactive channel account'
);
select lives_ok(
  format($$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status, account_id)
    values ('dz_fiscal', '00000000-0000-0000-0000-0000005e9b01', 'factura', 'A', 1, 7,
            current_date, 100, 21, 121, 'received', %L)$$, (select id from t_leaf)),
  '42. a DZ purchase with its own account does not need the channel''s'
);

select * from finish();
rollback;
