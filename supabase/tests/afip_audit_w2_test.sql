-- AFIP audit wave 2 (20261104100000–20261104100300): a fiscal dollar voucher
-- needs a cotización > 1; the Comprobantes list total sums emitted vouchers
-- only; emit_caea_invoice refuses a CAEA declared "sin movimiento" for the
-- punto de venta; delete_orphan_files deletes only files still orphan. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(11);

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000a5c1', '20955555552', 'Cliente Auditoría AFIP', 'responsable_inscripto');
-- Internal vouchers need an internal client (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000a5c2', false, null, 'Cliente Interno Auditoría AFIP', null);

-- 1. guard_invoice_cotizacion ----------------------------------------------

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, fecha, concepto, doc_tipo, doc_nro,
       imp_neto, imp_total, moneda, cotizacion, cbte_tipo_afip, iva_condition_receptor, status, idempotency_key)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000000a5c1', 'factura', 'A', 3, current_date, 2, 80,
            '20955555552', 100, 100, 'DOL', 1, 1, 1, 'draft', 'afip-w2-usd-1')$$,
  '23514',
  'Cargá la cotización del dólar del día para el comprobante en dólares (tiene que ser mayor a 1)',
  'a fiscal dollar voucher needs a cotización > 1'
);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, fecha, concepto, doc_tipo, doc_nro,
   imp_neto, imp_total, moneda, cotizacion, cbte_tipo_afip, iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000000a5e1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000a5c1',
   'factura', 'A', 3, current_date, 2, 80, '20955555552', 100, 100, 'DOL', 1000, 1, 1, 'draft', 'afip-w2-usd');

select throws_ok(
  $$update public.invoices set cotizacion = 1 where id = '00000000-0000-0000-0000-00000000a5e1'$$,
  '23514',
  null,
  'nor can an update set it to 1'
);

select lives_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, punto_venta, numero, fecha, concepto, doc_tipo, doc_nro,
       imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
    values ('jouve_internal', '00000000-0000-0000-0000-00000000a5c2', 'factura', 1, 95501, current_date, 2, 80,
            '20955555552', 10, 10, 'DOL', 1, 'draft', 'afip-w2-internal-usd')$$,
  'an internal voucher (no entry, no libro) is not guarded'
);

-- 2. invoice_list_totals -----------------------------------------------------

insert into public.invoices
  (channel_id, client_id, kind, punto_venta, numero, fecha, concepto, doc_tipo, doc_nro,
   imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('jouve_internal', '00000000-0000-0000-0000-00000000a5c2', 'factura', 1, 95502, current_date, 2, 80,
   '20955555552', 300, 300, 'PES', 1, 'emitted', 'afip-w2-emitted'),
  ('jouve_internal', '00000000-0000-0000-0000-00000000a5c2', 'factura', 1, null, current_date, 2, 80,
   '20955555552', 50, 50, 'PES', 1, 'draft', 'afip-w2-draft'),
  ('jouve_internal', '00000000-0000-0000-0000-00000000a5c2', 'factura', 1, 95503, current_date, 2, 80,
   '20955555552', 70, 70, 'PES', 1, 'cancelled', 'afip-w2-cancelled');

select results_eq(
  $$select documents, total from public.invoice_list_totals(
      p_client_id => '00000000-0000-0000-0000-00000000a5c2', p_is_fiscal => false)
     where moneda = 'PES'$$,
  $$values (3, 300::numeric)$$,
  'the list total sums emitted vouchers only; the count covers every listed row'
);

-- 3. emit_caea_invoice -------------------------------------------------------

insert into public.caea_codes (periodo, orden, caea, fch_vig_desde, fch_vig_hasta, fch_tope_inf, no_movement_pvs)
values (209901, 1, '99999999999901', current_date - 20, current_date - 6, current_date + 2, '[77]'::jsonb);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, fecha, concepto, doc_tipo, doc_nro,
   imp_neto, imp_total, moneda, cotizacion, cbte_tipo_afip, iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000000a5e2', 'jouve_fiscal', '00000000-0000-0000-0000-00000000a5c1',
   'factura', 'A', 77, current_date - 10, 2, 80, '20955555552', 100, 100, 'PES', 1, 1, 1, 'draft', 'afip-w2-caea-77'),
  ('00000000-0000-0000-0000-00000000a5e3', 'jouve_fiscal', '00000000-0000-0000-0000-00000000a5c1',
   'factura', 'A', 78, current_date - 10, 2, 80, '20955555552', 100, 100, 'PES', 1, 1, 1, 'draft', 'afip-w2-caea-78');

select throws_ok(
  $$select public.emit_caea_invoice('00000000-0000-0000-0000-00000000a5e2', 0, '99999999999901', current_date - 6)$$,
  '23514',
  null,
  'no voucher under a CAEA already declared sin movimiento for its punto de venta'
);

select is(
  (select status from public.invoices where id = '00000000-0000-0000-0000-00000000a5e2'),
  'draft',
  'the refused voucher stays unnumbered'
);

create temp table caea_emitted as
  select public.emit_caea_invoice(
    '00000000-0000-0000-0000-00000000a5e3', 0, '99999999999901', current_date - 6) as numero;

select is(
  (select status from public.invoices where id = '00000000-0000-0000-0000-00000000a5e3'),
  'emitted',
  'another punto de venta still emits under the same CAEA'
);

select is(
  public.emit_caea_invoice('00000000-0000-0000-0000-00000000a5e3', 0, '99999999999901', current_date - 6),
  (select numero from caea_emitted),
  'a retry gets its number back'
);

-- 4. delete_orphan_files -----------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a5f0', 'ops@afip-w2.test');
insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000000a5f9', 'AW2001A', 'camion');
insert into public.files
  (id, uploaded_by, original_filename, mime_type, file_size, bucket, bucket_path, source, created_at)
values
  ('00000000-0000-0000-0000-00000000a5f1', '00000000-0000-0000-0000-00000000a5f0',
   'huerfano.pdf', 'application/pdf', 10, 'files', 'afip-w2/huerfano.pdf', 'manual_upload', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000a5f2', '00000000-0000-0000-0000-00000000a5f0',
   'adjuntado.pdf', 'application/pdf', 10, 'files', 'afip-w2/adjuntado.pdf', 'manual_upload', now() - interval '2 days');

-- Found orphan by the sweep, then referenced before the delete.
create temp table orphans_found as
  select id from public.find_orphan_files('1 hour')
   where id in ('00000000-0000-0000-0000-00000000a5f1', '00000000-0000-0000-0000-00000000a5f2');
insert into public.fleet_documents (id, vehicle_id, kind, expires_at, attachment_file_id) values
  ('00000000-0000-0000-0000-00000000a5fd', '00000000-0000-0000-0000-00000000a5f9', 'vtv',
   current_date + 200, '00000000-0000-0000-0000-00000000a5f2');

select is((select count(*)::int from orphans_found), 2, 'both files were orphans when found');

create temp table orphans_deleted as
  select * from public.delete_orphan_files(
    array['00000000-0000-0000-0000-00000000a5f1', '00000000-0000-0000-0000-00000000a5f2']::uuid[],
    '1 hour');

select results_eq(
  $$select id, bucket_path from orphans_deleted$$,
  $$values ('00000000-0000-0000-0000-00000000a5f1'::uuid, 'afip-w2/huerfano.pdf'::text)$$,
  'only the file still orphan is deleted and returned'
);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-00000000a5f2'),
  1,
  'a file referenced since the find keeps its row'
);

select * from finish();
rollback;
