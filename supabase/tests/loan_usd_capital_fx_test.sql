-- Audit w2-s2 F6: the capital of a USD loan cuota takes prestamos off at the
-- disbursement's rate and books the rate difference in diferencia_cambio, so
-- a USD loan paid off leaves prestamos at 0 in pesos; an ARS loan posts as
-- before. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(5);

create function pg_temp.live_side(p_ids uuid[], p_role text, p_side text)
returns numeric
language sql as $$
  select coalesce(sum(case when p_side = 'debit' then l.debit else l.credit end), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
   where je.source_table = 'transactions' and je.source_id = any (p_ids) and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and c.system_role::text = p_role;
$$;

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a131', 'Banco USD préstamo', 'bank', 'USD');

-- No seed rate is that old: March 1991 takes 1000, April 1991 takes 1200.
insert into public.exchange_rates (currency, rate_date, rate, source) values
  ('USD', '1991-03-01', 1000, 'manual'),
  ('USD', '1991-04-01', 1200, 'manual');

-- USD 2 in two cuotas: an unsplit one of 1 and a split one (1 capital).
insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-00000000b131', 'jouve_fiscal', 'USD', 'Préstamo en dólares',
   '1991-04-05', 2, 'prestamo', 2);

insert into public.loan_installments (id, loan_id, number, due_date, amount) values
  ('00000000-0000-0000-0000-00000000d131', '00000000-0000-0000-0000-00000000b131', 1, '1991-04-05', 1),
  ('00000000-0000-0000-0000-00000000d132', '00000000-0000-0000-0000-00000000b131', 2, '1991-04-05', 1);
update public.loan_installments
   set capital_amount = 1, interest_amount = 0, iva_amount = 0,
       perception_amount = 0, other_charges_amount = 0
 where id = '00000000-0000-0000-0000-00000000d132';

create temp table t_disb on commit drop as
  select public.record_loan_disbursement('00000000-0000-0000-0000-00000000b131',
    '00000000-0000-0000-0000-00000000a131', '1991-03-05', null) as id;

create temp table t_paid on commit drop as
  select i.id as installment_id,
         public.pay_loan_installment(i.id, '1991-04-05', '00000000-0000-0000-0000-00000000a131', i.amount) as tx_id
    from public.loan_installments i
   where i.loan_id = '00000000-0000-0000-0000-00000000b131';

set constraints all immediate;
set constraints all deferred;

select is(
  pg_temp.live_side((select array_agg(tx_id) from t_paid), 'prestamos', 'debit'),
  2000::numeric,
  'both cuotas take prestamos off at the disbursement''s rate'
);

select is(
  pg_temp.live_side((select array_agg(tx_id) from t_paid), 'diferencia_cambio', 'debit'),
  400::numeric,
  'the rate difference on the capital is a loss in diferencia_cambio'
);

select is(
  pg_temp.live_side((select array_agg(id) from t_disb), 'prestamos', 'credit')
    - pg_temp.live_side((select array_agg(tx_id) from t_paid), 'prestamos', 'debit'),
  0::numeric,
  'prestamos ends at 0 in pesos once the loan is paid off'
);

select is(
  (select coalesce(sum(l.debit) - sum(l.credit), 0)
     from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'transactions' and je.source_id in (select tx_id from t_paid)),
  0::numeric,
  'the cuota entries balance'
);

select is(
  public.loan_capital_journal_lines('00000000-0000-0000-0000-00000000b131', 1200, 1200, 'ARS', 'x'),
  jsonb_build_array(jsonb_build_object('system_role', 'prestamos', 'debit', 1200, 'description', 'x — capital')),
  'an ARS cuota keeps its single prestamos line'
);

select * from finish();
rollback;
