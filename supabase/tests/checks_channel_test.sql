-- checks / issued_checks carry the channel of their document: inherited on
-- insert, never changed, used by deposits, rejections, endorsements and the
-- check journals. backfill_check_channels reads documents only.
-- One transaction, rolled back.

begin;

select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'finance@checks-channel.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f1', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c101', '20333333334', 'Cliente Cheques', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b201', '30999999990', 'Proveedor Cheques', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a001', 'Cartera test', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-00000000a002', 'Banco test', 'bank', 'ARS');

-- Internal receipts only: their deferred journals are skipped, so
-- `set constraints all immediate` below only posts the fiscal payment orders.
insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency) values
  ('00000000-0000-0000-0000-0000000006a1', 'jouve_internal', 1, 901, '00000000-0000-0000-0000-00000000c101', current_date, 100, 'ARS');

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency) values
  ('00000000-0000-0000-0000-0000000007a1', 'jouve_internal', 1, 901, '00000000-0000-0000-0000-00000000b201', current_date, 100, 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);

-- Inheritance and immutability ---------------------------------------------------

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, source_receipt_id, cartera_account_id)
values
  ('00000000-0000-0000-0000-0000000008a1', 'fisico', 'CH-1', 'Banco X', 'Firmante', current_date, current_date, 100, 'ARS',
   'receipt', '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-00000000a001');

select is(
  (select channel_id from public.checks where id = '00000000-0000-0000-0000-0000000008a1'),
  'jouve_internal',
  'a check of an internal receipt is internal'
);

select throws_ok(
  $$insert into public.checks
      (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       source_kind, source_receipt_id, cartera_account_id, channel_id)
    values ('fisico', 'CH-2', 'Banco X', 'Firmante', current_date, current_date, 100, 'ARS',
       'receipt', '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal')$$,
  '23514',
  'El cheque es de otro canal que su recibo: un cheque va en el canal de su documento',
  'a receipt check cannot take another channel'
);

select throws_ok(
  $$update public.checks set channel_id = 'jouve_fiscal'
     where id = '00000000-0000-0000-0000-0000000008a1'$$,
  '23514',
  'El canal de un cheque no se puede cambiar una vez asignado',
  'a check''s channel cannot change'
);

-- Manual checks: one without channel (historical shape), one fiscal.
insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000008b1', 'fisico', 'CH-3', 'Banco X', 'Firmante', current_date, current_date, 50, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a001', null),
  ('00000000-0000-0000-0000-0000000008b2', 'fisico', 'CH-4', 'Banco X', 'Firmante', current_date, current_date, 50, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a001', null),
  ('00000000-0000-0000-0000-0000000008b3', 'fisico', 'CH-5', 'Banco X', 'Firmante', current_date, current_date, 70, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal'),
  ('00000000-0000-0000-0000-0000000008b4', 'fisico', 'CH-6', 'Banco X', 'Firmante', current_date, current_date, 30, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a001', null),
  ('00000000-0000-0000-0000-0000000008b5', 'fisico', 'CH-7', 'Banco X', 'Firmante', current_date, current_date, 40, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal');

select is(
  (select channel_id from public.checks where id = '00000000-0000-0000-0000-0000000008b1'),
  null,
  'a manual check may start without channel'
);

-- Deposit ---------------------------------------------------------------------------

select throws_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000a002',
      current_date, 'jouve_fiscal', null)$$,
  '23514',
  'El cheque ya tiene canal: se deposita en el canal del cheque',
  'an internal check cannot be deposited on the fiscal channel'
);

select lives_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000a002',
      current_date, null, null)$$,
  'a check with channel deposits with p_channel_id NULL'
);

select is(
  (select array_agg(distinct t.channel_id)
     from public.check_movements m
     join public.transactions t on t.id = m.transaction_id or t.transfer_pair_id = m.transaction_id
    where m.check_id = '00000000-0000-0000-0000-0000000008a1' and m.event = 'deposited'),
  array['jouve_internal'],
  'the deposit transfer takes the check''s channel'
);

select throws_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-00000000a002',
      current_date, null, null)$$,
  '23514',
  'El cheque no tiene canal: elegí el canal del depósito',
  'a check without channel needs p_channel_id'
);

select lives_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-00000000a002',
      current_date, 'jouve_fiscal', null)$$,
  'a check without channel deposits on the chosen channel'
);

select is(
  (select channel_id from public.checks where id = '00000000-0000-0000-0000-0000000008b1'),
  'jouve_fiscal',
  'the deposit fixes the channel of a check without one'
);

-- Rejection -------------------------------------------------------------------------

select throws_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000a002',
      current_date, 'jouve_fiscal', null)$$,
  '23514',
  'El cheque ya tiene canal: el rechazo va en el canal del cheque',
  'an internal check cannot be rejected on the fiscal channel'
);

select throws_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008b4', '00000000-0000-0000-0000-00000000a002',
      current_date, null, null)$$,
  '23514',
  'El cheque no tiene canal: elegí el canal del rechazo',
  'rejecting a check without channel needs p_channel_id'
);

select lives_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000a002',
      current_date, null, null)$$,
  'a check with channel is rejected with p_channel_id NULL'
);

select is(
  (select channel_id from public.transactions
    where description = 'Cheque rechazado CH-1' and kind = 'expense'),
  'jouve_internal',
  'the rejection expense takes the check''s channel'
);

-- Endorsement -----------------------------------------------------------------------

select throws_ok(
  $$insert into public.payment_order_payment_lines (payment_order_id, account_id, amount, endorsed_check_id)
    values ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000a001', 70,
            '00000000-0000-0000-0000-0000000008b3')$$,
  '23514',
  'El cheque es de otro canal que la orden de pago: solo se endosa en una OP de su mismo canal',
  'a fiscal check cannot be endorsed in an internal payment order'
);

select lives_ok(
  $$insert into public.payment_order_payment_lines (payment_order_id, account_id, amount, endorsed_check_id)
    values ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000a001', 50,
            '00000000-0000-0000-0000-0000000008b2')$$,
  'a check without channel can be endorsed'
);

select is(
  (select channel_id from public.checks where id = '00000000-0000-0000-0000-0000000008b2'),
  'jouve_internal',
  'the endorsement fixes the payment order''s channel on the check'
);

-- An endorsed check of an internal payment order bounces: no journal.
update public.checks set status = 'endosado' where id = '00000000-0000-0000-0000-0000000008b2';
update public.checks set status = 'rechazado' where id = '00000000-0000-0000-0000-0000000008b2';

-- Issued checks ---------------------------------------------------------------------

insert into public.issued_checks
  (id, kind, check_number, bank_name, issue_date, due_date, amount, currency, bank_account_id, payment_order_id)
values
  ('00000000-0000-0000-0000-0000000009a1', 'fisico', 'IC-1', 'Banco test', current_date, current_date, 100, 'ARS',
   '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000007a1');

select is(
  (select channel_id from public.issued_checks where id = '00000000-0000-0000-0000-0000000009a1'),
  'jouve_internal',
  'an issued check takes its payment order''s channel'
);

select throws_ok(
  $$insert into public.issued_checks
      (kind, check_number, bank_name, issue_date, due_date, amount, currency, bank_account_id,
       payment_order_id, channel_id)
    values ('fisico', 'IC-2', 'Banco test', current_date, current_date, 100, 'ARS',
       '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000007a1', 'jouve_fiscal')$$,
  '23514',
  'El cheque es de otro canal que su orden de pago: un cheque va en el canal de su documento',
  'an issued check cannot take another channel than its payment order'
);

update public.issued_checks set status = 'cashed', cashed_at = current_date
 where id = '00000000-0000-0000-0000-0000000009a1';

-- Fiscal payment orders, through the RPC so their lines balance: one issues a
-- check (then cancelled), one endorses a fiscal check (then bounced).
select public.create_payment_order(
  'jouve_fiscal', 1, 902, '00000000-0000-0000-0000-00000000b201', current_date, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a002', 'amount', 100,
    'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'IC-3', 'bank_name', 'Banco test',
                                       'due_date', current_date))),
  '[]'::jsonb);

select public.create_payment_order(
  'jouve_fiscal', 1, 903, '00000000-0000-0000-0000-00000000b201', current_date, 40, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000008b5')),
  '[]'::jsonb);

set constraints all immediate;
set constraints all deferred;

update public.payment_orders set status = 'canceled'
 where punto_venta = 1 and numero = 902 and channel_id = 'jouve_fiscal';

update public.checks set status = 'rechazado' where id = '00000000-0000-0000-0000-0000000008b5';

reset role;

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'checks' and source_id = '00000000-0000-0000-0000-0000000008b2'),
  0,
  'a bounced endorsed check of an internal payment order posts nothing'
);

select is(
  (select channel_id from public.journal_entries
    where source_table = 'checks' and source_id = '00000000-0000-0000-0000-0000000008b5'),
  'jouve_fiscal',
  'a bounced endorsed check of a fiscal payment order posts on its channel'
);

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'issued_checks' and source_id = '00000000-0000-0000-0000-0000000009a1'),
  0,
  'an issued check of an internal payment order posts nothing when cashed'
);

select is(
  (select count(*)::int
     from public.journal_entries je
     join public.payment_orders po on po.id = je.source_id
    where je.source_table = 'payment_orders' and je.is_reversal
      and po.punto_venta = 1 and po.numero = 902 and po.channel_id = 'jouve_fiscal')
  + (select count(*)::int
       from public.journal_entries je
       join public.issued_checks ic on ic.id = je.source_id
      where je.source_table = 'issued_checks' and ic.check_number = 'IC-3'),
  1,
  'cancelling a fiscal payment order with an issued check reverses once'
);

-- Backfill and diagnostic -----------------------------------------------------------
-- Rows in the pre-migration shape (channel NULL), written with triggers off: a
-- receipt check deposited by hand on the fiscal channel, a manual check
-- endorsed in an internal payment order, a manual check only deposited.

set local session_replication_role = replica;

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, source_receipt_id, cartera_account_id, status)
values
  ('00000000-0000-0000-0000-000000000ba1', 'fisico', 'BF-1', 'Banco Y', 'Firmante', current_date, current_date, 10, 'ARS',
   'receipt', '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-00000000a001', 'depositado'),
  ('00000000-0000-0000-0000-000000000ba2', 'fisico', 'BF-2', 'Banco Y', 'Firmante', current_date, current_date, 10, 'ARS',
   'manual', null, '00000000-0000-0000-0000-00000000a001', 'endosado'),
  ('00000000-0000-0000-0000-000000000ba3', 'fisico', 'BF-3', 'Banco Y', 'Firmante', current_date, current_date, 10, 'ARS',
   'manual', null, '00000000-0000-0000-0000-00000000a001', 'depositado');

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, transfer_pair_id)
values
  ('00000000-0000-0000-0000-000000000ca1', '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal', 'transfer_out',
   10, 'ARS', current_date, date_trunc('month', current_date)::date, '00000000-0000-0000-0000-000000000ca2'),
  ('00000000-0000-0000-0000-000000000ca2', '00000000-0000-0000-0000-00000000a002', 'jouve_fiscal', 'transfer_in',
   10, 'ARS', current_date, date_trunc('month', current_date)::date, '00000000-0000-0000-0000-000000000ca1'),
  ('00000000-0000-0000-0000-000000000ca3', '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal', 'transfer_out',
   10, 'ARS', current_date, date_trunc('month', current_date)::date, '00000000-0000-0000-0000-000000000ca2');

insert into public.check_movements (check_id, event, event_date, transaction_id) values
  ('00000000-0000-0000-0000-000000000ba1', 'deposited', current_date, '00000000-0000-0000-0000-000000000ca1'),
  ('00000000-0000-0000-0000-000000000ba3', 'deposited', current_date, '00000000-0000-0000-0000-000000000ca3');

insert into public.payment_order_payment_lines (payment_order_id, account_id, amount, endorsed_check_id) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000a001', 10,
   '00000000-0000-0000-0000-000000000ba2');

set local session_replication_role = origin;

select public.backfill_check_channels();

select is(
  (select channel_id from public.checks where id = '00000000-0000-0000-0000-000000000ba1'),
  'jouve_internal',
  'the backfill takes the receipt''s channel, not the deposit''s'
);

select is(
  (select channel_id from public.checks where id = '00000000-0000-0000-0000-000000000ba2'),
  'jouve_internal',
  'the backfill takes the endorsing payment order''s channel for a manual check'
);

select is(
  (select channel_id from public.checks where id = '00000000-0000-0000-0000-000000000ba3'),
  null,
  'the backfill leaves a manual check only deposited without channel'
);

select is(
  (select array_agg(movement || ':' || movement_channel_id)
     from public.checks_channel_mismatches()
    where check_id = '00000000-0000-0000-0000-000000000ba1'),
  array['deposit:jouve_fiscal'],
  'the diagnostic lists a receipt check deposited on another channel'
);

select ok(
  not has_function_privilege('authenticated', 'public.checks_channel_mismatches()', 'execute')
  and not has_function_privilege('authenticated', 'public.backfill_check_channels()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_check_channel()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_endorsed_check_channel()', 'execute')
  and not has_function_privilege('anon', 'public.checks_channel_mismatches()', 'execute')
  and has_function_privilege('authenticated', 'public.deposit_check(uuid, uuid, date, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.reject_check(uuid, uuid, date, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.deposit_check(uuid, uuid, date, text, text)', 'execute'),
  'internal functions are not callable from the API; deposit/reject stay callable by authenticated'
);

select * from finish();
rollback;
