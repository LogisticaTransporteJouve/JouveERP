-- A leasing: its opening books the vehicle in Rodados against Deudas por
-- leasing and earlier results; a cuota set from the lender's statement posts
-- its capital to Deudas por leasing, its interest and mora to interest paid,
-- seguro and patentes to their accounts and every IVA to crédito fiscal; the
-- charges change only through their RPC and only while the cuota is pending.
-- One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(15);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000094a1', 'Banco leasing', 'bank', 'ARS');

create temp table t_loan on commit drop as
  select public.create_loan_core(
    jsonb_build_object(
      'kind', 'leasing', 'description', 'Leasing camión',
      'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_fiscal',
      'installments_count', 3, 'first_due_date', '2026-08-28',
      'loan_number', '139499', 'start_date', '2025-01-28',
      'original_amount', 1000
    ),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', '2026-08-28', 'amount', 423.5,
        'capital', 300, 'interest', 50, 'iva', 73.5, 'perception', 0, 'other', 0,
        'paid_outside', true),
      jsonb_build_object('number', 2, 'due_date', '2026-10-28', 'amount', 423.5,
        'capital', 310, 'interest', 40, 'iva', 73.5, 'perception', 0, 'other', 0),
      jsonb_build_object('number', 3, 'due_date', '2026-11-28', 'amount', 423.5,
        'capital', 320, 'interest', 30, 'iva', 73.5, 'perception', 0, 'other', 0)
    ),
    null, null
  ) as id;

create temp table t_cuota on commit drop as
  select id from public.loan_installments
   where loan_id = (select id from t_loan) and number = 2;

create function pg_temp.side(p_entry uuid, p_role text, p_side text) returns numeric
language sql as $$
  select coalesce(sum(case when p_side = 'debit' then l.debit else l.credit end), 0)
    from public.journal_entry_lines l
   where l.journal_entry_id = p_entry
     and l.chart_of_accounts_id = public.find_account_by_role(p_role::public.coa_system_role)
$$;

-- The accounts exist with their roles.
select is(
  (select string_agg(code || ' ' || system_role::text, ', ' order by code)
     from public.chart_of_accounts
    where system_role in ('rodados', 'deudas_leasing', 'seguros', 'patentes') and is_active),
  '1.2.1.1 rodados, 2.1.5 deudas_leasing, 5.2.5 seguros, 5.2.6 patentes',
  'Rodados, Deudas por leasing, Seguros de vehículos and Patentes are in the chart'
);

-- Opening at the start of the year: 300 of capital already paid.
create temp table t_opening on commit drop as
  select public.book_loan_opening((select id from t_loan), '2026-10-01') as id;

select is(pg_temp.side((select id from t_opening), 'rodados', 'debit'), 1000.00::numeric,
  'the vehicle is booked in Rodados for the amount financed');
select is(pg_temp.side((select id from t_opening), 'deudas_leasing', 'credit'), 700.00::numeric,
  'the capital still owed is Deudas por leasing');
select is(
  (select sum(l.credit) from public.journal_entry_lines l
     join public.chart_of_accounts a on a.id = l.chart_of_accounts_id
    where l.journal_entry_id = (select id from t_opening) and a.code = '3.2.1'),
  300.00::numeric,
  'the capital paid before comes out of Resultados no asignados'
);

-- The statement of cuota 2: seguro with IVA, patentes, punitorios.
select is(
  public.set_loan_installment_charges(
    (select id from t_cuota),
    jsonb_build_object('capital', 310, 'interest', 40, 'iva', 73.5),
    jsonb_build_array(
      jsonb_build_object('concept', 'seguro', 'description', 'Seguro automotor', 'amount', 100, 'iva_amount', 20.02),
      jsonb_build_object('concept', 'patentes', 'description', 'MBF - Patentes', 'amount', 50),
      jsonb_build_object('concept', 'mora', 'description', 'Intereses compensatorios y punitorios', 'amount', 7.5)
    )
  ),
  601.02::numeric,
  'the cuota''s amount is its split plus its charges'
);

select is(
  (select other_charges_amount from public.loan_installments where id = (select id from t_cuota)),
  177.52::numeric,
  '«otros» is the sum of the charges with their IVA'
);

select throws_ok(
  $$ insert into public.loan_installment_charges (installment_id, concept, amount)
     values ((select id from t_cuota), 'otro', 1) $$,
  '55006', null,
  'a charge is written only through set_loan_installment_charges'
);

create temp table t_tx on commit drop as
  select public.pay_loan_installment((select id from t_cuota), '2026-10-28',
    '00000000-0000-0000-0000-0000000094a1', 601.02) as id;

create temp table t_entry on commit drop as
  select je.id from public.journal_entries je
   where je.source_table = 'transactions' and je.source_id = (select id from t_tx)
     and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id);

select is(pg_temp.side((select id from t_entry), 'banco', 'credit'), 601.02::numeric,
  'the payment leaves Bancos');
select is(pg_temp.side((select id from t_entry), 'deudas_leasing', 'debit'), 310.00::numeric,
  'the capital lowers Deudas por leasing');
select is(pg_temp.side((select id from t_entry), 'prestamos', 'debit'), 0::numeric,
  'and not Préstamos financieros');
select is(pg_temp.side((select id from t_entry), 'intereses_pagados', 'debit'), 47.50::numeric,
  'interest and punitorios are interest paid');
select is(pg_temp.side((select id from t_entry), 'seguros', 'debit'), 100.00::numeric,
  'the insurance goes to Seguros de vehículos');
select is(pg_temp.side((select id from t_entry), 'patentes', 'debit'), 50.00::numeric,
  'the registration tax goes to Patentes');
select is(pg_temp.side((select id from t_entry), 'iva_credito', 'debit'), 93.52::numeric,
  'the IVA of the canon and of the insurance is crédito fiscal');

select throws_ok(
  $$ select public.set_loan_installment_charges(
       (select id from t_cuota),
       jsonb_build_object('capital', 310, 'interest', 40, 'iva', 73.5),
       '[]'::jsonb) $$,
  '23514', null,
  'a paid cuota keeps its charges'
);

select * from finish();
rollback;
