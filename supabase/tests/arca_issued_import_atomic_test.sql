-- Audit w9-s5 F2 / w9-s1 F2 (20261104160100): import_arca_issued_invoice
-- writes an ARCA voucher and its per-alícuota items together, or neither.
-- One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(12);

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000916c1', '20999999160', 'Cliente import ARCA w9', 'responsable_inscripto');

create function pg_temp.voucher(p_nro int) returns jsonb
language sql as $$
  select jsonb_build_object(
    'channel_id', 'jouve_fiscal',
    'client_id', '00000000-0000-0000-0000-0000000916c1',
    'kind', 'factura',
    'letter', 'A',
    'punto_venta', 916,
    'numero', p_nro,
    'fecha', '2026-10-30',
    'concepto', 2,
    'doc_tipo', 80,
    'doc_nro', '20999999160',
    'iva_condition_receptor', 1,
    'cbte_tipo_afip', 1,
    'cbte_tipo_origen_afip', null,
    'invoice_origin_id', null,
    'origin_unlinked', false,
    'imp_neto', 1100,
    'imp_iva', 126,
    'imp_trib', 0,
    'imp_op_ex', 0,
    'imp_tot_conc', 0,
    'imp_total', 1226,
    'moneda', 'PES',
    'cotizacion', 1,
    'cae', '76000000000916',
    'cae_vencimiento', '2026-11-09',
    'emission_type', 'cae',
    'status', 'emitted',
    'emitted_at', '2026-10-30T12:00:00-03:00',
    'idempotency_key', 'arca-sync-916-1-' || p_nro
  );
$$;

create function pg_temp.items(p_second_base numeric) returns jsonb
language sql as $$
  select jsonb_build_array(
    jsonb_build_object('sort_order', 0, 'description', 'Importado de ARCA', 'quantity', 1,
      'unit_price', 100, 'iva_rate_id', 5, 'line_neto', 100, 'line_iva', 21, 'line_total', 121),
    jsonb_build_object('sort_order', 1, 'description', 'Importado de ARCA', 'quantity', 1,
      'unit_price', p_second_base, 'iva_rate_id', 4, 'line_neto', p_second_base, 'line_iva', 105,
      'line_total', p_second_base + 105)
  );
$$;

create function pg_temp.item_count(p_key text) returns int
language sql as $$
  select count(it.*)::int
    from public.invoices i
    join public.invoice_items it on it.invoice_id = i.id
   where i.idempotency_key = p_key;
$$;

-- Header and items land together ----------------------------------------------

create temp table first_call as
  select public.import_arca_issued_invoice(pg_temp.voucher(1), pg_temp.items(1000)) as id;

select isnt((select id from first_call), null, 'a new voucher returns its id');

select is(
  (select id from public.invoices where idempotency_key = 'arca-sync-916-1-1'),
  (select id from first_call),
  'the header is inserted'
);

select is(pg_temp.item_count('arca-sync-916-1-1'), 2, 'its two alícuotas are inserted with it');

select is(
  (select array_agg(iva_rate_id order by sort_order)
     from public.invoice_items where invoice_id = (select id from first_call)),
  array[5, 4],
  'each item keeps its own rate'
);

-- A replay inserts nothing ----------------------------------------------------

select is(
  public.import_arca_issued_invoice(pg_temp.voucher(1), pg_temp.items(1000)),
  null,
  'a voucher already imported returns null'
);

select is(pg_temp.item_count('arca-sync-916-1-1'), 2, 'and adds no items');

-- Without a breakdown it stays header-only, as before ----------------------------

select isnt(
  public.import_arca_issued_invoice(pg_temp.voucher(2), '[]'::jsonb),
  null,
  'a voucher without items is still imported'
);

select is(pg_temp.item_count('arca-sync-916-1-2'), 0, 'header-only when ARCA sends no usable breakdown');

-- A failing item takes the header with it ----------------------------------------

select throws_ok(
  $$select public.import_arca_issued_invoice(pg_temp.voucher(3), pg_temp.items(999))$$,
  '22023', null,
  'items that do not tie to the header neto are refused'
);

select throws_ok(
  $$select public.import_arca_issued_invoice(
      pg_temp.voucher(4),
      jsonb_set(pg_temp.items(1000), '{0,quantity}', '0'))$$,
  '23514', null,
  'an item the table rejects aborts the call'
);

select is(
  (select count(*)::int from public.invoices
    where idempotency_key in ('arca-sync-916-1-3', 'arca-sync-916-1-4')),
  0,
  'neither failed call leaves a header-only voucher behind'
);

select throws_ok(
  $$select public.import_arca_issued_invoice(
      jsonb_set(pg_temp.voucher(5), '{idempotency_key}', '"issue-x"'), '[]'::jsonb)$$,
  '22023', null,
  'only ARCA import keys are accepted'
);

select * from finish();

rollback;
