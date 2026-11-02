-- Roadmap 0.7b + 0.8: a third-party check loaded by hand books its cartera
-- inflow, and that movement is changed from the check, never by hand.
-- One transaction, rolled back.

begin;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f8', 'finance@manual-checks.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f8', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c801', '30999999990', 'Cliente Manual', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a801', 'Cartera manual', 'checks', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f8","role":"authenticated"}', true);

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   cartera_account_id, status, source_kind, source_client_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000008c1', 'fisico', 'MC-1', 'Banco X', 'Librador', current_date,
   current_date + 30, 250, 'ARS', '00000000-0000-0000-0000-00000000a801', 'en_cartera', 'manual',
   '00000000-0000-0000-0000-00000000c801', 'jouve_fiscal'),
  ('00000000-0000-0000-0000-0000000008c2', 'fisico', 'MC-2', 'Banco X', 'Librador', current_date,
   current_date + 30, 80, 'ARS', '00000000-0000-0000-0000-00000000a801', 'en_cartera', 'manual',
   null, null);

select is(
  (select count(*)::int from public.transactions
    where manual_check_id = '00000000-0000-0000-0000-0000000008c2'),
  0,
  'a hand-loaded check without channel books nothing yet'
);

update public.checks set channel_id = 'jouve_internal'
 where id = '00000000-0000-0000-0000-0000000008c2';

select is(
  (select count(*)::int from public.transactions
    where manual_check_id = '00000000-0000-0000-0000-0000000008c2'
      and channel_id = 'jouve_internal' and amount = 80),
  1,
  'it books its inflow once it gets a channel'
);

select is(
  (select count(*)::int from public.transactions
    where manual_check_id = '00000000-0000-0000-0000-0000000008c1'
      and account_id = '00000000-0000-0000-0000-00000000a801'
      and kind = 'income' and amount = 250 and channel_id = 'jouve_fiscal'),
  1,
  'a hand-loaded check books its inflow on the cartera'
);

select throws_ok(
  $$update public.transactions set amount = 1
     where manual_check_id = '00000000-0000-0000-0000-0000000008c1'$$,
  '55006',
  null,
  'the inflow of a hand-loaded check cannot be edited by hand'
);

select throws_ok(
  $$delete from public.transactions
     where manual_check_id = '00000000-0000-0000-0000-0000000008c1'$$,
  '55006',
  null,
  'the inflow of a hand-loaded check cannot be deleted by hand'
);

select lives_ok(
  $$update public.transactions set description = 'Cheque MC-1 (nota)'
     where manual_check_id = '00000000-0000-0000-0000-0000000008c1'$$,
  'its description can still be edited'
);

reset role;

select is(
  (select v.source_document from public.v_transactions_tagged v
     join public.transactions t on t.id = v.id
    where t.manual_check_id = '00000000-0000-0000-0000-0000000008c1'),
  'manual_check',
  'Tesorería sees the check as the movement''s owner'
);

select * from finish();
rollback;
