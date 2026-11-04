-- Audit w11-s5 F1, w11-s2 F1, w11-s4 F3-F4 (20261104190300-190302): a carga
-- links only a live invoice of its client; a fiscal storage factura credited
-- in full by emitted NCs frees its period (claim, delete guard, the void-run
-- list), an internal one or a partial NC does not; a billed run keeps its
-- invoice; a check's import run is set only by commit_import_run and never
-- changes. Every legitimate path still works. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000019f1', 'finance@billing-links-w11.test'),
  ('00000000-0000-0000-0000-0000000019f2', 'owner@billing-links-w11.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000019f1', 'finance'),
  ('00000000-0000-0000-0000-0000000019f2', 'owner');

-- c1: Ventas; c2: Otras ventas; c3: another Otras ventas client.
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000019cc01', true, '30777777778', 'Cliente fiscal w11', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000019cc02', false, null, 'Cliente interno w11', null),
  ('00000000-0000-0000-0000-00000019cc03', false, null, 'Otro cliente w11', null);

-- Storage facturas: f1 credited in full, f2 credited in part, f3 internal
-- credited in full, f4 live, f5 credited in full, f6 a draft.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000019df01', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'factura', 'A', 3, 98101, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'billing-w11-f1'),
  ('00000000-0000-0000-0000-00000019df02', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'factura', 'A', 3, 98102, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'billing-w11-f2'),
  ('00000000-0000-0000-0000-00000019df04', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'factura', 'A', 3, 98104, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'billing-w11-f4'),
  ('00000000-0000-0000-0000-00000019df05', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'factura', 'A', 3, 98105, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'billing-w11-f5'),
  ('00000000-0000-0000-0000-00000019df06', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'factura', 'A', 3, null, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'draft', 'billing-w11-f6');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000019de01', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'nc', 'A', 3, 98111, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'billing-w11-nc1', '00000000-0000-0000-0000-00000019df01'),
  ('00000000-0000-0000-0000-00000019de02', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'nc', 'A', 3, 98112, current_date, 2, 80, '30777777778', 50, 0, 50, 'PES', 1, 3, 1,
   'emitted', 'billing-w11-nc2', '00000000-0000-0000-0000-00000019df02'),
  ('00000000-0000-0000-0000-00000019de05', 'jouve_fiscal', '00000000-0000-0000-0000-00000019cc01',
   'nc', 'A', 3, 98115, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'billing-w11-nc5', '00000000-0000-0000-0000-00000019df05');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000019df03', 'jouve_internal', '00000000-0000-0000-0000-00000019cc02',
   'factura', null, 9001, 98103, current_date, 2, 99, '0', 300, 0, 300, 'emitted', 'billing-w11-f3'),
  -- Freight: s1 live, s2 failed, s3 another client's, s4 a draft that fails later.
  ('00000000-0000-0000-0000-00000019da01', 'jouve_internal', '00000000-0000-0000-0000-00000019cc02',
   'factura', null, 9001, 98121, current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'billing-w11-s1'),
  ('00000000-0000-0000-0000-00000019da02', 'jouve_internal', '00000000-0000-0000-0000-00000019cc02',
   'factura', null, 9001, null, current_date, 2, 99, '0', 100, 0, 100, 'draft', 'billing-w11-s2'),
  ('00000000-0000-0000-0000-00000019da03', 'jouve_internal', '00000000-0000-0000-0000-00000019cc03',
   'factura', null, 9001, 98123, current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'billing-w11-s3'),
  ('00000000-0000-0000-0000-00000019da04', 'jouve_internal', '00000000-0000-0000-0000-00000019cc02',
   'factura', null, 9001, null, current_date, 2, 99, '0', 100, 0, 100, 'draft', 'billing-w11-s4');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000019de03', 'jouve_internal', '00000000-0000-0000-0000-00000019cc02',
   'nc', null, 9001, 98113, current_date, 2, 99, '0', 300, 0, 300, 'emitted', 'billing-w11-nc3',
   '00000000-0000-0000-0000-00000019df03');
update public.invoices set status = 'failed' where id = '00000000-0000-0000-0000-00000019da02';

insert into public.storage_billing_runs
  (id, client_id, channel_id, period_start, period_end, total, invoice_id)
values
  ('00000000-0000-0000-0000-00000019ee01', '00000000-0000-0000-0000-00000019cc01', 'jouve_fiscal',
   '1997-01-01', '1997-01-31', 121, '00000000-0000-0000-0000-00000019df01'),
  ('00000000-0000-0000-0000-00000019ee02', '00000000-0000-0000-0000-00000019cc01', 'jouve_fiscal',
   '1997-02-01', '1997-02-28', 121, '00000000-0000-0000-0000-00000019df02'),
  ('00000000-0000-0000-0000-00000019ee03', '00000000-0000-0000-0000-00000019cc02', 'jouve_internal',
   '1997-03-01', '1997-03-31', 300, '00000000-0000-0000-0000-00000019df03'),
  ('00000000-0000-0000-0000-00000019ee04', '00000000-0000-0000-0000-00000019cc01', 'jouve_fiscal',
   '1997-04-01', '1997-04-30', 121, '00000000-0000-0000-0000-00000019df04'),
  ('00000000-0000-0000-0000-00000019ee05', '00000000-0000-0000-0000-00000019cc01', 'jouve_fiscal',
   '1997-05-01', '1997-05-31', 121, '00000000-0000-0000-0000-00000019df05'),
  ('00000000-0000-0000-0000-00000019ee06', '00000000-0000-0000-0000-00000019cc01', 'jouve_fiscal',
   '1997-06-01', '1997-06-30', 121, '00000000-0000-0000-0000-00000019df06');

insert into public.shipments (id, client_id, freight_amount) values
  ('00000000-0000-0000-0000-00000019ab01', '00000000-0000-0000-0000-00000019cc02', 100),
  ('00000000-0000-0000-0000-00000019ab02', '00000000-0000-0000-0000-00000019cc02', 100),
  ('00000000-0000-0000-0000-00000019ab04', '00000000-0000-0000-0000-00000019cc02', 100);

-- Checks: a cartera and an import run to point at.
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000019a1', 'Cartera w11', 'checks', 'ARS');
insert into public.import_runs (id, kind, file_name, file_sha256, total_rows) values
  ('00000000-0000-0000-0000-0000000019b1', 'checks', 'cartera-w11.csv', repeat('8', 64), 1);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000019f1","role":"authenticated"}', true);

-- 1. A storage factura credited in full -------------------------------------------------

create temp table t_void on commit drop as
  select id from public.storage_billing_void_run_ids() as id;

select is(
  (select array_agg(id order by id) from t_void
    where id::text like '00000000-0000-0000-0000-00000019ee%'),
  array['00000000-0000-0000-0000-00000019ee01'::uuid, '00000000-0000-0000-0000-00000019ee05'::uuid],
  'only the runs of fiscal facturas credited in full read void'
);

select ok(
  public.storage_invoice_is_void('00000000-0000-0000-0000-00000019df01')
  and not public.storage_invoice_is_void('00000000-0000-0000-0000-00000019df02')
  and not public.storage_invoice_is_void('00000000-0000-0000-0000-00000019df03')
  and not public.storage_invoice_is_void('00000000-0000-0000-0000-00000019df04')
  and public.storage_invoice_is_void('00000000-0000-0000-0000-00000019da02')
  and public.storage_invoice_is_void('00000000-0000-0000-0000-0000000019ff') is null,
  'the rule: failed, or fiscal and credited in full; null for no invoice'
);

select lives_ok(
  $$delete from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000019ee05'$$,
  'a run whose fiscal factura is credited in full can be deleted'
);

select throws_ok(
  $$delete from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000019ee02'$$,
  '55006',
  'El período de almacenaje tiene una factura vigente: para liberarlo, anulala si es interna, o emití una nota de crédito por el total si es fiscal.',
  'a run whose factura is credited in part is not'
);

select throws_ok(
  $$delete from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000019ee03'$$,
  '55006',
  null,
  'nor one whose internal factura has an NC for the total (it is cancelled instead)'
);

create temp table t_claim on commit drop as
  select public.claim_storage_billing_period(
    '00000000-0000-0000-0000-00000019cc01', 'jouve_fiscal', '1997-01-10', '1997-01-20') as id;

select isnt(
  (select id from t_claim),
  null,
  'the credited period is claimed again'
);

select is(
  (select count(*)::int from public.storage_billing_runs
    where id = '00000000-0000-0000-0000-00000019ee01'),
  0,
  'and the claim deleted the credited run'
);

select throws_ok(
  $$select public.claim_storage_billing_period(
      '00000000-0000-0000-0000-00000019cc01', 'jouve_fiscal', '1997-02-10', '1997-02-20')$$,
  '23P01',
  'Ese período ya fue facturado (total o parcialmente) para este cliente en este canal.',
  'a period credited in part stays billed'
);

select throws_ok(
  $$select public.claim_storage_billing_period(
      '00000000-0000-0000-0000-00000019cc02', 'jouve_internal', '1997-03-10', '1997-03-20')$$,
  '23P01',
  null,
  'and so does an internal one with an NC'
);

-- 2. A billed run keeps its invoice ----------------------------------------------------

select throws_ok(
  $$update public.storage_billing_runs set invoice_id = null
     where id = '00000000-0000-0000-0000-00000019ee04'$$,
  '55006',
  'El período de almacenaje ya tiene su factura: no se desvincula ni se cambia.',
  'a billed run does not drop its invoice'
);

select throws_ok(
  $$update public.storage_billing_runs set invoice_id = '00000000-0000-0000-0000-00000019df02'
     where id = '00000000-0000-0000-0000-00000019ee04'$$,
  '55006',
  'El período de almacenaje ya tiene su factura: no se desvincula ni se cambia.',
  'nor swaps it for another'
);

select lives_ok(
  $$update public.storage_billing_runs set total = 121, invoice_id = invoice_id
     where id = '00000000-0000-0000-0000-00000019ee04'$$,
  'a full-row PATCH that keeps the invoice still passes'
);

select lives_ok(
  $$update public.storage_billing_runs
       set invoice_id = '00000000-0000-0000-0000-00000019df04', pending_since = null
     where id = (select id from t_claim)$$,
  'the claimed run still links its invoice'
);

-- 3. Check import run ------------------------------------------------------------------

select throws_ok(
  $$insert into public.checks
      (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       cartera_account_id, status, source_kind, channel_id, import_run_id)
    values ('fisico', 'W11-1', 'Banco', 'Librador', current_date, current_date, 100, 'ARS',
            '00000000-0000-0000-0000-0000000019a1', 'en_cartera', 'manual', 'jouve_internal',
            '00000000-0000-0000-0000-0000000019b1')$$,
  '55006',
  'Un cheque queda marcado como importado solo al importarlo desde «Importar datos»',
  'a check is not inserted as imported outside the importer'
);

select lives_ok(
  $$insert into public.checks
      (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       cartera_account_id, status, source_kind, channel_id)
    values ('00000000-0000-0000-0000-00000019ac01', 'fisico', 'W11-2', 'Banco', 'Librador',
            current_date, current_date, 100, 'ARS', '00000000-0000-0000-0000-0000000019a1',
            'en_cartera', 'manual', 'jouve_internal')$$,
  'a check loaded by hand is still inserted'
);

select throws_ok(
  $$update public.checks set import_run_id = '00000000-0000-0000-0000-0000000019b1'
     where id = '00000000-0000-0000-0000-00000019ac01'$$,
  '55006',
  'La importación de la que viene un cheque no se cambia',
  'a hand-loaded check is not marked imported'
);

select lives_ok(
  $$update public.checks set notes = 'revisado', import_run_id = import_run_id
     where id = '00000000-0000-0000-0000-00000019ac01'$$,
  'its other columns still change (and a full-row PATCH keeps the mark)'
);

-- 4. As the table owner -----------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Shipments.

select lives_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000019da01', invoicing_claimed_at = null
     where id = '00000000-0000-0000-0000-00000019ab01'$$,
  'a carga links a live invoice of its client'
);

select throws_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000019da02'
     where id = '00000000-0000-0000-0000-00000019ab02'$$,
  '55006',
  'La factura del flete falló o se anuló: volvé a facturar la carga.',
  'a carga does not link a failed invoice'
);

select throws_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000019da03'
     where id = '00000000-0000-0000-0000-00000019ab02'$$,
  '23514',
  'La factura no es del cliente de la carga.',
  'nor another client''s'
);

select lives_ok(
  $$update public.shipments set invoice_id = '00000000-0000-0000-0000-00000019da04'
     where id = '00000000-0000-0000-0000-00000019ab04'$$,
  'a carga links a draft invoice of its client'
);

select lives_ok(
  $$update public.invoices set status = 'failed' where id = '00000000-0000-0000-0000-00000019da04'$$,
  'that invoice still fails'
);

select is(
  (select invoice_id from public.shipments where id = '00000000-0000-0000-0000-00000019ab04'),
  null,
  'and release_invoice_billing_links still frees the carga'
);

-- Storage: the FK's set null on an invoice delete still passes.

select lives_ok(
  $$delete from public.invoices where id = '00000000-0000-0000-0000-00000019df06'$$,
  'a draft invoice linked to a run is still deleted'
);

select is(
  (select invoice_id from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000019ee06'),
  null,
  'and its run drops the link'
);

-- Checks: the importer still loads and undoes them.

create temp table t_run on commit drop as
  select public.commit_import_run(
    'checks', 'cartera-w11b.xlsx', repeat('6', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'kind', 'fisico', 'check_number', 'W11-3', 'bank_name', 'Banco', 'drawer_name', 'Acme',
      'drawer_cuit', null, 'issue_date', current_date, 'due_date', current_date + 30, 'amount', 250,
      'currency', 'ARS', 'cartera_account_id', '00000000-0000-0000-0000-0000000019a1',
      'channel_id', 'jouve_internal', 'notes', null)),
    '00000000-0000-0000-0000-0000000019f2') as id;

select throws_ok(
  $$update public.checks set import_run_id = null where import_run_id = (select id from t_run)$$,
  '55006',
  'La importación de la que viene un cheque no se cambia',
  'commit_import_run still loads a check, and its mark does not change'
);

select lives_ok(
  $$select public.undo_import_run((select id from t_run), '00000000-0000-0000-0000-0000000019f2')$$,
  'undo_import_run still removes it'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_shipment_invoice()', 'execute')
  and not has_function_privilege('anon', 'public.guard_shipment_invoice()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_check_import_run()', 'execute')
  and not has_function_privilege('anon', 'public.guard_check_import_run()', 'execute')
  and not has_function_privilege('anon', 'public.storage_invoice_is_void(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.storage_billing_void_run_ids()', 'execute')
  and has_function_privilege('authenticated', 'public.storage_billing_void_run_ids()', 'execute'),
  'the guards are not callable from the API; the void-run list is, by signed-in users'
);

select * from finish();
rollback;
