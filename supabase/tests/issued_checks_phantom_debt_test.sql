-- Roadmap 0.7: issued checks never give back a supplier debt that was not
-- booked, and the check of a live payment order is annulled with the order.
-- One transaction, rolled back.

begin;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f7', 'finance@phantom-debt.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f7', 'finance');

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b701', '30999999990', 'Proveedor Fantasma', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a702', 'Banco fantasma', 'bank', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f7","role":"authenticated"}', true);

-- Hand-loaded checks (no payment order) ------------------------------------------

insert into public.issued_checks
  (id, kind, check_number, bank_name, issue_date, due_date, amount, currency,
   bank_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000079a1', 'fisico', 'PD-1', 'Banco fantasma', current_date, current_date, 100, 'ARS',
   '00000000-0000-0000-0000-00000000a702', 'jouve_fiscal'),
  ('00000000-0000-0000-0000-0000000079a2', 'fisico', 'PD-2', 'Banco fantasma', current_date, current_date, 100, 'ARS',
   '00000000-0000-0000-0000-00000000a702', 'jouve_fiscal');

update public.issued_checks set status = 'rejected', rejected_at = current_date
 where id = '00000000-0000-0000-0000-0000000079a1';
update public.issued_checks set status = 'cancelled', cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000000079a2';

-- A payment order's check -----------------------------------------------------------

select public.create_payment_order(
  'jouve_fiscal', 1, 971, '00000000-0000-0000-0000-00000000b701', current_date, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a702', 'amount', 100,
    'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'PD-3', 'bank_name', 'Banco fantasma',
                                       'due_date', current_date))),
  '[]'::jsonb);

set constraints all immediate;
set constraints all deferred;

select throws_ok(
  $$update public.issued_checks set status = 'cancelled', cancelled_at = now()
     where check_number = 'PD-3'$$,
  '55006',
  null,
  'the check of a live payment order cannot be annulled on its own'
);

update public.payment_orders set status = 'canceled'
 where punto_venta = 1 and numero = 971 and channel_id = 'jouve_fiscal';

reset role;

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'issued_checks'
      and source_id = '00000000-0000-0000-0000-0000000079a1'),
  0,
  'rejecting a hand-loaded check gives back no supplier debt'
);

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'issued_checks'
      and source_id = '00000000-0000-0000-0000-0000000079a2'),
  0,
  'annulling a hand-loaded check gives back no supplier debt'
);

select is(
  (select status from public.issued_checks where check_number = 'PD-3'),
  'cancelled',
  'annulling the payment order annuls its check'
);

select is(
  (select count(*)::int from public.journal_entries je
     join public.issued_checks ic on ic.id = je.source_id
    where je.source_table = 'issued_checks' and ic.check_number = 'PD-3'),
  0,
  'the annulled order''s check posts nothing of its own'
);

select is(
  (select count(*)::int
     from public.journal_entries je
     join public.payment_orders po on po.id = je.source_id
    where je.source_table = 'payment_orders' and je.is_reversal
      and po.punto_venta = 1 and po.numero = 971 and po.channel_id = 'jouve_fiscal'),
  1,
  'the debt comes back once, through the order''s reversal'
);

select * from finish();
rollback;
