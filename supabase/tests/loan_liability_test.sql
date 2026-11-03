-- Auditoría W1 · S2 F5 and F6: an unsplit cuota of a loan with its
-- disbursement recorded pays down prestamos (capital first, along the
-- schedule), a split cuota keeps its split, and a loan with money recorded
-- cannot be cancelled or deleted. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(10);

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

select * from finish();
rollback;
