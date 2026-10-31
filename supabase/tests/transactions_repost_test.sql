-- Loose movements re-post when an entry column changes (20261031180535):
-- the amount re-posts, the description never does (closed period included),
-- moving a movement to an internal channel drops its entry, and a transfer leg
-- cannot change channel. Deferred triggers run at `set constraints all
-- immediate`. One transaction, rolled back.

begin;

select plan(8);

create function pg_temp.live_entries(p_id uuid) returns int
language sql as $$
  select count(*)::int from public.journal_entries je
   where je.source_table = 'transactions' and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008f1', 'finance@transactions-repost.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000008f1', 'finance');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a801', 'Banco Movimientos', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a802', 'Caja Movimientos', 'cash', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000008f1","role":"authenticated"}', true);

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-0000000008e1', '00000000-0000-0000-0000-00000000a801', 'jouve_fiscal',
   'expense', 100, 'ARS', current_date, date_trunc('month', current_date)::date, 'Gasto'),
  ('00000000-0000-0000-0000-0000000008e2', '00000000-0000-0000-0000-00000000a801', 'jouve_fiscal',
   'expense', 200, 'ARS', '1999-02-10', '1999-02-01', 'Gasto cerrado'),
  ('00000000-0000-0000-0000-0000000008e3', '00000000-0000-0000-0000-00000000a801', 'jouve_fiscal',
   'expense', 300, 'ARS', current_date, date_trunc('month', current_date)::date, 'Sueldo');

select public.create_transfer(
  '00000000-0000-0000-0000-00000000a801', '00000000-0000-0000-0000-00000000a802', 'jouve_fiscal',
  50, 'ARS', current_date, date_trunc('month', current_date)::date, 'Transferencia');

set constraints all immediate;

set constraints all deferred;
update public.transactions set amount = 150 where id = '00000000-0000-0000-0000-0000000008e1';
set constraints all immediate;
select is(pg_temp.live_entries('00000000-0000-0000-0000-0000000008e1'), 1, 'changing the amount leaves one live entry');
select is(
  (select l.debit from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
    where e.source_id = '00000000-0000-0000-0000-0000000008e1' and l.debit > 0),
  150::numeric,
  'for the new amount'
);
select is(
  (select count(*)::int from public.journal_entries where source_id = '00000000-0000-0000-0000-0000000008e1'),
  1,
  'the old entry is replaced'
);

reset role;
insert into public.accounting_closed_periods (period) values ('1999-02');
set local role authenticated;

select lives_ok(
  $$set constraints all deferred;
    update public.transactions set description = 'Gasto corregido'
     where id = '00000000-0000-0000-0000-0000000008e2';
    set constraints all immediate$$,
  'the description of a movement in a closed period can change'
);
select throws_ok(
  $$set constraints all deferred;
    update public.transactions set amount = 250 where id = '00000000-0000-0000-0000-0000000008e2';
    set constraints all immediate$$,
  '55006',
  null,
  'the amount of a movement in a closed period cannot'
);

set constraints all deferred;
update public.transactions set channel_id = 'jouve_internal' where id = '00000000-0000-0000-0000-0000000008e3';
set constraints all immediate;
select is(pg_temp.live_entries('00000000-0000-0000-0000-0000000008e3'), 0, 'a movement moved to an internal channel has no entry');

select throws_ok(
  $$update public.transactions set channel_id = 'jouve_internal'
     where account_id = '00000000-0000-0000-0000-00000000a802' and kind = 'transfer_in'$$,
  '55006',
  'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un recibo, orden de pago, transferencia o comprobante',
  'a transfer leg cannot change channel'
);

reset role;
select ok(
  not has_function_privilege('authenticated', 'public.repost_journal_trigger()', 'execute'),
  'authenticated cannot run the re-post trigger function'
);

select * from finish();

rollback;
