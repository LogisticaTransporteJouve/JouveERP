-- Impuestos como documento (20261103170000): RLS by role (the accountant
-- reads, writes nothing), guard_tax_document (insert pending, paid only
-- through pay_tax_document, a paid document frozen but its notes), the
-- payment (one owned movement in the fiscal channel, its entry debiting the
-- tax account, refused twice, in a closed period and for a non-writer), the
-- due-date task and the VEP as a file attachment. One transaction, rolled
-- back.

begin;

select plan(23);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create function pg_temp.live_entries(p_id uuid) returns int
language sql as $$
  select count(*)::int from public.journal_entries je
   where je.source_table = 'transactions' and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', 'finance@taxes.test'),
  ('00000000-0000-0000-0000-000000000a02', 'reader@taxes.test'),
  ('00000000-0000-0000-0000-000000000a03', 'ops@taxes.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-000000000a01', 'finance'),
  ('00000000-0000-0000-0000-000000000a02', 'fiscal_reader'),
  ('00000000-0000-0000-0000-000000000a03', 'operations');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-000000000b01', 'Banco Impuestos', 'bank', 'ARS');

create temporary table t_day as
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date as today;
create temporary table t_coa as
  select (select id from public.chart_of_accounts where system_role = 'iva_debito') as iva_debito,
         (select id from public.chart_of_accounts where code = '2.1.2') as deudas_fiscales;

insert into public.tax_documents (id, kind, period, due_date, amount, account_id, created_by) values
  ('00000000-0000-0000-0000-000000000c01', 'iva', '2026-10', (select today + 3 from t_day), 1000,
   (select iva_debito from t_coa), '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-000000000c02', 'iibb', '2026-10', (select today + 30 from t_day), null,
   null, '00000000-0000-0000-0000-000000000a01');

-- 1. RLS -----------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated"}', true);

select is((select count(*)::int from public.tax_documents), 2,
  'the accountant reads tax documents');
select throws_ok(
  $$insert into public.tax_documents (kind, period, due_date, created_by)
    values ('sicore', '2026-10', current_date, '00000000-0000-0000-0000-000000000a02')$$,
  '42501', null, 'the accountant cannot create one');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000a03","role":"authenticated"}', true);
select is((select count(*)::int from public.tax_documents), 0,
  'operations reads none');
select throws_ok(
  $$select public.pay_tax_document('00000000-0000-0000-0000-000000000c01', current_date,
      '00000000-0000-0000-0000-000000000b01', 1000)$$,
  '42501', null, 'operations cannot pay');

-- 2. Guard (as owner) --------------------------------------------------------------

reset role;

select throws_ok(
  $$insert into public.tax_documents (kind, period, due_date, status) values ('iva', '2026-09', current_date, 'pagado')$$,
  '23514', null, 'a document is not created paid');
select throws_ok(
  $$update public.tax_documents set status = 'liquidado' where id = '00000000-0000-0000-0000-000000000c02'$$,
  '23514', 'Para marcar el impuesto como liquidado cargá su importe',
  'liquidado needs the amount');
select throws_ok(
  $$update public.tax_documents set account_id = (select deudas_fiscales from t_coa)
     where id = '00000000-0000-0000-0000-000000000c02'$$,
  '23514', null, 'the account must be a leaf');
select throws_ok(
  $$insert into public.tax_documents (kind, period, due_date) values ('iva', '2026-10', current_date)$$,
  '23505', null, 'one live document per obligation and period');
select throws_ok(
  $$update public.tax_documents set status = 'pagado' where id = '00000000-0000-0000-0000-000000000c01'$$,
  '23514', null, 'the paid state is only reached by paying');

-- 3. The due-date task -------------------------------------------------------------

create temporary table t_sync1 as
  select * from public.sync_automatic_tasks((select today from t_day));

select results_eq(
  $$select t.kind, t.status, t.due_date, t.title
      from public.tasks t
     where t.source_table = 'tax_documents'$$,
  $$values ('tax_document'::text, 'open'::text, (select today + 3 from t_day),
            'Pagar IVA del período 10/2026'::text)$$,
  'a document due within 7 days opens its task; one due later does not'
);

-- 4. Paying ------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

create temporary table t_pay as
  select public.pay_tax_document('00000000-0000-0000-0000-000000000c01', (select today from t_day),
    '00000000-0000-0000-0000-000000000b01', 1000) as tx_id;

reset role;
set constraints all immediate;

select results_eq(
  $$select status, payment_transaction_id, paid_amount
      from public.tax_documents where id = '00000000-0000-0000-0000-000000000c01'$$,
  $$values ('pagado'::text, (select tx_id from t_pay), 1000::numeric(18,2))$$,
  'finance pays: the document is paid and linked to its movement'
);
select results_eq(
  $$select kind, channel_id, amount, account_id from public.transactions
     where id = (select tx_id from t_pay)$$,
  $$values ('expense'::text, 'jouve_fiscal'::text, 1000::numeric(18,2),
            '00000000-0000-0000-0000-000000000b01'::uuid)$$,
  'the payment is an expense of the fiscal channel from the chosen account'
);
select is(pg_temp.live_entries((select tx_id from t_pay)), 1,
  'the movement has one live entry');
select is(
  (select l.debit from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'transactions' and je.source_id = (select tx_id from t_pay)
      and not je.is_reversal
      and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
      and l.chart_of_accounts_id = (select iva_debito from t_coa)),
  1000::numeric,
  'the entry debits the tax document''s account'
);
select is(
  (select source_document from public.v_transactions_tagged where id = (select tx_id from t_pay)),
  'tax_document',
  'Caja tags the movement as the tax document''s'
);
select ok(
  not public.transaction_is_loose((select t from public.transactions t where t.id = (select tx_id from t_pay))),
  'the movement is not loose (no loan can adopt it)'
);

select throws_ok(
  $$select public.pay_tax_document('00000000-0000-0000-0000-000000000c01', current_date,
      '00000000-0000-0000-0000-000000000b01', 1000)$$,
  '23514', 'El impuesto no existe o ya está pagado o anulado',
  'a second payment is refused');
select throws_ok(
  $$update public.tax_documents set amount = 2000 where id = '00000000-0000-0000-0000-000000000c01'$$,
  '55006', null, 'a paid document is frozen');
select lives_ok(
  $$update public.tax_documents set notes = 'VEP 123' where id = '00000000-0000-0000-0000-000000000c01'$$,
  'but its notes still change');
select throws_ok(
  $$delete from public.transactions where id = (select tx_id from t_pay)$$,
  '55006', null, 'the payment movement cannot be deleted loose');

create temporary table t_sync2 as
  select * from public.sync_automatic_tasks((select today from t_day));
select results_eq(
  $$select status, auto_closed from public.tasks where source_table = 'tax_documents'$$,
  $$values ('done'::text, true)$$,
  'paying closes its task'
);

-- 5. Closed period and the VEP -----------------------------------------------------

insert into public.accounting_closed_periods (period) values ('1999-02');
update public.tax_documents
   set amount = 500, account_id = (select iva_debito from t_coa)
 where id = '00000000-0000-0000-0000-000000000c02';
select throws_ok(
  $$select public.pay_tax_document('00000000-0000-0000-0000-000000000c02', '1999-02-10',
      '00000000-0000-0000-0000-000000000b01', 500)$$,
  '55006', null, 'a payment dated in a closed period is refused');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.files (id, bucket_path, original_filename, source) values
  ('00000000-0000-0000-0000-000000000d01', 'taxes/vep.pdf', 'vep.pdf', 'manual_upload');
insert into public.file_attachments (file_id, kind, tax_document_id) values
  ('00000000-0000-0000-0000-000000000d01', 'vep', '00000000-0000-0000-0000-000000000c02');
select results_eq(
  $$select entity_type, entity_id from public.v_files_hub
     where file_id = '00000000-0000-0000-0000-000000000d01'$$,
  $$values ('tax_document'::text, '00000000-0000-0000-0000-000000000c02'::uuid)$$,
  'the VEP is a file of the tax document in the files hub'
);

select * from finish();

rollback;
