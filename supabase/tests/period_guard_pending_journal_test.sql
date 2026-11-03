-- Roadmap 0.2 + 0.3 (20261102200000): a fiscal draft cannot enter a closed
-- period, an AFIP-authorized voucher is saved even when its entry cannot be
-- posted (the entry waits in pending_journal_entries), and reopening the
-- period posts it once. One transaction, rolled back.

begin;

select plan(16);

create function pg_temp.live_entries(p_id uuid) returns int
language sql as $$
  select count(*)::int from public.journal_entries je
   where je.source_table = 'invoices' and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000af1', 'finance@period-guard.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-000000000af1', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-000000000ac1', '20999999984', 'Cliente Período', 'responsable_inscripto');
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-000000000ac2', false, null, 'Cliente Período Interno', null);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000af1","role":"authenticated"}', true);

insert into public.accounting_closed_periods (period) values ('1998-03');

-- 0.2: no fiscal draft in a closed period ------------------------------------

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, fecha, concepto, doc_tipo, doc_nro,
       imp_neto, imp_iva, imp_total, cbte_tipo_afip, iva_condition_receptor, status, idempotency_key)
    values ('jouve_fiscal', '00000000-0000-0000-0000-000000000ac1', 'factura', 'A', 3, '1998-03-10', 2, 80,
       '20999999984', 100, 21, 121, 1, 1, 'draft', 'period-guard-a')$$,
  '55006', null,
  'a fiscal draft dated in a closed period is refused'
);

select is(
  (select count(*)::int from public.invoices where idempotency_key = 'period-guard-a'),
  0,
  'no draft row is left behind'
);

select lives_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro,
       imp_neto, imp_iva, imp_total, status, idempotency_key)
    values ('jouve_internal', '00000000-0000-0000-0000-000000000ac2', 'factura', 3, '1998-03-10', 2, 99,
       '0', 100, 0, 100, 'draft', 'period-guard-internal')$$,
  'an internal draft is not affected (it posts nothing)'
);

-- A draft whose period closes before it is sent to AFIP.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, fecha, concepto, doc_tipo, doc_nro,
   imp_neto, imp_iva, imp_total, cbte_tipo_afip, iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-000000000ae1', 'jouve_fiscal', '00000000-0000-0000-0000-000000000ac1',
   'factura', 'A', 3, '1998-05-10', 2, 80, '20999999984', 100, 21, 121, 1, 1, 'draft', 'period-guard-b');
insert into public.accounting_closed_periods (period) values ('1998-05');

select throws_ok(
  $$update public.invoices set status = 'emitting' where id = '00000000-0000-0000-0000-000000000ae1'$$,
  '55006', null,
  'the draft→emitting flip is refused once the period is closed'
);

-- 0.3: an authorized voucher is saved; its entry waits ----------------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, fecha, concepto, doc_tipo, doc_nro,
   imp_neto, imp_iva, imp_total, cbte_tipo_afip, iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-000000000ae2', 'jouve_fiscal', '00000000-0000-0000-0000-000000000ac1',
   'factura', 'A', 3, '1998-06-10', 2, 80, '20999999984', 100, 21, 121, 1, 1, 'emitting', 'period-guard-c');
insert into public.accounting_closed_periods (period) values ('1998-06');

select lives_ok(
  $$update public.invoices
       set numero = 98001, cae = '75000000000001', cae_vencimiento = '1998-06-20', status = 'emitted'
     where id = '00000000-0000-0000-0000-000000000ae2'$$,
  'persisting the CAE succeeds although the period is closed'
);

select is(
  (select status from public.invoices where id = '00000000-0000-0000-0000-000000000ae2'),
  'emitted',
  'the voucher is emitted with its CAE'
);

select is(pg_temp.live_entries('00000000-0000-0000-0000-000000000ae2'), 0, 'no entry in the closed period');

select is(
  (select error_code from public.pending_journal_entries
    where source_table = 'invoices' and source_id = '00000000-0000-0000-0000-000000000ae2'),
  '55006',
  'the missing entry is recorded with its cause'
);

select is(
  (public.post_pending_journals('1998-06') ->> 'posted')::int,
  0,
  'nothing posts while the period is still closed'
);

-- Reopen: the entry posts once.
delete from public.accounting_closed_periods where period = '1998-06';

select is(
  (public.post_pending_journals('1998-06') ->> 'posted')::int,
  1,
  'reopening lets the pending entry post'
);

select is(pg_temp.live_entries('00000000-0000-0000-0000-000000000ae2'), 1, 'exactly one entry is posted');

select is(
  (public.post_pending_journals('1998-06') ->> 'posted')::int
    + pg_temp.live_entries('00000000-0000-0000-0000-000000000ae2'),
  1,
  'running it again posts nothing and keeps one entry'
);

-- The ARCA import (INSERT of an emitted row) is saved too (20261104090000) ---

select lives_ok(
  $$insert into public.invoices
      (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto, doc_tipo, doc_nro,
       imp_neto, imp_iva, imp_total, cbte_tipo_afip, iva_condition_receptor, cae, cae_vencimiento,
       status, idempotency_key)
    values ('00000000-0000-0000-0000-000000000ae3', 'jouve_fiscal', '00000000-0000-0000-0000-000000000ac1',
       'factura', 'A', 3, 98002, '1998-03-12', 2, 80,
       '20999999984', 100, 21, 121, 1, 1, '75000000000002', '1998-03-22', 'emitted', 'period-guard-arca')$$,
  'an imported emitted voucher in a closed period is saved (the import does not stop)'
);

select is(pg_temp.live_entries('00000000-0000-0000-0000-000000000ae3'), 0, 'the imported voucher posts no entry in the closed period');

select is(
  (select error_code from public.pending_journal_entries
    where source_table = 'invoices' and source_id = '00000000-0000-0000-0000-000000000ae3'),
  '55006',
  'the imported voucher''s entry waits in pending_journal_entries'
);

-- Privileges -------------------------------------------------------------------

select ok(
  has_table_privilege('authenticated', 'public.pending_journal_entries', 'select')
  and not has_table_privilege('authenticated', 'public.pending_journal_entries', 'insert')
  and not has_function_privilege('authenticated', 'public.post_pending_journals(text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.emit_journal_or_record(text, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.post_pending_journals(text, integer)', 'execute'),
  'authenticated reads the table only; the functions are service-role only'
);

select * from finish();
rollback;
