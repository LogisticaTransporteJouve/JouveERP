-- The bank's receipts of a loan in course: a receipt of a cuota paid before
-- the loan was loaded, dated from the year being closed on, posts its entry
-- against Bancos; an older one or a second load of the same receipt does
-- not; the opening debt is booked once. One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(11);

create temp table t_loan on commit drop as
  select public.create_loan_core(
    jsonb_build_object(
      'kind', 'prestamo', 'description', 'Préstamo a Sola Firma',
      'principal', 3000, 'currency', 'ARS', 'channel_id', 'jouve_fiscal',
      'installments_count', 3, 'first_due_date', '2025-12-03',
      'loan_number', '7670122511', 'start_date', '2025-11-04',
      'original_amount', 3000
    ),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', '2025-12-03', 'amount', 1100,
        'capital', 1000, 'interest', 100, 'iva', 0, 'perception', 0, 'other', 0,
        'paid_outside', true),
      jsonb_build_object('number', 2, 'due_date', '2026-01-03', 'amount', 1080,
        'capital', 1000, 'interest', 80, 'iva', 0, 'perception', 0, 'other', 0,
        'paid_outside', true),
      jsonb_build_object('number', 3, 'due_date', '2026-02-03', 'amount', 1050,
        'capital', 1000, 'interest', 50, 'iva', 0, 'perception', 0, 'other', 0)
    ),
    null, null
  ) as id;

select is(
  public.record_loan_bank_payments(
    (select id from t_loan),
    jsonb_build_array(
      jsonb_build_object('receipt_number', 'R1', 'paid_date', '2025-12-03',
        'installment_number', 1, 'total', 1100, 'capital', 1000, 'interest', 100),
      jsonb_build_object('receipt_number', 'R2', 'paid_date', '2026-01-05',
        'installment_number', 2, 'total', 1121.5, 'capital', 1000,
        'interest', 80, 'late_interest', 5, 'iva', 17.85,
        'iva_perception', 12.15, 'iibb_perception', 6.5)
    ),
    '2026-01-01',
    null
  ),
  '{"booked": 1, "inserted": 2}'::jsonb,
  'both receipts are stored; only the one of the year closed is booked'
);

select is(
  (select journal_entry_id is null from public.loan_bank_payments where receipt_number = 'R1'),
  true,
  'a receipt before the year closed has no entry'
);

create temp table t_entry on commit drop as
  select journal_entry_id as id from public.loan_bank_payments where receipt_number = 'R2';

create function pg_temp.amount(p_role text, p_side text) returns numeric
language sql as $$
  select coalesce(sum(case when p_side = 'debit' then l.debit else l.credit end), 0)
    from public.journal_entry_lines l
    join public.chart_of_accounts a on a.id = l.chart_of_accounts_id
   where l.journal_entry_id = (select id from t_entry)
     and a.system_role::text = p_role
$$;

select is(pg_temp.amount('banco', 'credit'), 1121.50::numeric, 'the receipt''s total leaves Bancos');
select is(pg_temp.amount('prestamos', 'debit'), 1000.00::numeric, 'the capital lowers the loan');
select is(pg_temp.amount('intereses_pagados', 'debit'), 85.00::numeric, 'interest and punitorios are interest paid');
select is(
  pg_temp.amount('iva_credito', 'debit') + pg_temp.amount('percepciones_iva_pagadas', 'debit')
    + pg_temp.amount('percepciones_iibb_pagadas', 'debit'),
  36.50::numeric,
  'IVA and perceptions are tax credits'
);

select is(
  public.record_loan_bank_payments(
    (select id from t_loan),
    jsonb_build_array(
      jsonb_build_object('receipt_number', 'R2', 'paid_date', '2026-01-05',
        'installment_number', 2, 'total', 1121.5, 'capital', 1000,
        'interest', 80, 'late_interest', 5, 'iva', 17.85,
        'iva_perception', 12.15, 'iibb_perception', 6.5)
    ),
    '2026-01-01',
    null
  ),
  '{"booked": 0, "inserted": 0}'::jsonb,
  'loading the same receipt again adds nothing'
);

select lives_ok(
  $$ select public.book_loan_opening((select id from t_loan), '2026-01-01') $$,
  'the opening debt is booked: granted less the capital due before'
);

select throws_ok(
  $$ select public.book_loan_opening((select id from t_loan), '2026-01-01') $$,
  '23505', null,
  'only once'
);

create temp table t_loan2 on commit drop as
  select public.create_loan_core(
    jsonb_build_object(
      'kind', 'prestamo', 'description', 'Préstamo del ejercicio',
      'principal', 500, 'currency', 'ARS', 'channel_id', 'jouve_fiscal',
      'installments_count', 1, 'first_due_date', '2026-03-03',
      'start_date', '2026-02-03', 'original_amount', 500
    ),
    jsonb_build_array(jsonb_build_object('number', 1, 'due_date', '2026-03-03', 'amount', 500)),
    null, null
  ) as id;

select lives_ok(
  $$ select public.book_loan_opening((select id from t_loan2), '2026-01-01') $$,
  'a loan granted within the year books its disbursement'
);

select is(
  (select je.entry_date::text || ' ' || sum(l.debit)
     from public.loans lo
     join public.journal_entries je on je.id = lo.opening_journal_entry_id
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where lo.id = (select id from t_loan2)
    group by je.entry_date),
  '2026-02-03 500.00',
  'on the date granted, with no movement in Caja'
);

select * from finish();
rollback;
