-- emit_journal_for_receipt: a fiscal receipt with retentions books a balanced
-- entry, each retention debited to the asset it is. One transaction, rolled back.

begin;

select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f2', 'finance@retentions.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f2', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c101', '20333333334', 'Cliente Retiene', 'responsable_inscripto');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a101', 'Banco Test', 'bank', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency)
values ('00000000-0000-0000-0000-0000000006f1', 'jouve_fiscal', 3, 9001,
        '00000000-0000-0000-0000-00000000c101', current_date, 1000, 'ARS');
insert into public.receipt_payment_lines (receipt_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-00000000a101', 900);
insert into public.receipt_retentions
  (receipt_id, kind, tax_type, certificate_number, certificate_date, amount)
values
  ('00000000-0000-0000-0000-0000000006f1', 'retencion', 'ganancias', 'C-1', current_date, 70),
  ('00000000-0000-0000-0000-0000000006f1', 'percepcion', 'iibb', 'C-2', current_date, 30);

select lives_ok(
  'set constraints all immediate',
  'a fiscal receipt with retentions books its entry'
);

reset role;

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'receipts' and source_id = '00000000-0000-0000-0000-0000000006f1'),
  1,
  'one entry for the receipt'
);

select is(
  (select sum(l.debit) - sum(l.credit)
     from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
    where e.source_id = '00000000-0000-0000-0000-0000000006f1'),
  0::numeric,
  'the entry balances'
);

select is(
  (select l.debit
     from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
     join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
    where e.source_id = '00000000-0000-0000-0000-0000000006f1'
      and c.system_role = 'retenciones_pagadas'),
  70::numeric,
  'the retention is debited to retenciones_pagadas'
);

select is(
  (select l.debit
     from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
     join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
    where e.source_id = '00000000-0000-0000-0000-0000000006f1'
      and c.system_role = 'percepciones_iibb_pagadas'),
  30::numeric,
  'the IIBB perception is debited to percepciones_iibb_pagadas'
);

select * from finish();

rollback;
