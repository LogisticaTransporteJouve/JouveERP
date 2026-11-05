-- Audit w14 S5 F1 (20261105100000): fail_itemless_invoice_drafts marks failed
-- the drafts left without items past the cutoff, which frees what they were
-- billing: a late-interest period keyed on the draft (the period reads
-- charged while the draft lives) and a carga linked to it. A draft with items
-- and a recent one are left alone. The fixture drafts are dated 2001 so they
-- come first in the function's order. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(9);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000014a5c1', false, null, 'Cliente borradores sin ítems', null);

-- The overdue factura the interest is charged on.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000014a5d1', 'jouve_internal', '00000000-0000-0000-0000-00000014a5c1',
   'factura', null, 9001, 99141, '2026-09-01', '2026-10-01', 2, 99, '0', 10000, 0, 10000, 'emitted',
   'itemless-w14-f');

-- The charge, past its own 15-minute grace.
insert into public.late_interest_charges
  (id, invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount,
   moneda, created_at)
values
  ('00000000-0000-0000-0000-00000014a5e1', '00000000-0000-0000-0000-00000014a5d1',
   '00000000-0000-0000-0000-00000014a5c1', '2026-10-02', '2026-10-31', 3, 10000, 300, 'PES',
   now() - interval '1 hour');

-- n1: the interest ND, header only, keyed on the charge. d2: a factura header
-- only, with a carga linked. d3: a draft with its items. d4: a header-only
-- draft still within the cutoff.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key,
   invoice_origin_id, created_at)
values
  ('00000000-0000-0000-0000-00000014a5a1', 'jouve_internal', '00000000-0000-0000-0000-00000014a5c1',
   'nd', null, 9001, null, '2026-10-31', 2, 99, '0', 300, 0, 300, 'draft',
   '00000000-0000-0000-0000-00000014a5e1', '00000000-0000-0000-0000-00000014a5d1',
   '2001-01-01 10:00+00'),
  ('00000000-0000-0000-0000-00000014a5a2', 'jouve_internal', '00000000-0000-0000-0000-00000014a5c1',
   'factura', null, 9001, null, '2026-10-31', 2, 99, '0', 100, 0, 100, 'draft',
   'itemless-w14-d2', null, '2001-01-01 10:01+00'),
  ('00000000-0000-0000-0000-00000014a5a3', 'jouve_internal', '00000000-0000-0000-0000-00000014a5c1',
   'factura', null, 9001, null, '2026-10-31', 2, 99, '0', 100, 0, 100, 'draft',
   'itemless-w14-d3', null, '2001-01-01 10:02+00'),
  ('00000000-0000-0000-0000-00000014a5a4', 'jouve_internal', '00000000-0000-0000-0000-00000014a5c1',
   'factura', null, 9001, null, '2026-10-31', 2, 99, '0', 100, 0, 100, 'draft',
   'itemless-w14-d4', null, now());

insert into public.invoice_items
  (invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total)
values
  ('00000000-0000-0000-0000-00000014a5a3', 'Flete', 1, 100, 3, 100, 0, 100);

insert into public.shipments (id, client_id, freight_amount, status, invoice_id) values
  ('00000000-0000-0000-0000-00000014a5b1', '00000000-0000-0000-0000-00000014a5c1', 100, 'delivered',
   '00000000-0000-0000-0000-00000014a5a2');

select is(
  (select public.late_interest_charge_is_live(c) from public.late_interest_charges c
    where c.id = '00000000-0000-0000-0000-00000014a5e1'),
  true,
  'a header-only ND keyed on the charge holds its period'
);

create temporary table t_failed as
  select id from public.fail_itemless_invoice_drafts(now() - interval '15 minutes', 500) as f(id);

select ok(
  exists (select 1 from t_failed where id = '00000000-0000-0000-0000-00000014a5a1')
  and exists (select 1 from t_failed where id = '00000000-0000-0000-0000-00000014a5a2'),
  'it returns the drafts it failed'
);

select results_eq(
  $$select id::text, status from public.invoices
     where id in ('00000000-0000-0000-0000-00000014a5a1', '00000000-0000-0000-0000-00000014a5a2',
                  '00000000-0000-0000-0000-00000014a5a3', '00000000-0000-0000-0000-00000014a5a4')
     order by id$$,
  $$values ('00000000-0000-0000-0000-00000014a5a1', 'failed'),
           ('00000000-0000-0000-0000-00000014a5a2', 'failed'),
           ('00000000-0000-0000-0000-00000014a5a3', 'draft'),
           ('00000000-0000-0000-0000-00000014a5a4', 'draft')$$,
  'only the drafts without items past the cutoff are failed'
);

select is(
  (select afip_observaciones ->> 'error' from public.invoices
    where id = '00000000-0000-0000-0000-00000014a5a2'),
  'El comprobante quedó sin ítems (su carga se interrumpió) y se marcó fallido: volvé a emitirlo.',
  'the failed draft says why'
);

select is(
  (select public.late_interest_charge_is_live(c) from public.late_interest_charges c
    where c.id = '00000000-0000-0000-0000-00000014a5e1'),
  false,
  'the interest period is free again'
);

select is(
  (select invoice_id from public.shipments where id = '00000000-0000-0000-0000-00000014a5b1'),
  null::uuid,
  'the carga linked to the draft is released'
);

select is(
  (select count(*) from public.fail_itemless_invoice_drafts(now() - interval '15 minutes', 500) as f(id)
    where f.id in ('00000000-0000-0000-0000-00000014a5a1', '00000000-0000-0000-0000-00000014a5a2')),
  0::bigint,
  'a second call does not touch them again'
);

select ok(
  (select p.prosecdef from pg_proc p
    where p.oid = 'public.fail_itemless_invoice_drafts(timestamptz, integer)'::regprocedure)
  and has_function_privilege('service_role', 'public.fail_itemless_invoice_drafts(timestamptz, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.fail_itemless_invoice_drafts(timestamptz, integer)', 'execute')
  and not has_function_privilege('anon', 'public.fail_itemless_invoice_drafts(timestamptz, integer)', 'execute'),
  'security definer, for the service role only'
);

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'public.fail_itemless_invoice_drafts(timestamptz, integer)'::regprocedure),
  'with an empty search_path'
);

select * from finish();

rollback;
