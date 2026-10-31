-- 20261031193400_db_integrity_authz: cancelling a document as finance wipes
-- its movements, document-owned movements cannot be deleted or rewritten from
-- treasury (the payroll sync still can), history-holding FKs restrict, admin
-- writes what the matrix grants, and the grants are closed.
-- One transaction, rolled back.

begin;

select plan(29);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007f1', 'finance@db-integrity.test'),
  ('00000000-0000-0000-0000-0000000007f2', 'owner@db-integrity.test'),
  ('00000000-0000-0000-0000-0000000007f3', 'admin@db-integrity.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000007f1', 'finance'),
  ('00000000-0000-0000-0000-0000000007f2', 'owner'),
  ('00000000-0000-0000-0000-0000000007f3', 'admin');

create function pg_temp.act_as(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c701', '20777777772', 'Cliente Integridad', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b701', '30777777773', 'Proveedor Integridad', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000000b702', '30777777774', 'Proveedor Solo Saldo', 'responsable_inscripto');
insert into public.supplier_categories (id, slug, name) values
  ('00000000-0000-0000-0000-0000000007ca', 'integridad_test', 'Categoría Integridad');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a701', 'Banco Integridad', 'bank', 'ARS');

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
values
  ('00000000-0000-0000-0000-0000000007c1', 'jouve_internal', 1, 97001, '00000000-0000-0000-0000-00000000b701', current_date, 100, 'ARS'),
  ('00000000-0000-0000-0000-0000000007c2', 'jouve_internal', 1, 97002, '00000000-0000-0000-0000-00000000b701', current_date, 50, 'ARS');
insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency)
values
  ('00000000-0000-0000-0000-0000000007b1', 'jouve_internal', 1, 97001, '00000000-0000-0000-0000-00000000c701', current_date, 200, 'ARS');
insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, payment_order_id, receipt_id)
values
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-00000000a701', 'jouve_internal',
   'expense', 100, 'ARS', current_date, date_trunc('month', current_date)::date, 'OP 1', '00000000-0000-0000-0000-0000000007c1', null),
  ('00000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-00000000a701', 'jouve_internal',
   'expense', 50, 'ARS', current_date, date_trunc('month', current_date)::date, 'OP 2', '00000000-0000-0000-0000-0000000007c2', null),
  ('00000000-0000-0000-0000-0000000007e3', '00000000-0000-0000-0000-00000000a701', 'jouve_internal',
   'income', 200, 'ARS', current_date, date_trunc('month', current_date)::date, 'Recibo 1', null, '00000000-0000-0000-0000-0000000007b1'),
  ('00000000-0000-0000-0000-0000000007e4', '00000000-0000-0000-0000-00000000a701', 'jouve_internal',
   'expense', 10, 'ARS', current_date, date_trunc('month', current_date)::date, 'Gasto suelto', null, null);

insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000000007d1', 'Empleado Integridad', 'mensual', '2020-01-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000000007d2', 2030, 1);
insert into public.payroll_entries (id, period_id, employee_id) values
  ('00000000-0000-0000-0000-0000000007d3', '00000000-0000-0000-0000-0000000007d2', '00000000-0000-0000-0000-0000000007d1');
insert into public.payroll_payments (id, entry_id, account_id, channel_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-0000000007d4', '00000000-0000-0000-0000-0000000007d3',
   '00000000-0000-0000-0000-00000000a701', 'jouve_internal', 300, 'transferencia', current_date);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000000007a1', 'AA777AA', 'camion');
insert into public.fuel_loads (vehicle_id, load_date, liters, amount) values
  ('00000000-0000-0000-0000-0000000007a1', current_date, 10, 1000);
insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000000007cc', 'CC-INT', 'Centro integridad');
update public.transactions set cost_center_id = '00000000-0000-0000-0000-0000000007cc'
 where id = '00000000-0000-0000-0000-0000000007e4';
insert into public.supplier_opening_balances (supplier_id, opening_date, target_balance, total_settled)
values ('00000000-0000-0000-0000-00000000b702', current_date, 0, 0);

-- Compras F1: finance cancels; the movements go with the document ------------

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000007f1');

update public.payment_orders set status = 'canceled', canceled_at = now()
 where id = '00000000-0000-0000-0000-0000000007c1';
select is(
  (select count(*)::int from public.transactions where payment_order_id = '00000000-0000-0000-0000-0000000007c1'),
  0,
  'a payment order cancelled by finance deletes its cash movements'
);

update public.receipts set status = 'canceled'
 where id = '00000000-0000-0000-0000-0000000007b1';
select is(
  (select count(*)::int from public.transactions where receipt_id = '00000000-0000-0000-0000-0000000007b1'),
  0,
  'a receipt cancelled by finance deletes its cash movements'
);

-- FKs S1: document-owned movements are not deleted from treasury --------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000007f2');

select throws_ok(
  $$delete from public.transactions where id = '00000000-0000-0000-0000-0000000007e2'$$,
  '55006',
  'No se puede borrar un movimiento generado por una orden de pago: anulá o editá el documento de origen',
  'the owner cannot delete a payment order''s movement'
);

select throws_ok(
  $$delete from public.transactions
     where id = (select transaction_id from public.payroll_payments where id = '00000000-0000-0000-0000-0000000007d4')$$,
  '55006',
  'No se puede borrar un movimiento generado por un pago de sueldo: anulá o editá el documento de origen',
  'the owner cannot delete a payroll payment''s movement'
);

select throws_ok(
  $$update public.transactions set amount = 1
     where id = (select transaction_id from public.payroll_payments where id = '00000000-0000-0000-0000-0000000007d4')$$,
  '55006',
  null,
  'nor change the amount of a payroll payment''s movement'
);

select lives_ok(
  $$update public.transactions set description = 'Sueldo con nota'
     where id = (select transaction_id from public.payroll_payments where id = '00000000-0000-0000-0000-0000000007d4')$$,
  'its description stays editable'
);

select lives_ok(
  $$update public.payroll_payments set amount = 350 where id = '00000000-0000-0000-0000-0000000007d4'$$,
  'editing the payroll payment still rewrites its movement'
);
select is(
  (select t.amount from public.transactions t
     join public.payroll_payments p on p.transaction_id = t.id
    where p.id = '00000000-0000-0000-0000-0000000007d4'),
  350::numeric,
  'with the new amount'
);

select lives_ok(
  $$delete from public.transactions where id = '00000000-0000-0000-0000-0000000007e4'$$,
  'a movement no document owns can still be deleted'
);

-- The writers that rebuild a document's movements still can.
select lives_ok(
  $$select public.update_payment_order('00000000-0000-0000-0000-0000000007c2', current_date, 60, null,
      '[{"account_id":"00000000-0000-0000-0000-00000000a701","amount":60}]'::jsonb, '[]'::jsonb)$$,
  'update_payment_order rebuilds its movements'
);
select is(
  (select array_agg(amount) from public.transactions where payment_order_id = '00000000-0000-0000-0000-0000000007c2'),
  array[60::numeric],
  'leaving only the new one'
);
select lives_ok(
  $$select public.apply_account_opening_balance('00000000-0000-0000-0000-00000000a701', current_date - 30, 1000, 'jouve_internal', null);
    select public.apply_account_opening_balance('00000000-0000-0000-0000-00000000a701', current_date - 30, 2000, 'jouve_internal', null)$$,
  're-applying an account opening balance replaces its adjustment movement'
);
select throws_ok(
  $$delete from public.transactions
     where id = (select adjustment_transaction_id from public.account_opening_balances
                  where account_id = '00000000-0000-0000-0000-00000000a701')$$,
  '55006',
  null,
  'but the adjustment movement is not deleted from treasury'
);

create temp table payroll_tx on commit drop as
  select transaction_id as id from public.payroll_payments where id = '00000000-0000-0000-0000-0000000007d4';

select pg_temp.act_as('00000000-0000-0000-0000-0000000007f1');
select lives_ok(
  $$delete from public.payroll_payments where id = '00000000-0000-0000-0000-0000000007d4'$$,
  'deleting the payroll payment still works'
);
select is(
  (select count(*)::int from public.transactions where id in (select id from payroll_tx)),
  0,
  'and deletes its movement'
);

-- RLS S1: admin writes what the matrix grants ----------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000007f3');
select lives_ok(
  $$insert into public.transactions (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
    values ('00000000-0000-0000-0000-00000000a701', 'jouve_internal', 'income', 5, 'ARS', current_date,
            date_trunc('month', current_date)::date, 'Admin')$$,
  'admin can insert a transaction'
);
select results_eq(
  $$with u as (update public.payment_orders set notes = 'admin' where id = '00000000-0000-0000-0000-0000000007c2' returning 1)
    select count(*)::int from u$$,
  $$values (1)$$,
  'admin can update a payment order'
);

-- RLS S5: finance deletes a supplier category ---------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000007f1');
select results_eq(
  $$with d as (delete from public.supplier_categories where id = '00000000-0000-0000-0000-0000000007ca' returning 1)
    select count(*)::int from d$$,
  $$values (1)$$,
  'finance can delete a supplier category'
);

-- RLS S2: the client opening balance is owner-only ----------------------------

select throws_ok(
  $$select public.apply_client_opening_balance('00000000-0000-0000-0000-00000000c701', current_date, 0, null)$$,
  '42501',
  null,
  'finance cannot adjust a client opening balance'
);

reset role;

-- FKs S2, M2, Módulos S6: history blocks the delete ----------------------------

select throws_ok(
  $$delete from public.suppliers where id = '00000000-0000-0000-0000-00000000b702'$$,
  '23503',
  null,
  'a supplier with an opening balance is not deleted'
);
select throws_ok(
  $$delete from public.vehicles where id = '00000000-0000-0000-0000-0000000007a1'$$,
  '23503',
  null,
  'a vehicle with fuel loads is not deleted'
);
insert into public.transactions
  (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, cost_center_id)
values ('00000000-0000-0000-0000-00000000a701', 'jouve_internal', 'expense', 7, 'ARS', current_date,
        date_trunc('month', current_date)::date, 'Con centro', '00000000-0000-0000-0000-0000000007cc');
select throws_ok(
  $$delete from public.cost_centers where id = '00000000-0000-0000-0000-0000000007cc'$$,
  '23503',
  null,
  'a cost center in use is not deleted'
);

-- M6: journal source domain ----------------------------------------------------

select throws_ok(
  $$insert into public.journal_entries (entry_date, accrual_period, description, source_table, source_id)
    values (current_date, to_char(current_date, 'YYYY-MM'), 'x', 'nope', gen_random_uuid())$$,
  '23514',
  null,
  'journal_entries.source_table is pinned to the emitters'
);

-- Grants --------------------------------------------------------------------------

select ok(not has_function_privilege('anon', 'public.ai_usage_today()', 'execute'), 'anon cannot run ai_usage_today');
select ok(not has_function_privilege('authenticated', 'public.ai_usage_today()', 'execute'), 'authenticated cannot run ai_usage_today');
select ok(not has_function_privilege('anon', 'public.notification_type_enabled(uuid, text)', 'execute'), 'anon cannot run notification_type_enabled');
select ok(not has_function_privilege('anon', 'public.apply_client_opening_balance(uuid, date, numeric, text)', 'execute'), 'anon cannot run apply_client_opening_balance');
select ok(not has_function_privilege('anon', 'public.list_chat_assignable_users()', 'execute'), 'anon cannot run list_chat_assignable_users');
select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and (has_table_privilege('anon', c.oid, 'truncate') or has_table_privilege('authenticated', c.oid, 'truncate')
         or has_table_privilege('anon', c.oid, 'trigger') or has_table_privilege('authenticated', c.oid, 'trigger')
         or has_table_privilege('authenticated', c.oid, 'references'))$$,
  'no API role can truncate, add triggers to or reference a public table'
);

select * from finish();
rollback;
