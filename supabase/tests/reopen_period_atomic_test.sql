-- reopen_accounting_period (20261106112002) reopens a closed period and posts
-- the entries that waited for it in one transaction. One transaction, rolled
-- back.

begin;

select plan(6);

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-000000000bc1', '20999999984', 'Cliente Reapertura', 'responsable_inscripto');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.accounting_closed_periods (period) values ('1997-04');

-- An imported emitted voucher in the closed period: its entry waits.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto, doc_tipo, doc_nro,
   imp_neto, imp_iva, imp_total, cbte_tipo_afip, iva_condition_receptor, cae, cae_vencimiento,
   status, idempotency_key)
values ('00000000-0000-0000-0000-000000000be1', 'jouve_fiscal', '00000000-0000-0000-0000-000000000bc1',
   'factura', 'A', 3, 97001, '1997-04-12', 2, 80,
   '20999999984', 100, 21, 121, 1, 1, '75000000000097', '1997-04-22', 'emitted', 'reopen-atomic-a');

select is(
  (select count(*) from public.pending_journal_entries
    where source_table = 'invoices' and source_id = '00000000-0000-0000-0000-000000000be1'),
  1::bigint,
  'the voucher''s entry waits for the period'
);

select is(
  (public.reopen_accounting_period('1997-04') ->> 'posted')::int,
  1,
  'reopening posts the waiting entry'
);

select ok(
  not exists (select 1 from public.accounting_closed_periods where period = '1997-04')
  and not exists (select 1 from public.pending_journal_entries
                   where source_table = 'invoices' and source_id = '00000000-0000-0000-0000-000000000be1'),
  'and leaves the period open with nothing pending'
);

select is(
  public.reopen_accounting_period('1997-04'),
  null::jsonb,
  'a period that is not closed returns null'
);

select ok(
  not has_function_privilege('authenticated', 'public.reopen_accounting_period(text)', 'execute')
  and not has_function_privilege('anon', 'public.reopen_accounting_period(text)', 'execute')
  and has_function_privilege('service_role', 'public.reopen_accounting_period(text)', 'execute'),
  'only the service role calls it (the action gates owner/admin)'
);

select is(
  (select count(*) from public.journal_entries
    where source_table = 'invoices' and source_id = '00000000-0000-0000-0000-000000000be1'
      and not is_reversal),
  1::bigint,
  'exactly one entry is posted'
);

select * from finish();
rollback;
