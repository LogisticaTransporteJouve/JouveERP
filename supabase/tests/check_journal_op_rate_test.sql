-- Audit w2-s2 F1, w1-s2 F11, w1-s4 F5: a USD check paid to a supplier (own
-- check from an order, endorsed third-party check) posts its pesos at the
-- order's rate, so cheques_diferidos_emitidos and proveedores reverse
-- exactly; a rejection posts on its own date; reject_check runs on an empty
-- search_path. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(7);

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b101', '30999999990', 'Proveedor USD cheques', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a101', 'Banco USD cheques OP', 'bank', 'USD'),
  ('00000000-0000-0000-0000-00000000a102', 'Cartera USD cheques OP', 'checks', 'USD');

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000101c1', 'fisico', 'USD-END', 'Banco X', 'Firmante', current_date, current_date, 3, 'USD',
   'manual', '00000000-0000-0000-0000-00000000a102', 'jouve_fiscal');

-- Order A issues two own checks of USD 2 each; order B endorses USD 3.
-- Both at cotización 1000.
select public.create_payment_order(
  'jouve_fiscal', 1, 10101, '00000000-0000-0000-0000-00000000b101', current_date, 4, 'USD', null,
  jsonb_build_array(
    jsonb_build_object(
      'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a101', 'amount', 2,
      'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'OPR-1', 'bank_name', 'Banco OP',
                                         'due_date', current_date)),
    jsonb_build_object(
      'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a101', 'amount', 2,
      'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'OPR-2', 'bank_name', 'Banco OP',
                                         'due_date', current_date))),
  '[]'::jsonb, 1000);
select public.create_payment_order(
  'jouve_fiscal', 1, 10102, '00000000-0000-0000-0000-00000000b101', current_date, 3, 'USD', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000101c1')),
  '[]'::jsonb, 1000);

set constraints all immediate;
set constraints all deferred;

update public.issued_checks set status = 'cashed', cashed_at = current_date
 where check_number = 'OPR-1' and bank_name = 'Banco OP';
update public.issued_checks set status = 'rejected', rejected_at = current_date - 3
 where check_number = 'OPR-2' and bank_name = 'Banco OP';
select public.reject_check('00000000-0000-0000-0000-0000000101c1', null, current_date - 2, null, null);

create function pg_temp.side(p_table text, p_source uuid, p_role public.coa_system_role, p_debit boolean)
returns numeric language sql as $$
  select coalesce(sum(case when p_debit then l.debit else l.credit end), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = p_table and je.source_id = p_source
     and l.chart_of_accounts_id = public.find_account_by_role(p_role)
$$;

create temp table t_ic on commit drop as
  select id, check_number from public.issued_checks where bank_name = 'Banco OP';

select is(
  pg_temp.side('issued_checks', (select id from t_ic where check_number = 'OPR-1'), 'cheques_diferidos_emitidos', true),
  2000::numeric,
  'cashing a USD own check from an order debits cheques diferidos emitidos at the order''s rate'
);

select is(
  (select coalesce(sum(l.credit), 0) from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'issued_checks'
      and je.source_id = (select id from t_ic where check_number = 'OPR-1')),
  2000::numeric,
  'and credits the bank the same pesos'
);

select is(
  pg_temp.side('issued_checks', (select id from t_ic where check_number = 'OPR-2'), 'proveedores', false),
  2000::numeric,
  'a rejected USD own check gives back proveedores at the order''s rate'
);

select is(
  (select je.entry_date from public.journal_entries je
    where je.source_table = 'issued_checks'
      and je.source_id = (select id from t_ic where check_number = 'OPR-2')),
  current_date - 3,
  'the own-check rejection posts on rejected_at'
);

select is(
  pg_temp.side('checks', '00000000-0000-0000-0000-0000000101c1', 'proveedores', false),
  3000::numeric,
  'an endorsed USD check that bounces gives back proveedores at the order''s rate'
);

select is(
  (select je.entry_date from public.journal_entries je
    where je.source_table = 'checks' and je.source_id = '00000000-0000-0000-0000-0000000101c1'),
  current_date - 2,
  'the endorsed rejection posts on the date of its rejection movement'
);

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'public.reject_check(uuid, uuid, date, text, text)'::regprocedure),
  'reject_check runs on an empty search_path'
);

select * from finish();
rollback;
