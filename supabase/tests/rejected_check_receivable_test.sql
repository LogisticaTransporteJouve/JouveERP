-- D11: a rejected check posts "Deudores por cheques rechazados" against the
-- account it was in (the deposit's bank, the cartera, or the supplier for an
-- endorsed check), never an expense; an internal check posts nothing; the
-- client owes it again in the account statement.
-- One transaction, rolled back.

begin;

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'finance@rejected-check.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f1', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c101', '20333333334', 'Cliente Rechazos', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b201', '30999999990', 'Proveedor Rechazos', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a001', 'Cartera rechazos', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-00000000a002', 'Banco rechazos', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a003', 'Otro banco rechazos', 'bank', 'ARS');

-- Internal receipt: its deferred journal is skipped.
insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency) values
  ('00000000-0000-0000-0000-0000000006a1', 'jouve_internal', 1, 911, '00000000-0000-0000-0000-00000000c101', current_date, 30, 'ARS');

create temp table rejection_lines on commit drop as
  select null::uuid as check_id, null::text as role, 0::numeric as debit, 0::numeric as credit limit 0;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, source_receipt_id, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000008d1', 'fisico', 'RJ-DEP', 'Banco X', 'Firmante', current_date, current_date, 100, 'ARS',
   'manual', null, '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal'),
  ('00000000-0000-0000-0000-0000000008d2', 'fisico', 'RJ-CAR', 'Banco X', 'Firmante', current_date, current_date, 70, 'ARS',
   'manual', null, '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal'),
  ('00000000-0000-0000-0000-0000000008d3', 'fisico', 'RJ-END', 'Banco X', 'Firmante', current_date, current_date, 40, 'ARS',
   'manual', null, '00000000-0000-0000-0000-00000000a001', 'jouve_fiscal'),
  ('00000000-0000-0000-0000-0000000008d4', 'fisico', 'RJ-INT', 'Banco X', 'Firmante', current_date, current_date, 30, 'ARS',
   'receipt', '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-00000000a001', null);

-- The account ----------------------------------------------------------------------

select is(
  (select c.account_type::text || ' ' || p.code
     from public.chart_of_accounts c
     join public.chart_of_accounts p on p.id = c.parent_id
    where c.system_role = 'cheques_rechazados' and c.is_active),
  'activo 1.1.2',
  'Deudores por cheques rechazados is an asset under Créditos por ventas'
);

-- Deposited check: out of the deposit's bank -------------------------------------------

select public.deposit_check('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-00000000a002',
  current_date, null, null);

select throws_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-00000000a003',
      current_date, null, null)$$,
  '23514',
  'El rechazo sale de la cuenta donde se depositó el cheque',
  'a deposited check cannot be rejected from another bank account'
);

select lives_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008d1', null, current_date, null, null)$$,
  'a deposited check is rejected from its deposit account'
);

select is(
  (select account_id from public.transactions
    where rejected_check_id = '00000000-0000-0000-0000-0000000008d1' and kind = 'expense'),
  '00000000-0000-0000-0000-00000000a002'::uuid,
  'the rejection outflow leaves the bank of the deposit'
);

-- Cartera check: out of the cartera ---------------------------------------------------

select lives_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008d2', '00000000-0000-0000-0000-00000000a002',
      current_date, null, null)$$,
  'a check in cartera is rejected'
);

select is(
  (select account_id from public.transactions
    where rejected_check_id = '00000000-0000-0000-0000-0000000008d2' and kind = 'expense'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'the rejection of a cartera check leaves the cartera account'
);

-- Internal receipt check ----------------------------------------------------------------

select lives_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008d4', null, current_date, null, null)$$,
  'an internal check in cartera is rejected'
);

-- Endorsed check: the supplier debt comes back ------------------------------------------

select public.create_payment_order(
  'jouve_fiscal', 1, 911, '00000000-0000-0000-0000-00000000b201', current_date, 40, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000008d3')),
  '[]'::jsonb);

set constraints all immediate;
set constraints all deferred;

select lives_ok(
  $$select public.reject_check('00000000-0000-0000-0000-0000000008d3', null, current_date, null, null)$$,
  'an endorsed check is rejected'
);

select is(
  (select status from public.checks where id = '00000000-0000-0000-0000-0000000008d3'),
  'rechazado',
  'the endorsed check ends rejected'
);

-- Client account statement --------------------------------------------------------------

select is(
  (select signed_amount from public.v_client_account_movements
    where source_type = 'rejected_check' and source_id = '00000000-0000-0000-0000-0000000008d4'),
  30::numeric,
  'the client owes a bounced receipt check again'
);

reset role;

insert into rejection_lines
  select t.rejected_check_id, coa.system_role::text, l.debit, l.credit
    from public.transactions t
    join public.journal_entries je on je.source_table = 'transactions' and je.source_id = t.id
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts coa on coa.id = l.chart_of_accounts_id
   where t.rejected_check_id is not null
  union all
  select je.source_id, coa.system_role::text, l.debit, l.credit
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts coa on coa.id = l.chart_of_accounts_id
   where je.source_table = 'checks'
     and je.source_id = '00000000-0000-0000-0000-0000000008d3';

-- Postings --------------------------------------------------------------------------------

select results_eq(
  $$select role, debit, credit from rejection_lines
     where check_id = '00000000-0000-0000-0000-0000000008d1' order by debit desc$$,
  $$values ('cheques_rechazados', 100.00::numeric, 0::numeric), ('banco', 0::numeric, 100.00::numeric)$$,
  'a deposited fiscal check posts debit cheques_rechazados / credit banco'
);

select results_eq(
  $$select role, debit, credit from rejection_lines
     where check_id = '00000000-0000-0000-0000-0000000008d2' order by debit desc$$,
  $$values ('cheques_rechazados', 70.00::numeric, 0::numeric), ('cheques_cartera', 0::numeric, 70.00::numeric)$$,
  'a cartera fiscal check posts debit cheques_rechazados / credit cheques_cartera'
);

select results_eq(
  $$select role, debit, credit from rejection_lines
     where check_id = '00000000-0000-0000-0000-0000000008d3' order by debit desc$$,
  $$values ('cheques_rechazados', 40.00::numeric, 0::numeric), ('proveedores', 0::numeric, 40.00::numeric)$$,
  'an endorsed fiscal check posts debit cheques_rechazados / credit proveedores'
);

select is(
  (select count(*)::int from public.transactions
    where rejected_check_id = '00000000-0000-0000-0000-0000000008d4' and channel_id = 'jouve_internal'),
  1,
  'an internal check still leaves its cartera'
);

select is(
  (select count(*)::int from rejection_lines
    where check_id = '00000000-0000-0000-0000-0000000008d4'),
  0,
  'an internal check posts nothing'
);

select is(
  (select count(*)::int from rejection_lines where role = 'gastos'),
  0,
  'no rejection posts to an expense role'
);

select is(
  (select count(*)::int from public.check_movements
    where event = 'rejected' and transaction_id is not null
      and check_id in ('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-0000000008d2')),
  2,
  'the rejection movement links its outflow'
);

select * from finish();
rollback;
