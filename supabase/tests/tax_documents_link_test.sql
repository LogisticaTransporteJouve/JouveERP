-- Impuestos: pagar con un movimiento existente (20261103190000).
-- link_tax_document_payment adopts a loose expense (already reconciled with
-- the statement here): the document is paid and the movement's entry moves
-- its debit from the expense account to the document's account; linking the
-- same pair again changes nothing; an owned movement, another amount without
-- confirming it, a movement in dollars and one in a closed period are
-- refused. create_bank_statement_line_tax_payment pays a document from a
-- statement debit and reconciles the line. Grants. One transaction, rolled
-- back.

begin;

select plan(22);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The live entry's debit on one account for a movement.
create function pg_temp.debit_on(p_tx uuid, p_account uuid) returns numeric
language sql as $$
  select coalesce(sum(l.debit), 0) from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = 'transactions' and je.source_id = p_tx and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and l.chart_of_accounts_id = p_account;
$$;

create function pg_temp.live_entries(p_id uuid) returns int
language sql as $$
  select count(*)::int from public.journal_entries je
   where je.source_table = 'transactions' and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'owner@taxlink.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000e001', 'owner');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000e101', 'Banco Impuestos Link', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000e102', 'Banco Dólares Link', 'bank', 'USD');

create temporary table t_coa as
  select (select id from public.chart_of_accounts where system_role = 'iva_debito') as tax_account,
         (select id from public.expense_leaf_accounts order by code limit 1) as expense_account;

insert into public.tax_documents (id, kind, period, due_date, amount, account_id, created_by) values
  ('00000000-0000-0000-0000-00000000e201', 'iva', '2026-09', '2026-10-20', 1000,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000e001'),
  ('00000000-0000-0000-0000-00000000e202', 'iibb', '2026-09', '2026-10-15', 500,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000e001'),
  ('00000000-0000-0000-0000-00000000e203', 'sicore', '2026-09', '2026-10-10', 300,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000e001'),
  ('00000000-0000-0000-0000-00000000e204', 'ganancias_anticipo', '1999-02', '1999-03-10', 700,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000e001');

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month,
   description, expense_account_id)
values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000e101', 'jouve_fiscal',
   'expense', 1000, 'ARS', '2026-10-20', '2026-10-01', 'Transferencia AFIP',
   (select expense_account from t_coa)),
  ('00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-00000000e101', 'jouve_fiscal',
   'expense', 520, 'ARS', '2026-10-15', '2026-10-01', 'Transferencia ARBA', null),
  ('00000000-0000-0000-0000-00000000e303', '00000000-0000-0000-0000-00000000e102', 'jouve_fiscal',
   'expense', 700, 'USD', '2026-10-15', '2026-10-01', 'Pago en dólares', null),
  ('00000000-0000-0000-0000-00000000e304', '00000000-0000-0000-0000-00000000e101', 'jouve_fiscal',
   'expense', 700, 'ARS', '1999-03-10', '1999-03-01', 'Anticipo viejo', null);

-- The statement: one debit already loaded (e301), one the books lack.
create temporary table t_stmt as
  select public.commit_import_run(
    'bank_statement', 'extracto-impuestos.csv', repeat('7', 64), '{}'::jsonb, 2, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000e101', 'line_date', '2026-10-20',
        'description', 'Transf. AFIP', 'amount', -1000, 'balance', null, 'reference', null,
        'source_hash', repeat('d', 64), 'line_no', 2),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000e101', 'line_date', '2026-10-10',
        'description', 'Débito SICORE', 'amount', -300, 'balance', null, 'reference', null,
        'source_hash', repeat('e', 64), 'line_no', 3)
    ),
    '00000000-0000-0000-0000-00000000e001') as id;
create temporary table t_line as
  select id, description from public.bank_statement_lines
   where import_run_id = (select id from t_stmt);

select public.match_bank_statement_line(
  (select id from t_line where description = 'Transf. AFIP'),
  array['00000000-0000-0000-0000-00000000e301']::uuid[],
  '00000000-0000-0000-0000-00000000e001');

-- 1. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated',
        'public.link_tax_document_payment(uuid, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated',
        'public.create_bank_statement_line_tax_payment(uuid, uuid, uuid, boolean)', 'execute')
  and has_function_privilege('service_role',
        'public.link_tax_document_payment(uuid, uuid, uuid, boolean)', 'execute')
  and has_function_privilege('service_role',
        'public.create_bank_statement_line_tax_payment(uuid, uuid, uuid, boolean)', 'execute'),
  'only the service role links or pays from the statement'
);

-- 2. Linking a reconciled expense ------------------------------------------------

select is(pg_temp.debit_on('00000000-0000-0000-0000-00000000e301', (select expense_account from t_coa)),
  1000::numeric, 'before linking, the expense debits its expense account');

select is(
  public.link_tax_document_payment('00000000-0000-0000-0000-00000000e201',
    '00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000e001'),
  '00000000-0000-0000-0000-00000000e301'::uuid,
  'linking returns the movement, even one reconciled with the statement'
);
set constraints all immediate;

select results_eq(
  $$select status, payment_transaction_id, paid_date, paid_amount
      from public.tax_documents where id = '00000000-0000-0000-0000-00000000e201'$$,
  $$values ('pagado'::text, '00000000-0000-0000-0000-00000000e301'::uuid, '2026-10-20'::date,
            1000::numeric(18,2))$$,
  'the document is paid on the movement''s date for its amount'
);
select is(pg_temp.debit_on('00000000-0000-0000-0000-00000000e301', (select tax_account from t_coa)),
  1000::numeric, 'the entry now debits the document''s account');
select is(pg_temp.debit_on('00000000-0000-0000-0000-00000000e301', (select expense_account from t_coa)),
  0::numeric, 'and no longer the expense account');
select is(pg_temp.live_entries('00000000-0000-0000-0000-00000000e301'), 1,
  'the movement keeps one live entry');
select results_eq(
  $$select expense_account_id, amount, transaction_date from public.transactions
     where id = '00000000-0000-0000-0000-00000000e301'$$,
  $$values (null::uuid, 1000::numeric(18,2), '2026-10-20'::date)$$,
  'the movement drops its expense account and keeps its money fields'
);
select is(
  (select source_document from public.v_transactions_tagged where id = '00000000-0000-0000-0000-00000000e301'),
  'tax_document',
  'Caja tags the movement as the tax document''s'
);

-- 3. Idempotent, owned, paid ------------------------------------------------------

select is(
  public.link_tax_document_payment('00000000-0000-0000-0000-00000000e201',
    '00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000e001'),
  '00000000-0000-0000-0000-00000000e301'::uuid,
  'linking the same pair again returns the same movement'
);
set constraints all immediate;
select is(pg_temp.live_entries('00000000-0000-0000-0000-00000000e301'), 1,
  'and posts nothing new');

select throws_ok(
  $$select public.link_tax_document_payment('00000000-0000-0000-0000-00000000e202',
      '00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000e001')$$,
  '23514', null, 'a movement another document owns is refused');
select throws_ok(
  $$select public.link_tax_document_payment('00000000-0000-0000-0000-00000000e201',
      '00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-00000000e001')$$,
  '55006', 'El impuesto ya está pagado o anulado', 'a paid document takes no other movement');

-- 4. Amount, currency, closed period ----------------------------------------------

select throws_ok(
  $$select public.link_tax_document_payment('00000000-0000-0000-0000-00000000e202',
      '00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-00000000e001')$$,
  '23514', null, 'another amount is refused without confirming it');
select lives_ok(
  $$select public.link_tax_document_payment('00000000-0000-0000-0000-00000000e202',
      '00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-00000000e001', true)$$,
  'confirmed, another amount is linked');
select results_eq(
  $$select status, paid_amount, amount, notes like '%diferencia%'
      from public.tax_documents where id = '00000000-0000-0000-0000-00000000e202'$$,
  $$values ('pagado'::text, 520::numeric(18,2), 500::numeric(18,2), true)$$,
  'the document keeps its amount, records the paid one and notes the difference'
);

select throws_ok(
  $$select public.link_tax_document_payment('00000000-0000-0000-0000-00000000e204',
      '00000000-0000-0000-0000-00000000e303', '00000000-0000-0000-0000-00000000e001', true)$$,
  '23514', null, 'a movement in dollars is refused');

insert into public.accounting_closed_periods (period) values ('1999-03');
select throws_ok(
  $$select public.link_tax_document_payment('00000000-0000-0000-0000-00000000e204',
      '00000000-0000-0000-0000-00000000e304', '00000000-0000-0000-0000-00000000e001')$$,
  '55006', null, 'a movement in a closed period is refused');

-- 5. Paying from a statement line -------------------------------------------------

create temporary table t_paid as
  select public.create_bank_statement_line_tax_payment(
    (select id from t_line where description = 'Débito SICORE'),
    '00000000-0000-0000-0000-00000000e203',
    '00000000-0000-0000-0000-00000000e001') as tx_id;
set constraints all immediate;

select results_eq(
  $$select l.status, m.transaction_id
      from public.bank_statement_lines l
      join public.bank_statement_matches m on m.line_id = l.id
     where l.id = (select id from t_line where description = 'Débito SICORE')$$,
  $$select 'matched'::text, tx_id from t_paid$$,
  'the line is reconciled with the new movement'
);
select results_eq(
  $$select status, payment_transaction_id, paid_date, paid_amount
      from public.tax_documents where id = '00000000-0000-0000-0000-00000000e203'$$,
  $$select 'pagado'::text, tx_id, '2026-10-10'::date, 300::numeric(18,2) from t_paid$$,
  'the document is paid on the line''s date for its amount'
);
select results_eq(
  $$select kind, channel_id, account_id, created_by from public.transactions
     where id = (select tx_id from t_paid)$$,
  $$values ('expense'::text, 'jouve_fiscal'::text, '00000000-0000-0000-0000-00000000e101'::uuid,
            '00000000-0000-0000-0000-00000000e001'::uuid)$$,
  'the movement is a fiscal expense of the line''s account, by the user'
);
select is(pg_temp.debit_on((select tx_id from t_paid), (select tax_account from t_coa)),
  300::numeric, 'its entry debits the document''s account');

select * from finish();

rollback;
