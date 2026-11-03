-- Impuestos (20261104092200): undoing a payment gives the document back the
-- amount and status it had before it, by "Pagar" or by "Vincular", and only
-- pay/link set the pre-payment columns. One transaction, rolled back.

begin;

select plan(7);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000009220f1', 'owner@taxrestore.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000009220f1', 'owner');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000009220a1', 'Banco Impuestos Restore', 'bank', 'ARS');

create temporary table t_coa as
  select (select id from public.chart_of_accounts where system_role = 'iva_debito') as tax_account;

-- Pendiente without an amount, pendiente with a typed amount, liquidado.
insert into public.tax_documents (id, kind, period, due_date, amount, status, account_id, created_by) values
  ('00000000-0000-0000-0000-0000009220d1', 'iva', '1998-08', '1998-09-20', null, 'pendiente',
   (select tax_account from t_coa), '00000000-0000-0000-0000-0000009220f1'),
  ('00000000-0000-0000-0000-0000009220d2', 'iibb', '1998-08', '1998-09-15', 500, 'pendiente',
   (select tax_account from t_coa), '00000000-0000-0000-0000-0000009220f1'),
  ('00000000-0000-0000-0000-0000009220d3', 'sicore', '1998-08', '1998-09-10', 300, 'liquidado',
   (select tax_account from t_coa), '00000000-0000-0000-0000-0000009220f1');

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-0000009220e1', '00000000-0000-0000-0000-0000009220a1', 'jouve_fiscal',
   'expense', 300, 'ARS', '2026-10-10', '2026-10-01', 'Transferencia SICORE restore');

select public.pay_tax_document('00000000-0000-0000-0000-0000009220d1', '2026-10-20',
  '00000000-0000-0000-0000-0000009220a1', 100);
select public.pay_tax_document('00000000-0000-0000-0000-0000009220d2', '2026-10-15',
  '00000000-0000-0000-0000-0000009220a1', 500);
select public.link_tax_document_payment('00000000-0000-0000-0000-0000009220d3',
  '00000000-0000-0000-0000-0000009220e1', '00000000-0000-0000-0000-0000009220f1');
set constraints all immediate;

select results_eq(
  $$select status, amount, payment_previous_status, payment_previous_amount from public.tax_documents
     where id = '00000000-0000-0000-0000-0000009220d1'$$,
  $$values ('pagado'::text, 100.00::numeric, 'pendiente'::text, null::numeric)$$,
  'paying fills the missing amount and keeps what the document had'
);

create temporary table t_undo as
  select d.id, u.*
    from (values ('00000000-0000-0000-0000-0000009220d1'::uuid),
                 ('00000000-0000-0000-0000-0000009220d2'::uuid),
                 ('00000000-0000-0000-0000-0000009220d3'::uuid)) as d (id)
    cross join lateral public.undo_tax_document_payment(d.id, '00000000-0000-0000-0000-0000009220f1') u;
set constraints all immediate;

select results_eq(
  $$select status, amount from public.tax_documents where id = '00000000-0000-0000-0000-0000009220d1'$$,
  $$values ('pendiente'::text, null::numeric)$$,
  'a pendiente document with no amount comes back pendiente and without the paid amount'
);

select results_eq(
  $$select status, amount from public.tax_documents where id = '00000000-0000-0000-0000-0000009220d2'$$,
  $$values ('pendiente'::text, 500.00::numeric)$$,
  'a pendiente document with a typed amount comes back pendiente, not liquidado'
);

select results_eq(
  $$select status, amount from public.tax_documents where id = '00000000-0000-0000-0000-0000009220d3'$$,
  $$values ('liquidado'::text, 300.00::numeric)$$,
  'a liquidado document paid by linking a movement comes back liquidado'
);

select is(
  (select count(*)::int from public.tax_documents
    where id in ('00000000-0000-0000-0000-0000009220d1', '00000000-0000-0000-0000-0000009220d2',
                 '00000000-0000-0000-0000-0000009220d3')
      and (payment_previous_status is not null or payment_previous_amount is not null)),
  0,
  'the undo clears the pre-payment columns'
);

-- Guards, as the table owner ----------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$update public.tax_documents set payment_previous_status = 'liquidado'
     where id = '00000000-0000-0000-0000-0000009220d1'$$,
  '23514',
  null,
  'the pre-payment status is set only by pay or link'
);

select throws_ok(
  $$insert into public.tax_documents (kind, period, due_date, amount, payment_previous_amount)
    values ('iva', '1998-07', '1998-08-20', 10, 10)$$,
  '23514',
  null,
  'a new document carries no pre-payment amount'
);

select * from finish();
rollback;
