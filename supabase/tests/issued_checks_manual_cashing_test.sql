-- Auditoría W1 · S2 F7 and F8: cashing an own check loaded by hand is an
-- expense (the supplier's default account, or gastos), never a debit of
-- cheques_diferidos_emitidos; once a check leaves 'emitted' its amount,
-- currency and bank are frozen, and an order is never attached to a check
-- after the fact. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(10);

create temp table leaf on commit drop as
select e.id
  from public.expense_leaf_accounts e
 where e.id is distinct from public.find_account_by_role('gastos')
 order by e.code
 limit 1;

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b933', '30999999990', 'Proveedor Cheque Manual', 'responsable_inscripto');
update public.suppliers set default_expense_account_id = (select id from leaf)
 where id = '00000000-0000-0000-0000-00000000b933';

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a933', 'Banco cheques manuales', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a934', 'Banco cheques manuales USD', 'bank', 'USD');
-- No seed rate is that old: 1991-02-10 takes this one, 1990 has none.
insert into public.exchange_rates (currency, rate_date, rate, source) values
  ('USD', '1991-01-02', 1000, 'manual');

insert into public.issued_checks
  (id, kind, check_number, bank_name, issue_date, due_date, amount, currency,
   bank_account_id, channel_id, supplier_id)
values
  ('00000000-0000-0000-0000-0000000093e1', 'fisico', 'MC-1', 'Banco manual', current_date, current_date, 100, 'ARS',
   '00000000-0000-0000-0000-00000000a933', 'jouve_fiscal', null),
  ('00000000-0000-0000-0000-0000000093e2', 'fisico', 'MC-2', 'Banco manual', current_date, current_date, 60, 'ARS',
   '00000000-0000-0000-0000-00000000a933', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b933'),
  ('00000000-0000-0000-0000-0000000093e3', 'fisico', 'MC-3', 'Banco manual', current_date, current_date, 30, 'ARS',
   '00000000-0000-0000-0000-00000000a933', 'jouve_fiscal', null),
  ('00000000-0000-0000-0000-0000000093e4', 'fisico', 'MC-4', 'Banco manual', '1991-02-01', '1991-02-10', 2.5, 'USD',
   '00000000-0000-0000-0000-00000000a934', 'jouve_fiscal', null),
  ('00000000-0000-0000-0000-0000000093e5', 'fisico', 'MC-5', 'Banco manual', '1990-02-01', '1990-02-10', 3, 'USD',
   '00000000-0000-0000-0000-00000000a934', 'jouve_fiscal', null);

update public.issued_checks set status = 'cashed', cashed_at = current_date
 where id in ('00000000-0000-0000-0000-0000000093e1', '00000000-0000-0000-0000-0000000093e2');
update public.issued_checks set status = 'cashed', cashed_at = '1991-02-10'
 where id = '00000000-0000-0000-0000-0000000093e4';
update public.issued_checks set status = 'cashed', cashed_at = '1990-02-10'
 where id = '00000000-0000-0000-0000-0000000093e5';

set constraints all immediate;
set constraints all deferred;

create function pg_temp.debit_on(p_check uuid, p_account uuid) returns numeric
language sql as $$
  select coalesce(sum(l.debit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = 'issued_checks' and je.source_id = p_check
     and l.chart_of_accounts_id = p_account
$$;

select is(
  pg_temp.debit_on('00000000-0000-0000-0000-0000000093e1', public.find_account_by_role('cheques_diferidos_emitidos')),
  0::numeric,
  'cashing a hand-loaded check does not debit cheques diferidos emitidos'
);

select is(
  pg_temp.debit_on('00000000-0000-0000-0000-0000000093e1', public.find_account_by_role('gastos')),
  100::numeric,
  'with no supplier default it is an expense in gastos'
);

select is(
  pg_temp.debit_on('00000000-0000-0000-0000-0000000093e2', (select id from leaf)),
  60::numeric,
  'with a supplier it debits the supplier''s default expense account'
);

select is(
  (select coalesce(sum(l.debit) - sum(l.credit), 0)
     from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'issued_checks'
      and je.source_id in ('00000000-0000-0000-0000-0000000093e1', '00000000-0000-0000-0000-0000000093e2')),
  0::numeric,
  'the cashing entries balance'
);

select is(
  pg_temp.debit_on('00000000-0000-0000-0000-0000000093e4', public.find_account_by_role('gastos')),
  2500::numeric,
  'a USD hand-loaded check posts its pesos at the rate of its cashing day'
);

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'issued_checks' and source_id = '00000000-0000-0000-0000-0000000093e5'),
  0,
  'a USD hand-loaded check with no rate on its cashing day posts nothing'
);

-- F8 -------------------------------------------------------------------------------

select throws_ok(
  $$update public.issued_checks set amount = 150 where id = '00000000-0000-0000-0000-0000000093e1'$$,
  '55006',
  'El cheque ya no está emitido: su monto, moneda y cuenta quedaron registrados en Caja y no se pueden cambiar',
  'a cashed check cannot change its amount'
);

select lives_ok(
  $$update public.issued_checks set notes = 'nota' where id = '00000000-0000-0000-0000-0000000093e1'$$,
  'a cashed check still takes a note'
);

select lives_ok(
  $$update public.issued_checks set amount = 35 where id = '00000000-0000-0000-0000-0000000093e3'$$,
  'an emitted check still changes its amount'
);

select public.create_payment_order(
  'jouve_fiscal', 1, 9933, '00000000-0000-0000-0000-00000000b933', current_date, 35, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a933', 'amount', 35)),
  '[]'::jsonb);

select throws_ok(
  $$update public.issued_checks set payment_order_id = (select id from public.payment_orders
                                                   where channel_id = 'jouve_fiscal' and punto_venta = 1 and numero = 9933)
     where id = '00000000-0000-0000-0000-0000000093e3'$$,
  '55006',
  'Un cheque propio se liga a una orden de pago solo cargándolo desde la orden de pago',
  'a hand-loaded check cannot be attached to a payment order'
);

select * from finish();
rollback;
