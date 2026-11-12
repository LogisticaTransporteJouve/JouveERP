-- Auditoría W1 · S2 F5 and F6: an unsplit cuota of a loan with its
-- disbursement recorded pays down prestamos (capital first, along the
-- schedule), a split cuota keeps its split, and a loan with money recorded
-- cannot be cancelled or deleted. A savings plan (20261112100100) adds up
-- its cuotas in «Rodados en plan de ahorro», never in gastos, and has no
-- disbursement nor opening debt. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(20);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000093a1', 'Banco préstamos auditoría', 'bank', 'ARS');

-- Principal 1.000 in 3 cuotas of 400 (1.200 in all): the third one carries the
-- 200 of interest once the capital is paid off.
insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-0000000093b1', 'jouve_fiscal', 'ARS', 'Préstamo sin desglose',
   current_date, 3, 'prestamo', 1000),
  ('00000000-0000-0000-0000-0000000093b2', 'jouve_fiscal', 'ARS', 'Préstamo sin desembolso',
   current_date, 1, 'prestamo', 500),
  ('00000000-0000-0000-0000-0000000093b3', 'jouve_fiscal', 'ARS', 'Préstamo cargado por error',
   current_date, 1, 'prestamo', 300);

insert into public.loan_installments (id, loan_id, number, due_date, amount) values
  ('00000000-0000-0000-0000-0000000093d1', '00000000-0000-0000-0000-0000000093b1', 1, current_date, 400),
  ('00000000-0000-0000-0000-0000000093d2', '00000000-0000-0000-0000-0000000093b1', 2, current_date, 400),
  ('00000000-0000-0000-0000-0000000093d3', '00000000-0000-0000-0000-0000000093b1', 3, current_date, 400),
  ('00000000-0000-0000-0000-0000000093d4', '00000000-0000-0000-0000-0000000093b2', 1, current_date, 500),
  ('00000000-0000-0000-0000-0000000093d5', '00000000-0000-0000-0000-0000000093b3', 1, current_date, 300);

-- The second cuota carries an explicit split: 350 capital + 50 interest.
update public.loan_installments
   set capital_amount = 350, interest_amount = 50, iva_amount = 0,
       perception_amount = 0, other_charges_amount = 0
 where id = '00000000-0000-0000-0000-0000000093d2';

create temp table t_disb on commit drop as
  select public.record_loan_disbursement('00000000-0000-0000-0000-0000000093b1',
    '00000000-0000-0000-0000-0000000093a1', current_date, null) as id;

create temp table t_paid on commit drop as
  select i.id as installment_id,
         public.pay_loan_installment(i.id, current_date, '00000000-0000-0000-0000-0000000093a1', i.amount) as tx_id
    from public.loan_installments i
   where i.id in ('00000000-0000-0000-0000-0000000093d1', '00000000-0000-0000-0000-0000000093d2',
                  '00000000-0000-0000-0000-0000000093d3', '00000000-0000-0000-0000-0000000093d4');

set constraints all immediate;
set constraints all deferred;

create function pg_temp.debit(p_tx uuid, p_role text) returns numeric
language sql as $$
  select coalesce(sum(l.debit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = 'transactions' and je.source_id = p_tx and not je.is_reversal
     and l.chart_of_accounts_id = public.find_account_by_role(p_role::public.coa_system_role)
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
$$;

select is(
  pg_temp.debit((select tx_id from t_paid where installment_id = '00000000-0000-0000-0000-0000000093d1'), 'prestamos'),
  400::numeric,
  'an unsplit cuota of a disbursed loan debits prestamos for its capital'
);

select is(
  pg_temp.debit((select tx_id from t_paid where installment_id = '00000000-0000-0000-0000-0000000093d2'), 'prestamos'),
  350::numeric,
  'a split cuota keeps debiting its own capital'
);

select is(
  pg_temp.debit((select tx_id from t_paid where installment_id = '00000000-0000-0000-0000-0000000093d3'), 'prestamos'),
  250::numeric,
  'the last unsplit cuota pays only the capital the schedule still owes'
);

select is(
  (select coalesce(sum(l.debit), 0)
     from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'transactions' and not je.is_reversal
      and je.source_id = (select tx_id from t_paid where installment_id = '00000000-0000-0000-0000-0000000093d3')
      and l.chart_of_accounts_id <> public.find_account_by_role('prestamos')),
  150::numeric,
  'and the rest of it is interest'
);

select is(
  (select coalesce(sum(l.credit - l.debit), 0)
     from public.journal_entry_lines l
     join public.journal_entries je on je.id = l.journal_entry_id
    where l.chart_of_accounts_id = public.find_account_by_role('prestamos')
      and je.source_table = 'transactions'
      and je.source_id in (select id from t_disb union all select tx_id from t_paid)),
  0::numeric,
  'once every cuota is paid the loan liability is zero'
);

select is(
  pg_temp.debit((select tx_id from t_paid where installment_id = '00000000-0000-0000-0000-0000000093d4'), 'prestamos'),
  0::numeric,
  'a loan with no booked liability posts its unsplit cuota as an expense, as before'
);

-- F6 ---------------------------------------------------------------------------------

select throws_ok(
  $$update public.loans set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000093b1'$$,
  '55006',
  null,
  'a loan with its disbursement recorded cannot be cancelled'
);

select throws_ok(
  $$update public.loans set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000093b2'$$,
  '55006',
  null,
  'a loan with a paid cuota cannot be cancelled'
);

select throws_ok(
  $$update public.loans set disbursement_transaction_id = null where id = '00000000-0000-0000-0000-0000000093b1'$$,
  '55006',
  'El desembolso registrado de un préstamo no se puede cambiar',
  'the recorded disbursement cannot be detached'
);

select lives_ok(
  $$update public.loans set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000093b3'$$,
  'a loan with nothing recorded is still cancelled'
);

-- Savings plan --------------------------------------------------------------------

-- Cuota 1 split (900 capital + 50 interest + 10.50 IVA), 2 unsplit, 3 unsplit
-- paid for more than its amount, 4 paid before the loan was loaded.
create temp table t_plan on commit drop as
  select public.create_loan_core(
    jsonb_build_object(
      'kind', 'plan_ahorro', 'description', 'Toyota Plan', 'principal', 4000,
      'currency', 'ARS', 'channel_id', 'jouve_fiscal', 'installments_count', 4,
      'first_due_date', current_date
    ),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date, 'amount', 960.5,
        'capital', 900, 'interest', 50, 'iva', 10.5, 'perception', 0, 'other', 0),
      jsonb_build_object('number', 2, 'due_date', current_date, 'amount', 1000),
      jsonb_build_object('number', 3, 'due_date', current_date, 'amount', 1000),
      jsonb_build_object('number', 4, 'due_date', current_date - 40, 'amount', 1000,
        'capital', 1000, 'interest', 0, 'iva', 0, 'perception', 0, 'other', 0,
        'paid_outside', true)
    ),
    null, null
  ) as id;

create temp table t_plan_paid on commit drop as
  select i.number,
         public.pay_loan_installment(i.id, current_date, '00000000-0000-0000-0000-0000000093a1',
           case when i.number = 3 then 1050 else i.amount end) as tx_id
    from public.loan_installments i
   where i.loan_id = (select id from t_plan) and i.number in (1, 2, 3);

select is(
  pg_temp.debit((select tx_id from t_plan_paid where number = 1), 'planes_ahorro')
    || '/' || pg_temp.debit((select tx_id from t_plan_paid where number = 1), 'intereses_pagados')
    || '/' || pg_temp.debit((select tx_id from t_plan_paid where number = 1), 'iva_credito'),
  '900.00/50.00/10.50',
  'a split plan cuota debits its capital to the plan, interest and IVA as any cuota'
);

select is(
  pg_temp.debit((select tx_id from t_plan_paid where number = 2), 'planes_ahorro'),
  1000::numeric,
  'an unsplit plan cuota adds up whole in the plan'
);

select is(
  pg_temp.debit((select tx_id from t_plan_paid where number = 3), 'planes_ahorro'),
  1050::numeric,
  'a plan cuota paid for another amount adds up whole in the plan'
);

select is(
  (select coalesce(sum(l.credit), 0)
     from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'transactions' and not je.is_reversal
      and je.source_id in (select tx_id from t_plan_paid)
      and l.chart_of_accounts_id = public.find_account_by_role('banco')),
  3010.50::numeric,
  'each plan cuota leaves the bank for what was paid'
);

select is(
  (select count(*)::int
     from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'transactions'
      and je.source_id in (select tx_id from t_plan_paid)
      and l.chart_of_accounts_id in (public.find_account_by_role('gastos'),
                                     public.find_account_by_role('prestamos'))),
  0,
  'a plan never posts to gastos nor to prestamos'
);

select is(
  public.record_loan_bank_payments(
    (select id from t_plan),
    jsonb_build_array(jsonb_build_object('receipt_number', 'P4', 'paid_date', current_date - 40,
      'installment_number', 4, 'total', 1000, 'capital', 1000)),
    current_date - 365, null) ->> 'booked',
  '1',
  'a bank receipt of a cuota of a plan paid before it was loaded is booked'
);

select is(
  (select coalesce(sum(l.debit), 0)
     from public.loan_bank_payments p
     join public.journal_entry_lines l on l.journal_entry_id = p.journal_entry_id
    where p.loan_id = (select id from t_plan)
      and l.chart_of_accounts_id = public.find_account_by_role('planes_ahorro')),
  1000::numeric,
  'and its capital adds up in the plan'
);

select throws_ok(
  $$select public.record_loan_disbursement((select id from t_plan),
      '00000000-0000-0000-0000-0000000093a1', current_date, null)$$,
  '55006',
  'Un plan de ahorro no tiene desembolso',
  'a plan has no disbursement'
);

select throws_ok(
  $$select public.book_loan_opening((select id from t_plan), current_date)$$,
  '23514',
  'Un plan de ahorro no tiene saldo de apertura: sus cuotas suman desde que se cargan',
  'a plan has no opening balance'
);

select is(
  (select a.code ~ '^1\.2\.1\.[0-9]+$' and a.account_type::text = 'activo'
     from public.chart_of_accounts a where a.id = public.find_account_by_role('planes_ahorro')),
  true,
  'Rodados en plan de ahorro is an asset under Bienes de uso'
);

select * from finish();
rollback;
