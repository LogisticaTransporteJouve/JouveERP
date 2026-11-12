-- Card statements (20261107234000): settle_card_statement books one expense
-- per account at the debit, in pesos or in dollars at the bank's rate with
-- the rounding cents on one line, refuses a lone refund, and owns what it
-- books (no edit or delete by hand, not loose, tagged card_statement);
-- unsettle_card_statement undoes it; reclassify_card_statement_lines books a
-- paid part again on the same debit and refuses (20261112100200) a paid part
-- whose debit is no longer matched. One transaction, rolled back.

begin;

select plan(21);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0f01', 'owner@cards.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000c0f01', 'owner');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000c0a01', 'Banco Tarjeta', 'bank', 'ARS');

select ok(
  not has_function_privilege('authenticated', 'public.settle_card_statement(uuid, uuid, text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.unsettle_card_statement(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated',
        'public.card_statement_amounts(uuid, text, numeric, numeric, numeric)', 'execute')
  and not has_function_privilege('authenticated',
        'public.reclassify_card_statement_lines(uuid, uuid[], text, uuid, uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.settle_card_statement(uuid, uuid, text, text, uuid)', 'execute'),
  'only the service role runs the card statement RPCs'
);

-- The debits: pesos of statement 1, dollars of statement 2, pesos of 3.
create temporary table t_run as
  select public.commit_import_run(
    'bank_statement', 'extracto.csv', repeat('7', 64), '{}'::jsonb, 3, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-0000000c0a01', 'line_date', '2026-11-05',
        'description', 'Pago Visa Empresa', 'amount', -1500, 'balance', null, 'reference', null,
        'source_hash', repeat('d', 64), 'line_no', 2),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-0000000c0a01', 'line_date', '2026-11-05',
        'description', 'Pago Visa Empresa', 'amount', -145600.02, 'balance', null, 'reference', null,
        'source_hash', repeat('e', 64), 'line_no', 3),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-0000000c0a01', 'line_date', '2026-11-05',
        'description', 'Pago Visa Empresa', 'amount', -900, 'balance', null, 'reference', null,
        'source_hash', repeat('f', 64), 'line_no', 4)
    ),
    '00000000-0000-0000-0000-0000000c0f01') as id;

create temporary table t_lines as
  select l.id, l.amount from public.bank_statement_lines l
   where l.import_run_id = (select id from t_run);

insert into public.card_statements (id, number, account_number, pay_account_id, close_date, due_date, total_ars, total_usd) values
  ('00000000-0000-0000-0000-0000000c05a1', 'C1', '1234', '00000000-0000-0000-0000-0000000c0a01', '2026-10-29', '2026-11-11', 1500, 0),
  ('00000000-0000-0000-0000-0000000c05a2', 'C2', '1234', '00000000-0000-0000-0000-0000000c0a01', '2026-10-29', '2026-11-11', 0, 100),
  ('00000000-0000-0000-0000-0000000c05a3', 'C3', '1234', '00000000-0000-0000-0000-0000000c0a01', '2026-10-29', '2026-11-11', 900, 0);

insert into public.card_statement_lines
  (statement_id, sort_order, source, card_last4, line_date, description, currency, amount, treatment, chart_account_id)
select s, o, 'purchase', '1111', '2026-10-10', d, c, a, 'expense',
       (select id from public.chart_of_accounts where code = acc)
  from (values
    ('00000000-0000-0000-0000-0000000c05a1'::uuid, 1, 'Nafta', 'ARS', 1000.00, '5.1.1'),
    ('00000000-0000-0000-0000-0000000c05a1'::uuid, 2, 'Peaje', 'ARS', 500.00, '5.2.1'),
    -- A refund in full nets to zero and books nothing; the cents of the
    -- dollars go on one line of the other account.
    ('00000000-0000-0000-0000-0000000c05a2'::uuid, 1, 'Suscripción', 'USD', 100.00, '5.1.1'),
    ('00000000-0000-0000-0000-0000000c05a2'::uuid, 2, 'Devolución', 'USD', -100.00, '5.1.1'),
    ('00000000-0000-0000-0000-0000000c05a2'::uuid, 3, 'Hosting', 'USD', 33.33, '5.2.1'),
    ('00000000-0000-0000-0000-0000000c05a2'::uuid, 4, 'Hosting', 'USD', 33.33, '5.2.1'),
    ('00000000-0000-0000-0000-0000000c05a2'::uuid, 5, 'Hosting', 'USD', 33.34, '5.2.1'),
    -- A refund alone in its account.
    ('00000000-0000-0000-0000-0000000c05a3'::uuid, 1, 'Compra', 'ARS', 1000.00, '5.1.1'),
    ('00000000-0000-0000-0000-0000000c05a3'::uuid, 2, 'Devolución', 'ARS', -100.00, '5.2.1')
  ) v(s, o, d, c, a, acc);

-- 1. Pesos ------------------------------------------------------------------------

select is(
  public.settle_card_statement('00000000-0000-0000-0000-0000000c05a1',
    (select id from t_lines where amount = -1500), 'ARS', 'jouve_fiscal',
    '00000000-0000-0000-0000-0000000c0f01'),
  2,
  'the pesos book one expense per account'
);

select is(
  (select array_agg(t.amount order by t.amount) from public.transactions t
    where t.id in (select transaction_id from public.card_statement_lines
                    where statement_id = '00000000-0000-0000-0000-0000000c05a1')),
  array[500.00, 1000.00]::numeric[],
  'each expense carries its account''s purchases'
);

select is(
  (select status from public.card_statements where id = '00000000-0000-0000-0000-0000000c05a1')
    || '/' || (select status from public.bank_statement_lines where id = (select id from t_lines where amount = -1500)),
  'pagado/matched',
  'the statement is paid and the debit reconciled'
);

-- 2. Ownership --------------------------------------------------------------------

create temporary table t_tx as
  select transaction_id as id from public.card_statement_lines
   where statement_id = '00000000-0000-0000-0000-0000000c05a1' and sort_order = 1;

select throws_like(
  $$update public.transactions set amount = 1 where id = (select id from t_tx)$$,
  '%resumen de tarjeta%',
  'a card movement cannot be edited by hand'
);

select throws_like(
  $$delete from public.transactions where id = (select id from t_tx)$$,
  '%resumen de tarjeta%',
  'a card movement cannot be deleted by hand'
);

select ok(
  not public.transaction_is_loose((select t from public.transactions t where t.id = (select id from t_tx))),
  'a card movement is not loose'
);

select is(
  (select source_document from public.v_transactions_tagged where id = (select id from t_tx)),
  'card_statement',
  'a card movement is tagged with its statement'
);

-- 3. Undo -------------------------------------------------------------------------

select is(
  public.unsettle_card_statement('00000000-0000-0000-0000-0000000c05a1', 'ARS',
    '00000000-0000-0000-0000-0000000c0f01'),
  2,
  'undo deletes the movements it booked'
);

select is(
  (select status from public.card_statements where id = '00000000-0000-0000-0000-0000000c05a1')
    || '/' || (select status from public.bank_statement_lines where id = (select id from t_lines where amount = -1500))
    || '/' || (select count(*) from public.card_statement_lines
                where statement_id = '00000000-0000-0000-0000-0000000c05a1' and transaction_id is not null),
  'pendiente/open/0',
  'the statement and the debit are pending again'
);

-- 4. Dollars ----------------------------------------------------------------------

select is(
  public.settle_card_statement('00000000-0000-0000-0000-0000000c05a2',
    (select id from t_lines where amount = -145600.02), 'USD', 'jouve_fiscal',
    '00000000-0000-0000-0000-0000000c0f01'),
  1,
  'a refund in full books nothing: one expense for the other account'
);

select is(
  (select sum(t.amount) from public.transactions t
    where t.id in (select transaction_id from public.card_statement_lines
                    where statement_id = '00000000-0000-0000-0000-0000000c05a2')),
  145600.02,
  'the dollars at the bank''s rate add up to the debit, cents included'
);

select is(
  (select status || '/' || paid_usd_on::text from public.card_statements
    where id = '00000000-0000-0000-0000-0000000c05a2'),
  'pagado/2026-11-05',
  'a statement with only dollars is paid with them'
);

-- 5. Changing a paid line books the part again ------------------------------------

select is(
  public.reclassify_card_statement_lines('00000000-0000-0000-0000-0000000c05a2',
    array(select id from public.card_statement_lines
           where statement_id = '00000000-0000-0000-0000-0000000c05a2' and description = 'Hosting'),
    'expense', '00000000-0000-0000-0000-0000000c0f01',
    (select id from public.chart_of_accounts where code = '5.1.1')),
  3,
  'a paid line changes its account'
);

select is(
  (select array_agg(distinct c.code) from public.transactions t
     join public.chart_of_accounts c on c.id = t.expense_account_id
    where t.id in (select transaction_id from public.card_statement_lines
                    where statement_id = '00000000-0000-0000-0000-0000000c05a2')),
  array['5.1.1']::text[],
  'the part is booked again with the new account'
);

select is(
  (select sum(t.amount) from public.transactions t
    where t.id in (select transaction_id from public.card_statement_lines
                    where statement_id = '00000000-0000-0000-0000-0000000c05a2'))::text
    || '/' || (select status from public.card_statements where id = '00000000-0000-0000-0000-0000000c05a2')
    || '/' || (select status from public.bank_statement_lines where id = (select id from t_lines where amount = -145600.02)),
  '145600.02/pagado/matched',
  'booked again it still adds up to the debit, paid and reconciled'
);

select throws_like(
  $$select public.reclassify_card_statement_lines('00000000-0000-0000-0000-0000000c05a2',
      array(select id from public.card_statement_lines
             where statement_id = '00000000-0000-0000-0000-0000000c05a2' and description = 'Hosting'),
      'ignore', '00000000-0000-0000-0000-0000000c0f01')$$,
  'Hay consumos marcados como «no corresponde»%',
  'a change the payment cannot book is refused and nothing changes'
);

select is(
  (select array_agg(distinct m.line_id::text || '/' || t.transaction_date::text)
     from public.transactions t
     join public.bank_statement_matches m on m.transaction_id = t.id
    where t.id in (select transaction_id from public.card_statement_lines
                    where statement_id = '00000000-0000-0000-0000-0000000c05a2')),
  array[(select id from t_lines where amount = -145600.02)::text || '/2026-11-05'],
  'booked again on the same bank line and date'
);

-- A paid part whose debit is no longer matched is refused, lines untouched.
select public.settle_card_statement('00000000-0000-0000-0000-0000000c05a1',
  (select id from t_lines where amount = -1500), 'ARS', 'jouve_fiscal',
  '00000000-0000-0000-0000-0000000c0f01');
delete from public.bank_statement_matches
 where line_id = (select id from t_lines where amount = -1500);

select throws_ok(
  $$select public.reclassify_card_statement_lines('00000000-0000-0000-0000-0000000c05a1',
      array(select id from public.card_statement_lines
             where statement_id = '00000000-0000-0000-0000-0000000c05a1' and description = 'Peaje'),
      'expense', '00000000-0000-0000-0000-0000000c0f01',
      (select id from public.chart_of_accounts where code = '5.1.1'))$$,
  '55006',
  'No se encontró la línea del extracto que pagó este resumen: deshacé el pago y volvé a pagarlo',
  'a paid part with no matched debit is refused'
);

select is(
  (select c.code from public.card_statement_lines l
     join public.chart_of_accounts c on c.id = l.chart_account_id
    where l.statement_id = '00000000-0000-0000-0000-0000000c05a1' and l.description = 'Peaje'),
  '5.2.1',
  'and its line keeps its account'
);

-- 6. A lone refund ----------------------------------------------------------------

select throws_like(
  $$select public.settle_card_statement('00000000-0000-0000-0000-0000000c05a3',
      (select id from t_lines where amount = -900), 'ARS', 'jouve_fiscal',
      '00000000-0000-0000-0000-0000000c0f01')$$,
  'Una cuenta o un empleado del resumen queda negativo%',
  'an account left negative by a lone refund is refused'
);

select * from finish();

rollback;
