-- Códigos del banco (20261107200000): a statement line can post to a tax
-- credit account (SIRCREB / IIBB perceptions) only through
-- create_bank_statement_line_transaction, in pesos and on the fiscal channel;
-- nothing else can, and such a posting cannot move to interno. 5.4.3 exists
-- as a postable expense leaf. One transaction, rolled back.

begin;

select plan(6);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f701', 'owner@codes.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000f701', 'owner');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000fc01', 'Banco Códigos', 'bank', 'ARS');

create temporary table t_run as
  select public.commit_import_run(
    'bank_statement', 'macro.csv', repeat('4', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fc01', 'line_date', '2026-11-05',
        'description', 'RECAUDACIONES ARBA Suc.:540', 'amount', -4348.59, 'balance', 1000,
        'reference', '1952131830', 'source_hash', repeat('9', 64), 'line_no', 2, 'bank_code', '1794')
    ),
    '00000000-0000-0000-0000-00000000f701') as id;

create temporary table t_ids as
  select (select id from public.bank_statement_lines where source_hash = repeat('9', 64)) as line_id,
         (select id from public.chart_of_accounts where system_role = 'percepciones_iibb_pagadas' and is_active) as iibb,
         (select id from public.invoicing_channels where is_fiscal and is_active order by id limit 1) as fiscal,
         (select id from public.invoicing_channels where not is_fiscal and is_active order by id limit 1) as interno;

create temporary table t_tx as
  select public.create_bank_statement_line_transaction(
    (select line_id from t_ids), (select fiscal from t_ids), '00000000-0000-0000-0000-00000000f701',
    (select iibb from t_ids), null, 'RECAUDACIONES ARBA') as id;

select is(
  (select expense_account_id from public.transactions where id = (select id from t_tx)),
  (select iibb from t_ids),
  'a statement line posts to Percepciones IIBB sufridas'
);

select is(
  (select status from public.bank_statement_lines where id = (select line_id from t_ids)),
  'matched',
  'and the line is reconciled'
);

select throws_ok(
  $$insert into public.transactions (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, expense_account_id)
    values ('00000000-0000-0000-0000-00000000fc01', (select fiscal from t_ids), 'expense', 10, 'ARS',
            '2026-11-05', '2026-11-01', 'a mano', (select iibb from t_ids))$$,
  '23514',
  null,
  'a manual expense cannot post to a tax credit account'
);

select throws_ok(
  $$update public.transactions set channel_id = (select interno from t_ids) where id = (select id from t_tx)$$,
  '23514',
  null,
  'a tax credit posting cannot move to the interno channel'
);

select ok(
  exists (select 1 from public.expense_leaf_accounts e
            join public.chart_of_accounts a on a.id = e.id
           where a.code = '5.4.3'),
  '5.4.3 Impuesto a los débitos y créditos bancarios is a postable expense leaf'
);

select ok(
  not has_table_privilege('anon', 'public.bank_statement_codes', 'select'),
  'anon cannot read the bank codes'
);

select * from finish();
rollback;
