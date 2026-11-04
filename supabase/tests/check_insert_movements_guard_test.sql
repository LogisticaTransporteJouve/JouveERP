-- Audit w6-s4 F3, w6-s2 F1-F3 (20261104130000): a third-party check is
-- inserted by hand only as a manual check en_cartera, a receipt check only
-- by its receipt; its origin is pinned; its history is written only by the
-- check, receipt and import RPCs and the cascades of a document. Every
-- legitimate path still works. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(29);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000013f1', 'finance@check-insert-guard.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000013f1', 'finance');

-- Internal documents need internal counterparties (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000013c1', false, null, 'Cliente guarda cheques', null),
  ('00000000-0000-0000-0000-0000000013c2', false, null, 'Otro cliente guarda cheques', null);
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000013b1', false, null, 'Proveedor guarda cheques', null);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000013a1', 'Cartera guarda cheques', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-0000000013a2', 'Banco guarda cheques', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-0000000013a3', 'Otro banco guarda cheques', 'bank', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000013f1","role":"authenticated"}', true);

-- Receipts --------------------------------------------------------------------------

select lives_ok(
  $$select public.create_receipt(
      'jouve_internal', 1, 13001, '00000000-0000-0000-0000-0000000013c1', current_date, 100, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000013a1', 'amount', 100, 'reference', 'GI-1',
        'check', jsonb_build_object('check_number', 'GI-1', 'bank_name', 'Banco GI',
          'drawer_name', 'Firmante', 'due_date', current_date))),
      '[]'::jsonb, '[]'::jsonb)$$,
  'create_receipt still brings its check into the cartera'
);

create temp table t_rcpt on commit drop as
  select id from public.receipts
   where channel_id = 'jouve_internal' and punto_venta = 1 and numero = 13001;
grant select on t_rcpt to authenticated;

select results_eq(
  $$select k.source_kind, k.amount::numeric, k.source_receipt_id = r.id,
           (select count(*)::int from public.check_movements m
             where m.check_id = k.id and m.event = 'received')
      from public.checks k, t_rcpt r
     where k.check_number = 'GI-1'$$,
  $$values ('receipt'::text, 100::numeric, true, 1)$$,
  'the receipt check and its received movement are there'
);

select throws_ok(
  $$insert into public.checks
      (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       source_kind, source_receipt_id, cartera_account_id)
    values ('fisico', 'GI-X1', 'Banco GI', 'Firmante', current_date, current_date, 500, 'ARS',
       'receipt', (select id from t_rcpt), '00000000-0000-0000-0000-0000000013a1')$$,
  '55006',
  'Un cheque de terceros entra a la cartera solo desde su recibo o cargándolo a mano: no se puede insertar con otro estado ni ligado a un recibo',
  'a finance user cannot insert a receipt check over the API'
);

select throws_ok(
  $$insert into public.checks
      (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       source_kind, source_receipt_id, cartera_account_id, channel_id)
    values ('fisico', 'GI-X2', 'Banco GI', 'Firmante', current_date, current_date, 500, 'ARS',
       'manual', (select id from t_rcpt), '00000000-0000-0000-0000-0000000013a1', 'jouve_internal')$$,
  '55006',
  null,
  'nor a manual check tied to a receipt'
);

select throws_ok(
  $$insert into public.checks
      (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       status, source_kind, cartera_account_id, channel_id)
    values ('fisico', 'GI-X3', 'Banco GI', 'Firmante', current_date, current_date, 500, 'ARS',
       'depositado', 'manual', '00000000-0000-0000-0000-0000000013a1', 'jouve_internal')$$,
  '55006',
  null,
  'nor a check that is already out of the cartera'
);

select lives_ok(
  $$select public.update_receipt(
      (select id from t_rcpt), current_date, 100, null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000013a1', 'amount', 100, 'reference', 'GI-1B',
        'check', jsonb_build_object('check_number', 'GI-1B', 'bank_name', 'Banco GI',
          'drawer_name', 'Firmante', 'due_date', current_date))),
      '[]'::jsonb, '[]'::jsonb)$$,
  'update_receipt still replaces its check'
);

select results_eq(
  $$select k.check_number::text,
           (select count(*)::int from public.check_movements m where m.check_id = k.id)
      from public.checks k, t_rcpt r
     where k.source_receipt_id = r.id$$,
  $$values ('GI-1B'::text, 1)$$,
  'the old check and its history went with its line; the new one has its own'
);

select throws_ok(
  $$update public.checks set source_kind = 'manual' where check_number = 'GI-1B'$$,
  '55006',
  'El monto, la moneda, la cartera, el origen (recibo o cliente) y el estado de un cheque se cambian solo desde sus acciones (depositar, acreditar, rechazar, vender) o desde la orden de pago que lo endosa',
  'a receipt check cannot be turned into a manual one'
);

-- A check loaded by hand ---------------------------------------------------------------

select lives_ok(
  $$insert into public.checks
      (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       source_kind, source_client_id, cartera_account_id, channel_id)
    values ('00000000-0000-0000-0000-0000000013d2', 'fisico', 'GI-2', 'Banco GI', 'Firmante',
       current_date, current_date, 60, 'ARS', 'manual', '00000000-0000-0000-0000-0000000013c1',
       '00000000-0000-0000-0000-0000000013a1', 'jouve_internal')$$,
  'a hand-loaded check en_cartera is still inserted'
);

select lives_ok(
  $$insert into public.check_movements (check_id, event, event_date)
    values ('00000000-0000-0000-0000-0000000013d2', 'received', current_date)$$,
  'and gets its received anchor'
);

select throws_ok(
  $$insert into public.check_movements (check_id, event, event_date)
    values ('00000000-0000-0000-0000-0000000013d2', 'received', current_date)$$,
  '55006',
  'El historial de un cheque lo escriben solo sus acciones (depositar, acreditar, rechazar, vender), su recibo o la orden de pago que lo endosa',
  'a second anchor is refused'
);

select throws_ok(
  $$update public.checks set source_client_id = '00000000-0000-0000-0000-0000000013c2'
     where id = '00000000-0000-0000-0000-0000000013d2'$$,
  '55006',
  null,
  'its client cannot be PATCHed'
);

select lives_ok(
  $$update public.checks set notes = 'nota' where id = '00000000-0000-0000-0000-0000000013d2'$$,
  'its notes still can'
);

-- Deposit and rejection --------------------------------------------------------------

select lives_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000013d2', '00000000-0000-0000-0000-0000000013a2',
      current_date, null, null)$$,
  'deposit_check still deposits it'
);

select throws_ok(
  $$insert into public.check_movements (check_id, event, event_date, destination_account_id)
    values ('00000000-0000-0000-0000-0000000013d2', 'deposited', current_date,
            '00000000-0000-0000-0000-0000000013a3')$$,
  '55006',
  null,
  'a forged deposit movement is refused'
);

select lives_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000013d2', '00000000-0000-0000-0000-0000000013a2',
      current_date, null, null)$$,
  'reject_check still bounces it from the bank of the deposit'
);

select is(
  (select array_agg(event order by event) from public.check_movements
    where check_id = '00000000-0000-0000-0000-0000000013d2'),
  array['deposited', 'received', 'rejected'],
  'its history is the anchor, the deposit and the rejection'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$delete from public.check_movements where check_id = '00000000-0000-0000-0000-0000000013d2'$$,
  '55006',
  null,
  'not even the table owner deletes its history'
);

select throws_ok(
  $$update public.check_movements set destination_account_id = '00000000-0000-0000-0000-0000000013a3'
     where check_id = '00000000-0000-0000-0000-0000000013d2' and event = 'deposited'$$,
  '55006',
  null,
  'nor rewrites it'
);

-- Credit, sale and endorsement --------------------------------------------------------

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000013d3', 'fisico', 'GI-3', 'Banco GI', 'Firmante', current_date,
   current_date, 30, 'ARS', 'manual', '00000000-0000-0000-0000-0000000013a1', 'jouve_internal'),
  ('00000000-0000-0000-0000-0000000013d4', 'fisico', 'GI-4', 'Banco GI', 'Firmante', current_date,
   current_date + 60, 20, 'ARS', 'manual', '00000000-0000-0000-0000-0000000013a1', 'jouve_internal'),
  ('00000000-0000-0000-0000-0000000013d5', 'fisico', 'GI-5', 'Banco GI', 'Firmante', current_date,
   current_date, 40, 'ARS', 'manual', '00000000-0000-0000-0000-0000000013a1', 'jouve_internal');

select lives_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000013d3', '00000000-0000-0000-0000-0000000013a2',
      current_date, null, null)$$,
  'a second check is deposited'
);

select lives_ok(
  $$select public.credit_check('00000000-0000-0000-0000-0000000013d3', current_date, null)$$,
  'credit_check still credits it'
);

create temp table t_sale on commit drop as
  select public.sell_checks(
    array['00000000-0000-0000-0000-0000000013d4']::uuid[],
    '00000000-0000-0000-0000-0000000013a2', current_date, 'jouve_internal', 'Financiera GI', null,
    0, 0, null, '00000000-0000-0000-0000-0000000013e1', null) as id;

select lives_ok(
  format($$select public.cancel_check_sale(%L, 'error de carga', null)$$, (select id from t_sale)),
  'cancel_check_sale still anuls the sale'
);

select results_eq(
  $$select status::text,
           (select count(*)::int from public.check_movements m
             where m.check_id = k.id and m.event = 'sold')
      from public.checks k where id = '00000000-0000-0000-0000-0000000013d4'$$,
  $$values ('en_cartera'::text, 0)$$,
  'the cascade put the check back in cartera and removed its sale movement'
);

select lives_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 13101, '00000000-0000-0000-0000-0000000013b1', current_date, 40, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000013d5')),
      '[]'::jsonb)$$,
  'create_payment_order still endorses a check'
);

update public.payment_orders set status = 'canceled'
 where channel_id = 'jouve_internal' and punto_venta = 1 and numero = 13101;

select results_eq(
  $$select status::text,
           (select count(*)::int from public.check_movements m
             where m.check_id = k.id and m.event = 'endorsed')
      from public.checks k where id = '00000000-0000-0000-0000-0000000013d5'$$,
  $$values ('en_cartera'::text, 0)$$,
  'cancelling the order put the check back and removed its endorsement'
);

-- The importer ---------------------------------------------------------------------------

create temp table t_import on commit drop as
  select public.commit_import_run(
    'checks', 'cheques.xlsx', repeat('c', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'kind', 'fisico', 'check_number', 'GI-IMP', 'bank_name', 'Banco GI', 'drawer_name', 'Firmante',
      'drawer_cuit', null, 'issue_date', current_date, 'due_date', current_date, 'amount', 25,
      'currency', 'ARS', 'cartera_account_id', '00000000-0000-0000-0000-0000000013a1',
      'channel_id', 'jouve_internal', 'notes', null)),
    '00000000-0000-0000-0000-0000000013f1') as id;

select results_eq(
  $$select k.source_kind, k.status,
           (select count(*)::int from public.check_movements m
             where m.check_id = k.id and m.event = 'received')
      from public.checks k where k.check_number = 'GI-IMP'$$,
  $$values ('manual'::text, 'en_cartera'::text, 1)$$,
  'commit_import_run still loads a check with its anchor'
);

select lives_ok(
  format($$select public.undo_import_run(%L, '00000000-0000-0000-0000-0000000013f1')$$,
         (select id from t_import)),
  'undo_import_run still removes it'
);

select is(
  (select count(*)::int from public.checks where check_number = 'GI-IMP'),
  0,
  'the imported check is gone'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_check_movement()', 'execute')
  and not has_function_privilege('anon', 'public.guard_check_movement()', 'execute'),
  'the movements guard is not callable from the API'
);

select * from finish();
rollback;
