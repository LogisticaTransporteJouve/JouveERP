-- Audit w3-s2 F1 and F2, w3-s6 F2: a bounced own check of a payment order
-- gives its bank outflow back in Caja (no entry); an order whose check was
-- annulled on its own is neither cancelled nor edited; the edit's
-- allocations cap answers in Spanish. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(11);

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b161', '30999999990', 'Proveedor cheque rebotado', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a161', 'Banco cheque rebotado', 'bank', 'ARS');

-- Order 1 pays with own check RB-1, which bounces; order 2 pays with RB-2,
-- annulled on its own before the live-order guard existed; order 3 pays a
-- cuenta from the bank.
select public.create_payment_order(
  'jouve_fiscal', 1, 16101, '00000000-0000-0000-0000-00000000b161', current_date - 10, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a161', 'amount', 100,
    'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'RB-1', 'bank_name', 'Banco RB',
                                       'due_date', current_date))),
  '[]'::jsonb);
select public.create_payment_order(
  'jouve_fiscal', 1, 16102, '00000000-0000-0000-0000-00000000b161', current_date - 10, 70, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a161', 'amount', 70,
    'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'RB-2', 'bank_name', 'Banco RB',
                                       'due_date', current_date))),
  '[]'::jsonb);
select public.create_payment_order(
  'jouve_fiscal', 1, 16103, '00000000-0000-0000-0000-00000000b161', current_date, 60, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a161', 'amount', 60)),
  '[]'::jsonb);

-- A hand-loaded check (no order): its rejection moves nothing.
insert into public.issued_checks
  (id, kind, check_number, bank_name, issue_date, due_date, amount, currency,
   bank_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000161c9', 'fisico', 'RB-9', 'Banco RB', current_date, current_date, 40, 'ARS',
   '00000000-0000-0000-0000-00000000a161', 'jouve_fiscal');

set constraints all immediate;
set constraints all deferred;

create temp table t_op on commit drop as
  select id, numero from public.payment_orders
   where channel_id = 'jouve_fiscal' and punto_venta = 1 and numero in (16101, 16102, 16103);

update public.issued_checks set status = 'rejected', rejected_at = current_date - 2
 where check_number = 'RB-1' and bank_name = 'Banco RB';
update public.issued_checks set status = 'rejected', rejected_at = current_date - 2
 where id = '00000000-0000-0000-0000-0000000161c9';

-- Flush any deferred posting before reading the journal.
set constraints all immediate;
set constraints all deferred;

-- F2 -------------------------------------------------------------------------

select results_eq(
  $$select t.kind, t.amount, t.transaction_date, t.currency
      from public.transactions t
      join public.issued_checks ic on ic.id = t.issued_check_id
     where ic.check_number = 'RB-1' and ic.bank_name = 'Banco RB'$$,
  $$values ('income'::text, 100::numeric, current_date - 2, 'ARS'::text)$$,
  'the bounced check gives its amount back to the bank, on the rejection date'
);

select is(
  (select sum(case when kind = 'income' then amount else -amount end)
     from public.transactions
    where account_id = '00000000-0000-0000-0000-00000000a161'
      and (payment_order_id = (select id from t_op where numero = 16101)
           or issued_check_id = (select ic.id from public.issued_checks ic
                                  where ic.check_number = 'RB-1' and ic.bank_name = 'Banco RB'))),
  0::numeric,
  'the order''s outflow and the give-back net out in Caja'
);

select is(
  (select count(*)::int
     from public.journal_entries je
     join public.transactions t on t.id = je.source_id
    where je.source_table = 'transactions'
      and t.issued_check_id = (select ic.id from public.issued_checks ic
                                where ic.check_number = 'RB-1' and ic.bank_name = 'Banco RB')),
  0,
  'the give-back posts no entry of its own'
);

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'issued_checks'
      and source_id = (select ic.id from public.issued_checks ic
                        where ic.check_number = 'RB-1' and ic.bank_name = 'Banco RB')),
  1,
  'the rejection still posts its own entry once'
);

select is(
  (select count(*)::int from public.transactions
    where issued_check_id = '00000000-0000-0000-0000-0000000161c9'),
  0,
  'a hand-loaded check that bounces moves nothing (it never left the bank)'
);

-- F1 -------------------------------------------------------------------------

select throws_ok(
  $$update public.issued_checks set status = 'cancelled', cancelled_at = now()
     where check_number = 'RB-2' and bank_name = 'Banco RB'$$,
  '55006',
  null,
  'the check of a live order is still not annulled on its own'
);

-- A row annulled on its own before 20261102210000.
alter table public.issued_checks disable trigger guard_issued_check_cancel_live_order;
update public.issued_checks set status = 'cancelled', cancelled_at = now()
 where check_number = 'RB-2' and bank_name = 'Banco RB';
alter table public.issued_checks enable trigger guard_issued_check_cancel_live_order;

select throws_ok(
  $$update public.payment_orders set status = 'canceled'
     where id = (select id from t_op where numero = 16102)$$,
  '55006',
  'No se puede anular la orden de pago: un cheque propio que emitió ya figura anulado por fuera de la orden y la deuda ya volvió en la contabilidad. Pedile al owner que lo revise antes de anularla.',
  'an order whose check was annulled on its own is not cancelled (its debt would come back twice)'
);

select throws_ok(
  $$select public.update_payment_order(
      (select id from t_op where numero = 16102), current_date, 70, null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a161', 'amount', 70)),
      '[]'::jsonb)$$,
  '55006',
  'No se puede editar la OP: un cheque propio que emitió ya figura anulado por fuera de la orden y la deuda ya volvió en la contabilidad. Pedile al owner que lo revise.',
  'nor edited'
);

select lives_ok(
  $$update public.payment_orders set status = 'canceled'
     where id = (select id from t_op where numero = 16103)$$,
  'an order with no own check is still cancelled'
);

-- w3-s6 F2 -------------------------------------------------------------------

select public.create_payment_order(
  'jouve_fiscal', 1, 16104, '00000000-0000-0000-0000-00000000b161', current_date, 60, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a161', 'amount', 60)),
  '[]'::jsonb);

select lives_ok(
  $$select public.allocate_payment_order(
      (select id from public.payment_orders
        where channel_id = 'jouve_fiscal' and punto_venta = 1 and numero = 16104),
      jsonb_build_array(jsonb_build_object(
        'check_kind', 'issued',
        'check_id', (select ic.id from public.issued_checks ic
                      where ic.check_number = 'RB-1' and ic.bank_name = 'Banco RB'),
        'amount_applied', 60)))$$,
  'a later order is applied to the bounced own check'
);

select throws_ok(
  $$select public.update_payment_order(
      (select id from public.payment_orders
        where channel_id = 'jouve_fiscal' and punto_venta = 1 and numero = 16104),
      current_date, 30, null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a161', 'amount', 30)),
      '[]'::jsonb)$$,
  '23514',
  'Lo imputado (0.00 a facturas y 60.00 a cheques rechazados) supera el total de la OP (30.00). Lo imputado a cheques rechazados se mantiene al editar.',
  'an edit below what the order applied to the check is refused in Spanish'
);

select * from finish();
rollback;
