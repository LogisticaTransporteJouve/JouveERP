-- Follow-up of the check sales: a sale entered by mistake is anulled (its
-- checks back in cartera, its movements gone) only while none of its checks
-- moved and its period is open; a sold check that bounces can stay as a
-- debt to the buyer and be paid later with the same movement as an
-- immediate rejection. One transaction, rolled back.

begin;

select plan(16);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set constraints all deferred;

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000047a1', 'Cartera anulación', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-0000000047a2', 'Banco anulación', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-0000000047a3', 'Banco USD anulación', 'bank', 'USD');

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000047c1', 'fisico', 'AN-1', 'Banco X', 'Firmante', current_date, current_date + 60, 100, 'ARS',
   'manual', '00000000-0000-0000-0000-0000000047a1', 'jouve_internal'),
  ('00000000-0000-0000-0000-0000000047c2', 'fisico', 'AN-2', 'Banco X', 'Firmante', current_date, current_date + 90, 50, 'ARS',
   'manual', '00000000-0000-0000-0000-0000000047a1', 'jouve_internal'),
  ('00000000-0000-0000-0000-0000000047c3', 'fisico', 'AN-3', 'Banco X', 'Firmante', current_date, current_date + 30, 80, 'ARS',
   'manual', '00000000-0000-0000-0000-0000000047a1', 'jouve_internal');

select ok(
  has_function_privilege('service_role', 'public.cancel_check_sale(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancel_check_sale(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.reject_sold_check_as_debt(uuid, date, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.pay_check_sale_debt(uuid, uuid, date, uuid)', 'execute'),
  'only the service role cancels a sale or handles a debt'
);

-- 1. Cancelling a sale -------------------------------------------------------------

create temp table t_sale on commit drop as
  select public.sell_checks(
    array['00000000-0000-0000-0000-0000000047c1', '00000000-0000-0000-0000-0000000047c2']::uuid[],
    '00000000-0000-0000-0000-0000000047a2', current_date, 'jouve_internal', 'Financiera Z', null,
    10, 5, null, '00000000-0000-0000-0000-0000000047f1', null) as id;

select throws_ok(
  format($$select public.cancel_check_sale(%L, '  ', null)$$, (select id from t_sale)),
  '23514', 'Contá por qué se anula la venta.',
  'a cancellation says why'
);

select throws_ok(
  format($$update public.check_sales set buyer_name = 'Otro' where id = %L$$, (select id from t_sale)),
  '55006', 'Una venta de cheques no se edita: anulala y cargala de nuevo.',
  'a sale is not edited'
);

insert into public.accounting_closed_periods (period)
  values (to_char(current_date, 'YYYY-MM'));
select throws_ok(
  format($$select public.cancel_check_sale(%L, 'error de carga', null)$$, (select id from t_sale)),
  '55006', null,
  'a sale of a closed period is not anulled'
);
delete from public.accounting_closed_periods where period = to_char(current_date, 'YYYY-MM');

select lives_ok(
  format($$select public.cancel_check_sale(%L, 'error de carga', null)$$, (select id from t_sale)),
  'a sale entered by mistake is anulled'
);
select is(
  (select count(*)::int from public.checks
    where id in ('00000000-0000-0000-0000-0000000047c1', '00000000-0000-0000-0000-0000000047c2')
      and status = 'en_cartera'),
  2, 'its checks are back in cartera'
);
select is(
  (select count(*)::int from public.transactions where check_sale_id = (select id from t_sale)),
  0, 'its transfers, interest and commission are gone'
);
select is(
  (select coalesce(sum(case when kind in ('income', 'transfer_in') then amount else -amount end), 0)
     from public.transactions where account_id = '00000000-0000-0000-0000-0000000047a2'),
  0::numeric, 'the account is as before the sale'
);
select results_eq(
  format($$select status, cancel_reason from public.check_sales where id = %L$$, (select id from t_sale)),
  $$values ('cancelled'::text, 'error de carga'::text)$$,
  'the sale stays, anulled, with its reason'
);
select lives_ok(
  format($$select public.cancel_check_sale(%L, 'otra vez', null)$$, (select id from t_sale)),
  'anulling again is a no-op'
);

-- 2. A rejected sold check as a debt ---------------------------------------------

create temp table t_sale2 on commit drop as
  select public.sell_checks(
    array['00000000-0000-0000-0000-0000000047c1', '00000000-0000-0000-0000-0000000047c3']::uuid[],
    '00000000-0000-0000-0000-0000000047a2', current_date, 'jouve_internal', 'Financiera Z', null,
    0, 0, null, '00000000-0000-0000-0000-0000000047f2', null) as id;

create temp table t_debt on commit drop as
  select public.reject_sold_check_as_debt(
    '00000000-0000-0000-0000-0000000047c1', current_date, 'rebotó', null) as id;

select results_eq(
  $$select c.status, (select count(*)::int from public.transactions
                       where rejected_check_id = c.id)
      from public.checks c where c.id = '00000000-0000-0000-0000-0000000047c1'$$,
  $$values ('rechazado'::text, 0)$$,
  'the check is rejected with no movement yet'
);
select results_eq(
  $$select sale_id, amount, paid_at from public.check_sale_debts where id = (select id from t_debt)$$,
  format($$values (%L::uuid, 100::numeric, null::date)$$, (select id from t_sale2)),
  'the debt to the buyer is recorded, unpaid'
);
select throws_ok(
  format($$select public.cancel_check_sale(%L, 'error', null)$$, (select id from t_sale2)),
  '55006', 'El cheque AN-1 ya no está vendido (rechazado): la venta no se anula.',
  'a sale with a rejected check is not anulled'
);
select throws_ok(
  $$select public.pay_check_sale_debt((select id from t_debt),
      '00000000-0000-0000-0000-0000000047a3', current_date, null)$$,
  '23514', null,
  'the debt is paid from an account in its currency'
);

create temp table t_pay on commit drop as
  select public.pay_check_sale_debt((select id from t_debt),
    '00000000-0000-0000-0000-0000000047a2', current_date, null) as id;
select results_eq(
  $$select t.kind, t.amount, t.rejected_check_id from public.transactions t
     where t.id = (select id from t_pay)$$,
  $$values ('expense'::text, 100::numeric, '00000000-0000-0000-0000-0000000047c1'::uuid)$$,
  'paying it is the movement of an immediate rejection'
);
select is(
  public.pay_check_sale_debt((select id from t_debt),
    '00000000-0000-0000-0000-0000000047a2', current_date, null),
  (select id from t_pay),
  'paying again returns the same movement'
);

select * from finish();
rollback;
