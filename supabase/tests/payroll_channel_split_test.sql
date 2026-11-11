-- The channel of a payroll payment is the database's
-- (20261111185100..185300): recibo − embargo goes to the books, capped at
-- total_a_pagar; the payment that crosses the cap is a fiscal parent plus an
-- internal child; reconciled movements change only through the treasury
-- primitives and keep their line totals; a closed accounting month refuses a
-- fiscal change; the recibo part the payments do not carry is posted at
-- planilla close and Gestión skips it. Writes as a finance user. One
-- transaction, rolled back.

begin;

select plan(50);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c101', 'finance@split-pay.test'),
  ('00000000-0000-0000-0000-00000000c102', 'admin@split-pay.test'),
  ('00000000-0000-0000-0000-00000000c103', 'ops@split-pay.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000c101', 'finance'),
  ('00000000-0000-0000-0000-00000000c102', 'admin'),
  ('00000000-0000-0000-0000-00000000c103', 'operations');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000c1a1', 'Banco Reparto', 'bank', 'ARS');
insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-00000000c1e1', 'Empleado Reparto', 'mensual', '2015-03-01'),
  ('00000000-0000-0000-0000-00000000c1e2', 'Empleado Cerrado', 'mensual', '2015-03-01'),
  ('00000000-0000-0000-0000-00000000c1e3', 'Empleado Conciliado', 'mensual', '2015-03-01'),
  ('00000000-0000-0000-0000-00000000c1e4', 'Empleado Viejo', 'mensual', '2015-03-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-00000000c1d1', 2097, 3),
  ('00000000-0000-0000-0000-00000000c1d2', 2097, 4),
  ('00000000-0000-0000-0000-00000000c1d3', 2097, 5),
  ('00000000-0000-0000-0000-00000000c1d4', 2097, 7);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-00000000c1c1', '00000000-0000-0000-0000-00000000c1d1',
   '00000000-0000-0000-0000-00000000c1e1', 800000),
  ('00000000-0000-0000-0000-00000000c1c2', '00000000-0000-0000-0000-00000000c1d2',
   '00000000-0000-0000-0000-00000000c1e2', 800000),
  ('00000000-0000-0000-0000-00000000c1c3', '00000000-0000-0000-0000-00000000c1d4',
   '00000000-0000-0000-0000-00000000c1e3', 800000),
  ('00000000-0000-0000-0000-00000000c1c4', '00000000-0000-0000-0000-00000000c1d3',
   '00000000-0000-0000-0000-00000000c1e4', 800000);

create temporary view t_pay as
  select p.id, p.entry_id, p.split_parent_id, p.channel_id, p.amount, p.transaction_id
    from public.payroll_payments p
   where p.entry_id::text like '00000000-0000-0000-0000-00000000c1c%';
grant select on t_pay to authenticated;

-- ACL ----------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.split_matched_movement(uuid, uuid, numeric, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.merge_matched_movement(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.payroll_entry_rebalance_channels(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.matched_line_totals(uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.update_payroll_payment(uuid, uuid, numeric, public.payroll_payment_method, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.update_payroll_payment(uuid, uuid, numeric, public.payroll_payment_method, date, text)', 'execute'),
  'the primitives and the rebalance are not callable from the API; the group edit is, for signed-in users'
);

-- 1-7: unmatched payments --------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);

insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c1b1', '00000000-0000-0000-0000-00000000c1c1',
   '00000000-0000-0000-0000-00000000c1a1', 300000, 'transferencia', '2097-03-05');

select is(
  (select channel_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b1'),
  'jouve_internal',
  '1. without a recibo the payment is internal'
);

update public.payroll_entries set recibo_neto = 500000
 where id = '00000000-0000-0000-0000-00000000c1c1';

select is(
  (select channel_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b1'),
  'jouve_fiscal',
  '2. loading the recibo turns it fiscal'
);

reset role;
select is(
  (select sum(l.debit) from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
     join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
    where e.source_table = 'transactions'
      and e.source_id = (select transaction_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b1')
      and c.system_role = 'sueldos'
      and e.id in (select public.current_journal_entries('transactions', e.source_id))),
  300000.00,
  '2. the payment moved to the fiscal channel is posted to sueldos'
);
set local role authenticated;

insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c1b2', '00000000-0000-0000-0000-00000000c1c1',
   '00000000-0000-0000-0000-00000000c1a1', 400000, 'efectivo', '2097-03-10');

select results_eq(
  $$select channel_id, amount, split_parent_id is not null
      from t_pay where id = '00000000-0000-0000-0000-00000000c1b2'
         or split_parent_id = '00000000-0000-0000-0000-00000000c1b2'
     order by split_parent_id nulls first$$,
  $$values ('jouve_fiscal'::text, 200000.00::numeric, false),
           ('jouve_internal'::text, 200000.00::numeric, true)$$,
  '3. the payment that crosses the recibo is a fiscal parent plus an internal child'
);

select results_eq(
  $$select paid_total, paid_fiscal, paid_internal, fiscal_share, payments_count
      from public.v_payroll_entries_with_payments
     where id = '00000000-0000-0000-0000-00000000c1c1'$$,
  $$values (700000.00::numeric, 500000.00::numeric, 200000.00::numeric, 500000.00::numeric, 2)$$,
  '6. the view shows the books and management parts; the child is not a payment of its own'
);

create temporary table t_child as
  select id from public.payroll_payments
   where split_parent_id = '00000000-0000-0000-0000-00000000c1b2';

update public.payroll_entries set deudas = 50000
 where id = '00000000-0000-0000-0000-00000000c1c1';

select results_eq(
  $$select amount from t_pay where entry_id = '00000000-0000-0000-0000-00000000c1c1'
     order by amount$$,
  $$values (200000.00::numeric), (200000.00::numeric), (300000.00::numeric)$$,
  '4. deudas below the share move nothing'
);

update public.payroll_entries set embargo = 30000
 where id = '00000000-0000-0000-0000-00000000c1c1';

select results_eq(
  $$select amount, id = (select id from t_child)
      from t_pay where id = '00000000-0000-0000-0000-00000000c1b2'
         or split_parent_id = '00000000-0000-0000-0000-00000000c1b2'
     order by split_parent_id nulls first$$,
  $$values (170000.00::numeric, false), (230000.00::numeric, true)$$,
  '4. an embargo shrinks the fiscal part; the same child takes the rest'
);

delete from public.payroll_payments where id = '00000000-0000-0000-0000-00000000c1b1';

select results_eq(
  $$select channel_id, amount from t_pay where entry_id = '00000000-0000-0000-0000-00000000c1c1'$$,
  $$values ('jouve_fiscal'::text, 400000.00::numeric)$$,
  '5. deleting the first payment makes the second wholly fiscal, without a child'
);

select lives_ok(
  $$select public.update_payroll_payment('00000000-0000-0000-0000-00000000c1b2',
      '00000000-0000-0000-0000-00000000c1a1', 600000, 'efectivo', '2097-03-10', 'corrección')$$,
  '6. editing the amount of a payment'
);

select results_eq(
  $$select channel_id, amount, notes from public.payroll_payments
     where id = '00000000-0000-0000-0000-00000000c1b2'
        or split_parent_id = '00000000-0000-0000-0000-00000000c1b2'
     order by split_parent_id nulls first$$,
  $$values ('jouve_fiscal'::text, 470000.00::numeric, 'corrección'::text),
           ('jouve_internal'::text, 130000.00::numeric, 'corrección'::text)$$,
  '6. the edited payment is split again'
);

select throws_ok(
  format($$select public.update_payroll_payment(%L,
      '00000000-0000-0000-0000-00000000c1a1', 1000, 'efectivo', '2097-03-10', null)$$,
    (select id from public.payroll_payments where split_parent_id = '00000000-0000-0000-0000-00000000c1b2')),
  '55006',
  'Editá el pago completo, no su parte interna',
  '6. the internal piece is not edited on its own'
);

insert into public.payroll_payments (id, entry_id, account_id, channel_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c1b3', '00000000-0000-0000-0000-00000000c1c1',
   '00000000-0000-0000-0000-00000000c1a1', 'jouve_fiscal', 100000, 'efectivo', '2097-03-15');

select is(
  (select channel_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b3'),
  'jouve_internal',
  '7. a channel sent by the client beyond the share is overridden'
);

-- 15: the garnishment trigger rewrites embargo -----------------------------------------

update public.payroll_entries set embargo_override = false
 where id = '00000000-0000-0000-0000-00000000c1c1';

select is(
  (select amount from t_pay where id = '00000000-0000-0000-0000-00000000c1b2'),
  500000.00,
  '15. clearing the embargo override (embargo back to 0) rebalances'
);

-- 18: deudas over the share and extras -------------------------------------------------

update public.payroll_entries set deudas = 400000
 where id = '00000000-0000-0000-0000-00000000c1c1';

select results_eq(
  $$select channel_id, amount from t_pay
     where id = '00000000-0000-0000-0000-00000000c1b2'
        or split_parent_id = '00000000-0000-0000-0000-00000000c1b2'
     order by split_parent_id nulls first$$,
  $$values ('jouve_fiscal'::text, 400000.00::numeric), ('jouve_internal'::text, 200000.00::numeric)$$,
  '18. total_a_pagar below the share caps the fiscal part'
);

insert into public.payroll_entry_extras (id, entry_id, amount, description) values
  ('00000000-0000-0000-0000-00000000c1f1', '00000000-0000-0000-0000-00000000c1c1', 100000, 'Horas extra');

select is(
  (select amount from t_pay where id = '00000000-0000-0000-0000-00000000c1b2'),
  500000.00,
  '18. an extra raises total_a_pagar and the fiscal part with it'
);

delete from public.payroll_entry_extras where id = '00000000-0000-0000-0000-00000000c1f1';

select is(
  (select amount from t_pay where id = '00000000-0000-0000-0000-00000000c1b2'),
  400000.00,
  '18. deleting the extra moves the excess back to management'
);

-- A4.2: Gestión takes each piece on its side; the total paid does not move.
reset role;
set constraints all immediate;
select results_eq(
  $$select subbucket, sum(amount_ars)
      from public.management_pnl_lines('2097-03-01', '2097-03-31', 'cash')
     where subbucket in ('sueldos', 'sueldos_internos')
     group by subbucket order by subbucket$$,
  $$values ('sueldos'::text, -400000.00::numeric), ('sueldos_internos'::text, -300000.00::numeric)$$,
  'cash: the books part and the management part add up to what was paid'
);
select results_eq(
  $$select subbucket, sum(amount_ars)
      from public.management_pnl_lines('2097-03-01', '2097-03-31', 'accrual')
     where subbucket in ('sueldos', 'sueldos_internos')
     group by subbucket order by subbucket$$,
  $$values ('sueldos'::text, -400000.00::numeric), ('sueldos_internos'::text, -300000.00::numeric)$$,
  'accrual: the same split'
);
set constraints all deferred;
set local role authenticated;

-- 14: split_parent_id is the database's ------------------------------------------------

select throws_ok(
  $$insert into public.payroll_payments (entry_id, account_id, amount, method, paid_at, split_parent_id)
    values ('00000000-0000-0000-0000-00000000c1c1', '00000000-0000-0000-0000-00000000c1a1', 10,
            'efectivo', '2097-03-20', '00000000-0000-0000-0000-00000000c1b2')$$,
  '55006',
  'La parte interna de un pago la arma el sistema',
  '14. a client cannot insert an internal piece'
);

select throws_ok(
  $$update public.payroll_payments set split_parent_id = '00000000-0000-0000-0000-00000000c1b2'
     where id = '00000000-0000-0000-0000-00000000c1b3'$$,
  '55006',
  'La parte interna de un pago la arma el sistema',
  '14. a client cannot turn a payment into an internal piece'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'payroll_payments_split_parent_fkey'),
  'FOREIGN KEY (entry_id, split_parent_id) REFERENCES payroll_payments(entry_id, id) ON DELETE CASCADE',
  '14. the parent is in the same entry'
);

-- 16/17: the recibo gap at planilla close ----------------------------------------------
-- recibo 500k, total_a_pagar 400k (deudas), paid 700k: fiscal 400k, the
-- gap 100k is posted at close.

update public.payroll_periods set status = 'closed'
 where id = '00000000-0000-0000-0000-00000000c1d1';

reset role;

select results_eq(
  $$select c.system_role::text, l.debit, l.credit, e.channel_id, e.accrual_period
      from public.journal_entries e
      join public.journal_entry_lines l on l.journal_entry_id = e.id
      join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
     where e.source_table = 'payroll_entries'
       and e.source_id = '00000000-0000-0000-0000-00000000c1c1'
     order by l.debit desc$$,
  $$values ('sueldos'::text, 100000.00::numeric, 0::numeric, 'jouve_fiscal'::text, '2097-03'::text),
           ('anticipos_personal'::text, 0::numeric, 100000.00::numeric, 'jouve_fiscal'::text, '2097-03'::text)$$,
  '16. closing posts the recibo part the payments do not carry'
);

select is(
  (select paid_fiscal from public.v_payroll_entries_with_payments where id = '00000000-0000-0000-0000-00000000c1c1')
  + (select sum(l.debit) from public.journal_entries e
       join public.journal_entry_lines l on l.journal_entry_id = e.id
      where e.source_table = 'payroll_entries' and e.source_id = '00000000-0000-0000-0000-00000000c1c1'),
  500000.00,
  '17. paid fiscal + gap = recibo − embargo'
);

select is(
  (select count(*)::int from public.management_pnl_lines('2097-03-01', '2097-03-31', 'accrual')
    where source_table = 'payroll_entries'),
  0,
  '16. Gestión (accrual) skips the gap entry'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c102","role":"authenticated"}', true);
update public.payroll_periods set status = 'draft'
 where id = '00000000-0000-0000-0000-00000000c1d1';
reset role;

select is(
  (select count(*)::int from public.current_journal_entries('payroll_entries', '00000000-0000-0000-0000-00000000c1c1')),
  0,
  '16. reopening reverses it'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
update public.payroll_periods set status = 'closed'
 where id = '00000000-0000-0000-0000-00000000c1d1';
reset role;

select is(
  (select count(*)::int from public.current_journal_entries('payroll_entries', '00000000-0000-0000-0000-00000000c1c1')),
  1,
  '16. closing again posts one live entry'
);

insert into public.accounting_closed_periods (period) values ('2097-03');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c102","role":"authenticated"}', true);
select throws_ok(
  $$update public.payroll_periods set status = 'draft' where id = '00000000-0000-0000-0000-00000000c1d1'$$,
  '55006',
  'El período contable de 03/2097 está cerrado: reabrilo para reabrir la planilla',
  '16. a closed accounting month blocks the reopen'
);
reset role;
delete from public.accounting_closed_periods where period = '2097-03';

-- 13: a closed accounting month --------------------------------------------------------

insert into public.accounting_closed_periods (period) values ('2097-04');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at)
    values ('00000000-0000-0000-0000-00000000c1b4', '00000000-0000-0000-0000-00000000c1c2',
            '00000000-0000-0000-0000-00000000c1a1', 300000, 'efectivo', '2097-04-05')$$,
  '13. an internal payment is loaded in a closed accounting month'
);

select throws_ok(
  $$update public.payroll_entries set recibo_neto = 200000
     where id = '00000000-0000-0000-0000-00000000c1c2'$$,
  '55006',
  'El período contable de este sueldo está cerrado: reabrilo para cargar el recibo',
  '13. a recibo that would move a payment to the books is refused'
);

reset role;
delete from public.accounting_closed_periods where period = '2097-04';

-- 8-12: reconciled payments ------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c1b5', '00000000-0000-0000-0000-00000000c1c3',
   '00000000-0000-0000-0000-00000000c1a1', 300000, 'transferencia', '2097-03-05');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temporary table t_stmt as
  select public.commit_import_run(
    'bank_statement', 'reparto.csv', repeat('a', 64), '{}'::jsonb, 5, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000c1a1', 'line_date', '2097-03-05',
        'description', 'Sueldo uno', 'amount', -300000, 'balance', null, 'reference', null,
        'source_hash', repeat('b', 64), 'line_no', 2),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000c1a1', 'line_date', '2097-03-10',
        'description', 'Sueldo dos', 'amount', -400000, 'balance', null, 'reference', null,
        'source_hash', repeat('c', 64), 'line_no', 3),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000c1a1', 'line_date', '2097-03-15',
        'description', 'Sueldo tres a', 'amount', -250000, 'balance', null, 'reference', null,
        'source_hash', repeat('d', 64), 'line_no', 4),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000c1a1', 'line_date', '2097-03-15',
        'description', 'Sueldo tres b', 'amount', -350000, 'balance', null, 'reference', null,
        'source_hash', repeat('e', 64), 'line_no', 5),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000c1a1', 'line_date', '2097-03-20',
        'description', 'Gasto suelto', 'amount', -5000, 'balance', null, 'reference', null,
        'source_hash', repeat('f', 64), 'line_no', 6)
    ),
    '00000000-0000-0000-0000-00000000c101') as id;
create temporary table t_line as
  select id, description from public.bank_statement_lines
   where import_run_id = (select id from t_stmt);

select public.match_bank_statement_line(
  (select id from t_line where description = 'Sueldo uno'),
  array[(select transaction_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b5')],
  '00000000-0000-0000-0000-00000000c101');

create temporary table t_before as
  select public.matched_line_totals(array(select id from t_line)) as totals;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
update public.payroll_entries set recibo_neto = 500000
 where id = '00000000-0000-0000-0000-00000000c1c3';
reset role;

select results_eq(
  $$select t.channel_id, t.amount
      from public.transactions t
     where t.id = (select transaction_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b5')$$,
  $$values ('jouve_fiscal'::text, 300000.00::numeric)$$,
  '8. a reconciled payment changes channel with the recibo'
);

select is(
  public.matched_line_totals(array(select id from t_line)),
  (select totals from t_before),
  '8. its line keeps its total'
);

-- 9: a reconciled group split again.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c1b6', '00000000-0000-0000-0000-00000000c1c3',
   '00000000-0000-0000-0000-00000000c1a1', 400000, 'transferencia', '2097-03-10');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.match_bank_statement_line(
  (select id from t_line where description = 'Sueldo dos'),
  array(select transaction_id from t_pay
         where id = '00000000-0000-0000-0000-00000000c1b6'
            or split_parent_id = '00000000-0000-0000-0000-00000000c1b6'),
  '00000000-0000-0000-0000-00000000c101');
update t_before set totals = public.matched_line_totals(array(select id from t_line));

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
update public.payroll_entries set recibo_neto = 400000
 where id = '00000000-0000-0000-0000-00000000c1c3';
reset role;

select results_eq(
  $$select t.channel_id, t.amount
      from t_pay p join public.transactions t on t.id = p.transaction_id
     where p.id = '00000000-0000-0000-0000-00000000c1b6'
        or p.split_parent_id = '00000000-0000-0000-0000-00000000c1b6'
     order by p.split_parent_id nulls first$$,
  $$values ('jouve_fiscal'::text, 100000.00::numeric), ('jouve_internal'::text, 300000.00::numeric)$$,
  '9. a reconciled crossing payment is split again on the same line'
);

select is(
  public.matched_line_totals(array(select id from t_line)),
  (select totals from t_before),
  '9. every line keeps its total'
);

-- 10: a reconciled movement stays locked outside the primitives (a loose
-- one, so the document guard does not answer first).
insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-00000000c1a9', '00000000-0000-0000-0000-00000000c1a1', 'jouve_internal',
   'expense', 5000, 'ARS', '2097-03-20', '2097-03-01', 'Gasto suelto');
select public.match_bank_statement_line(
  (select id from t_line where description = 'Gasto suelto'),
  array['00000000-0000-0000-0000-00000000c1a9']::uuid[],
  '00000000-0000-0000-0000-00000000c101');
update t_before set totals = public.matched_line_totals(array(select id from t_line));

select throws_ok(
  $$update public.transactions set amount = 1 where id = '00000000-0000-0000-0000-00000000c1a9'$$,
  '55006',
  'El movimiento está conciliado con el extracto bancario: desconciliá su línea en la pestaña «Extracto» de su cuenta antes de cambiar monto, fecha, cuenta, tipo, moneda o canal',
  '10. a direct update of a reconciled movement is refused'
);

select set_config('jouve.rewriting_reconciled', 'on', true);
select throws_ok(
  $$update public.transactions set channel_id = 'jouve_fiscal' where id = '00000000-0000-0000-0000-00000000c1a9'$$,
  '55006',
  'El movimiento está conciliado con el extracto bancario: desconciliá su línea en la pestaña «Extracto» de su cuenta antes de cambiar monto, fecha, cuenta, tipo, moneda o canal',
  '10. the GUC alone, outside a trigger, is not enough'
);
select set_config('jouve.rewriting_reconciled', 'off', true);

select throws_ok(
  $$delete from public.transactions where id = '00000000-0000-0000-0000-00000000c1a9'$$,
  '55006',
  'El movimiento está conciliado con el extracto bancario: desconciliá su línea en la pestaña «Extracto» de su cuenta antes de borrarlo',
  '10. nor is it deleted'
);

-- 11/12: the group edit.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c103","role":"authenticated"}', true);
select throws_ok(
  $$select public.update_payroll_payment('00000000-0000-0000-0000-00000000c1b6',
      '00000000-0000-0000-0000-00000000c1a1', 400000, 'transferencia', '2097-03-10', null)$$,
  '42501',
  null,
  '11. operations cannot edit payroll payments'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
select throws_ok(
  $$select public.update_payroll_payment('00000000-0000-0000-0000-00000000c1b6',
      '00000000-0000-0000-0000-00000000c1a1', 450000, 'transferencia', '2097-03-10', null)$$,
  '55006',
  'El pago está conciliado: desconciliá su línea en la pestaña «Extracto» de su cuenta para cambiar el monto',
  '12. a reconciled payment keeps its amount'
);

select lives_ok(
  $$select public.update_payroll_payment('00000000-0000-0000-0000-00000000c1b6',
      '00000000-0000-0000-0000-00000000c1a1', 400000, 'transferencia', '2097-03-10', 'nota nueva')$$,
  '12. the same amount with new notes is saved'
);
reset role;

select results_eq(
  $$select notes from public.payroll_payments
     where id = '00000000-0000-0000-0000-00000000c1b6'
        or split_parent_id = '00000000-0000-0000-0000-00000000c1b6'$$,
  $$values ('nota nueva'::text), ('nota nueva'::text)$$,
  '12. both pieces take the notes'
);

select is(
  public.matched_line_totals(array(select id from t_line)),
  (select totals from t_before),
  '12. the edit keeps every line total'
);

-- 9: a parent matched with two lines cannot be split.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c1b7', '00000000-0000-0000-0000-00000000c1c3',
   '00000000-0000-0000-0000-00000000c1a1', 600000, 'transferencia', '2097-03-15');
reset role;

select is(
  (select channel_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b7'),
  'jouve_internal',
  '9. a payment beyond the share is internal'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.match_bank_statement_lines(
  array(select id from t_line where description like 'Sueldo tres%'),
  (select transaction_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b7'),
  '00000000-0000-0000-0000-00000000c101');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
select throws_ok(
  $$update public.payroll_entries set recibo_neto = 1000000
     where id = '00000000-0000-0000-0000-00000000c1c3'$$,
  '55006',
  'El pago de sueldo está conciliado de una forma que el reparto automático no puede mantener: desconciliá su línea en la pestaña «Extracto» de su cuenta, cargá el cambio y volvé a conciliar',
  '9. a payment matched with two lines that would cross the share is refused'
);
reset role;

-- 19: a period closed before the split keeps its channels ------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.payroll_periods set posts_receipt_gap = false
 where id = '00000000-0000-0000-0000-00000000c1d3';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}', true);
insert into public.payroll_payments (id, entry_id, account_id, channel_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c1b8', '00000000-0000-0000-0000-00000000c1c4',
   '00000000-0000-0000-0000-00000000c1a1', 'jouve_fiscal', 300000, 'transferencia', '2097-05-05');

select is(
  (select channel_id from t_pay where id = '00000000-0000-0000-0000-00000000c1b8'),
  'jouve_fiscal',
  '19. a period without the split keeps the channel the payment was given'
);

select throws_ok(
  $$update public.payroll_periods set posts_receipt_gap = true
     where id = '00000000-0000-0000-0000-00000000c1d3'$$,
  '42501',
  'Si una liquidación reparte los pagos por recibo lo define el sistema.',
  '19. a client cannot change posts_receipt_gap'
);

select throws_ok(
  $$insert into public.payroll_periods (year, month, posts_receipt_gap) values (2097, 6, false)$$,
  '42501',
  'Si una liquidación reparte los pagos por recibo lo define el sistema.',
  '19. nor insert a period without it'
);

update public.payroll_periods set status = 'closed'
 where id = '00000000-0000-0000-0000-00000000c1d3';
reset role;

select is(
  (select count(*)::int from public.journal_entries where source_table = 'payroll_entries'
      and source_id = '00000000-0000-0000-0000-00000000c1c4'),
  0,
  '19. closing it posts no recibo gap'
);

-- Invariant over every entry with the split: fiscal pieces = least(cap, paid).
select is(
  (select count(*)::int
     from public.v_payroll_entries_with_payments v
     join public.payroll_entries pe on pe.id = v.id
     join public.payroll_periods pp on pp.id = pe.period_id
    where pp.posts_receipt_gap
      and v.id::text like '00000000-0000-0000-0000-00000000c1c%'
      and v.paid_fiscal <> least(public.payroll_fiscal_cap(v.fiscal_share, v.total_a_pagar), v.paid_total)),
  0,
  'fiscal pieces add up to least(cap, paid) on every entry'
);

select is(
  (select count(*)::int from (
     select split_parent_id from public.payroll_payments
      where split_parent_id is not null group by entry_id, split_parent_id
   ) x
   join public.payroll_payments p on p.id = x.split_parent_id
   where p.entry_id::text like '00000000-0000-0000-0000-00000000c1c%'
   group by p.entry_id having count(*) > 1),
  null,
  'at most one payment per entry is split'
);

select * from finish();

rollback;
