-- create_invoice_draft (20261106130000) inserts a comprobante draft and its
-- items in one transaction: a refused item leaves no header-only draft, a
-- draft needs an item, the status and number are always a draft's, and a
-- repeated idempotency_key raises 23505 as the plain insert did. One
-- transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(8);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001306c1', false, null, 'Cliente borrador atómico', null);

create temporary table t_draft as
  select public.create_invoice_draft(
    jsonb_build_object(
      'channel_id', 'jouve_internal', 'client_id', '00000000-0000-0000-0000-0000001306c1',
      'kind', 'factura', 'letter', null, 'cbte_tipo_afip', null, 'punto_venta', 9001,
      'numero', 77, 'fecha', '2026-11-06', 'concepto', 2, 'doc_tipo', 99, 'doc_nro', '0',
      'iva_condition_receptor', null, 'imp_neto', 300, 'imp_iva', 0, 'imp_trib', 0,
      'imp_tot_conc', 0, 'imp_op_ex', 0, 'imp_total', 300, 'moneda', 'PES', 'cotizacion', 1,
      'status', 'emitted', 'notes', 'Atómico', 'idempotency_key', 'atomic-draft-1'
    ),
    jsonb_build_array(
      jsonb_build_object('sort_order', 0, 'description', 'Flete', 'quantity', 1,
        'unit_price', 100, 'iva_rate_id', 3, 'line_neto', 100, 'line_iva', 0, 'line_total', 100),
      jsonb_build_object('sort_order', 1, 'description', 'Estadía', 'quantity', 2,
        'unit_price', 100, 'iva_rate_id', 3, 'revenue_kind', 'service',
        'line_neto', 200, 'line_iva', 0, 'line_total', 200)
    )
  ) as id;

select results_eq(
  $$select i.status, i.numero, i.notes, i.imp_total
      from public.invoices i join t_draft t on t.id = i.id$$,
  $$values ('draft'::text, null::integer, 'Atómico'::text, 300.00::numeric)$$,
  'it inserts a draft, with no number, whatever status or numero it is sent'
);

select results_eq(
  $$select it.sort_order, it.description, it.revenue_kind, it.line_total
      from public.invoice_items it join t_draft t on t.id = it.invoice_id
     order by it.sort_order$$,
  $$values (0, 'Flete'::text, 'service'::text, 100.00::numeric),
           (1, 'Estadía'::text, 'service'::text, 200.00::numeric)$$,
  'with its items, in order'
);

select throws_ok(
  $$select public.create_invoice_draft(
      jsonb_build_object(
        'channel_id', 'jouve_internal', 'client_id', '00000000-0000-0000-0000-0000001306c1',
        'kind', 'factura', 'punto_venta', 9001, 'fecha', '2026-11-06', 'concepto', 2,
        'doc_tipo', 99, 'doc_nro', '0', 'imp_neto', 100, 'imp_iva', 0, 'imp_trib', 0,
        'imp_tot_conc', 0, 'imp_op_ex', 0, 'imp_total', 100, 'moneda', 'PES', 'cotizacion', 1,
        'idempotency_key', 'atomic-draft-2'),
      jsonb_build_array(jsonb_build_object('sort_order', 0, 'description', 'Flete',
        'quantity', 1, 'unit_price', 100, 'iva_rate_id', 9999,
        'line_neto', 100, 'line_iva', 0, 'line_total', 100)))$$,
  '23514',
  null,
  'a refused item raises'
);

select is(
  (select count(*) from public.invoices where idempotency_key = 'atomic-draft-2'),
  0::bigint,
  'and leaves no header-only draft'
);

select throws_ok(
  $$select public.create_invoice_draft(
      jsonb_build_object('channel_id', 'jouve_internal', 'idempotency_key', 'atomic-draft-3'),
      '[]'::jsonb)$$,
  '22023',
  'a draft needs at least one item',
  'a draft with no items is refused'
);

select throws_ok(
  $$select public.create_invoice_draft(
      jsonb_build_object(
        'channel_id', 'jouve_internal', 'client_id', '00000000-0000-0000-0000-0000001306c1',
        'kind', 'factura', 'punto_venta', 9001, 'fecha', '2026-11-06', 'concepto', 2,
        'doc_tipo', 99, 'doc_nro', '0', 'imp_neto', 100, 'imp_iva', 0, 'imp_trib', 0,
        'imp_tot_conc', 0, 'imp_op_ex', 0, 'imp_total', 100, 'moneda', 'PES', 'cotizacion', 1,
        'idempotency_key', 'atomic-draft-1'),
      jsonb_build_array(jsonb_build_object('sort_order', 0, 'description', 'Flete',
        'quantity', 1, 'unit_price', 100, 'iva_rate_id', 3,
        'line_neto', 100, 'line_iva', 0, 'line_total', 100)))$$,
  '23505',
  null,
  'a repeated idempotency_key raises unique_violation, as the insert did'
);

select ok(
  has_function_privilege('service_role', 'public.create_invoice_draft(jsonb, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_invoice_draft(jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.create_invoice_draft(jsonb, jsonb)', 'execute'),
  'for the service role only'
);

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'public.create_invoice_draft(jsonb, jsonb)'::regprocedure),
  'with an empty search_path'
);

select * from finish();

rollback;
