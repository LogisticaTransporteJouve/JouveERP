-- A loan as the bank shows it: its number, debit account and rates, and the
-- cuotas paid before it was loaded (pagadas with no movement), which do not
-- hold back cancelling it; only create_loan_core marks one. One transaction,
-- rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(8);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000c1a1', 'Banco préstamo en curso', 'bank', 'ARS');

create temp table t_loan on commit drop as
  select public.create_loan_core(
    jsonb_build_object(
      'kind', 'prestamo', 'description', 'Préstamo a Sola Firma',
      'lender', 'Banco Macro', 'principal', 1000, 'currency', 'ARS',
      'channel_id', 'jouve_fiscal', 'installments_count', 2,
      'first_due_date', '2026-10-03', 'loan_number', '7670122511',
      'account_id', '00000000-0000-0000-0000-00000000c1a1',
      'start_date', '2025-12-04', 'original_amount', 1000,
      'tna', 40, 'tea', 48.21, 'cft', 54.87
    ),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', '2026-10-03', 'amount', 560,
        'capital', 500, 'interest', 50, 'iva', 5.25, 'perception', 0,
        'other', 4.75, 'paid_outside', true),
      jsonb_build_object('number', 2, 'due_date', '2026-11-03', 'amount', 530,
        'capital', 500, 'interest', 25, 'iva', 2.63, 'perception', 0,
        'other', 2.37)
    ),
    null, null
  ) as id;

select is(
  (select loan_number || ' ' || tna || ' ' || original_amount
     from public.loans where id = (select id from t_loan)),
  '7670122511 40.000 1000.00',
  'the loan keeps the bank''s number, rate and amount granted'
);

select is(
  (select status::text || ' ' || paid_outside || ' ' || coalesce(transaction_id::text, 'sin movimiento')
     from public.loan_installments
    where loan_id = (select id from t_loan) and number = 1),
  'pagada true sin movimiento',
  'a cuota paid before is pagada with no movement'
);

select is(
  (select capital_amount || '/' || interest_amount || '/' || iva_amount
     from public.loan_installments
    where loan_id = (select id from t_loan) and number = 2),
  '500.00/25.00/2.63',
  'a pending cuota keeps the bank''s split'
);

select throws_ok(
  $$ insert into public.loan_installments (loan_id, number, due_date, amount, status, paid_date, paid_amount, paid_outside)
     values ((select id from t_loan), 3, '2026-12-03', 10, 'pagada', '2026-12-03', 10, true) $$,
  '55006', null,
  'only create_loan_core marks a cuota paid before'
);

select throws_ok(
  $$ update public.loan_installments set paid_outside = false
      where loan_id = (select id from t_loan) and number = 1 $$,
  '55006', null,
  'paid before is decided at creation'
);

select lives_ok(
  $$ select public.pay_loan_installment(
       (select id from public.loan_installments
         where loan_id = (select id from t_loan) and number = 2),
       '2026-11-03', '00000000-0000-0000-0000-00000000c1a1', 530) $$,
  'the pending cuota is paid as usual'
);

select is(
  (select status::text from public.loans where id = (select id from t_loan)),
  'paid',
  'with every cuota paid the loan is paid'
);

create temp table t_loan2 on commit drop as
  select public.create_loan_core(
    jsonb_build_object(
      'kind', 'prestamo', 'description', 'Préstamo en curso',
      'principal', 300, 'currency', 'ARS', 'channel_id', 'jouve_fiscal',
      'installments_count', 2, 'first_due_date', '2026-10-03'
    ),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', '2026-10-03', 'amount', 150, 'paid_outside', true),
      jsonb_build_object('number', 2, 'due_date', '2026-11-03', 'amount', 150)
    ),
    null, null
  ) as id;

select lives_ok(
  $$ update public.loans set status = 'cancelled' where id = (select id from t_loan2) $$,
  'a loan whose only paid cuotas were paid before can be cancelled'
);

select * from finish();
rollback;
