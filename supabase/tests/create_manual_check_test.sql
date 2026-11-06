-- 20261106110000: a check loaded by hand («Nuevo cheque», cheque scan) is
-- written with its cartera inflow and its 'received' anchor in one call, or
-- not at all. One transaction, rolled back.

begin;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000016f1', 'finance@create-manual-check.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000016f1', 'finance');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000016a1', 'Cartera create_manual_check', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-0000000016a2', 'Banco create_manual_check', 'bank', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000016f1","role":"authenticated"}', true);

create temp table t_check on commit drop as
  select public.create_manual_check(
    'fisico', 'CMC-1', 'Banco CMC', 'Firmante', current_date - 3, current_date + 30,
    150, 'ARS', '00000000-0000-0000-0000-0000000016a1', 'jouve_internal'
  ) as id;

select results_eq(
  $$select k.status, k.source_kind, k.channel_id, k.created_by
      from public.checks k join t_check t on t.id = k.id$$,
  $$values ('en_cartera'::text, 'manual'::text, 'jouve_internal'::text,
            '00000000-0000-0000-0000-0000000016f1'::uuid)$$,
  'the check is manual, en cartera, with its channel and author'
);

select results_eq(
  $$select m.event, m.event_date, m.created_by
      from public.check_movements m join t_check t on t.id = m.check_id$$,
  $$values ('received'::text, current_date - 3,
            '00000000-0000-0000-0000-0000000016f1'::uuid)$$,
  'its only movement is the received anchor, dated on issue'
);

select is(
  (select count(*)::int from public.transactions x join t_check t on t.id = x.manual_check_id
    where x.account_id = '00000000-0000-0000-0000-0000000016a1'
      and x.amount = 150 and x.channel_id = 'jouve_internal'),
  1,
  'it booked the cartera inflow'
);

select throws_ok(
  $$select public.create_manual_check(
      'fisico', 'CMC-2', 'Banco CMC', 'Firmante', current_date, current_date,
      10, 'ARS', '00000000-0000-0000-0000-0000000016a1', '')$$,
  '23514',
  'Elegí el canal del cheque',
  'a check without channel is refused'
);

select throws_ok(
  $$select public.create_manual_check(
      'fisico', 'CMC-3', 'Banco CMC', 'Firmante', current_date, current_date,
      10, 'ARS', '00000000-0000-0000-0000-0000000016a2', 'jouve_internal')$$,
  '23514',
  null,
  'a bank account is refused as the cartera'
);

select is(
  (select count(*)::int from public.checks where bank_name = 'Banco CMC'),
  1,
  'the refused calls left no check behind'
);

select * from finish();
rollback;
