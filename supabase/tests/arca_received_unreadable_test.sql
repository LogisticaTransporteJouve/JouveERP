-- A voucher whose amounts did not read stays in the tray as «No se pudieron
-- leer» (20261106180000): with its reason and what ARCA listed, kind optional
-- (a type the tray does not load may not read either), and only in the
-- states that can hold one. One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(7);

create function pg_temp.add(
  p_numero int,
  p_status text,
  p_kind text,
  p_reason text
) returns void
language sql as $$
  insert into public.arca_received_vouchers
    (origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta,
     numero, fecha, imp_total, status, unreadable_reason, raw_amounts)
  values
    ('sync', '30711111118', 'Proveedor', case when p_kind is null then 201 else 1 end,
     p_kind, case when p_kind is null then null else 'A' end, 9180, p_numero,
     '2026-10-01', 0, p_status, p_reason,
     case when p_reason is null then null else '{"neto": "100", "total": "90"}'::jsonb end);
$$;

select lives_ok(
  $$select pg_temp.add(1, 'unreadable', 'factura', 'amount_over_total')$$,
  'an unreadable factura keeps its reason and what ARCA listed'
);

select lives_ok(
  $$select pg_temp.add(2, 'unreadable', null, 'bad_amount')$$,
  'an unreadable voucher of a type the tray does not load has no kind'
);

select throws_ok(
  $$select pg_temp.add(3, 'unreadable', 'factura', null)$$,
  '23514', null,
  'an unreadable voucher says why'
);

select throws_ok(
  $$select pg_temp.add(4, 'pending_review', 'factura', 'bad_amount')$$,
  '23514', null,
  'a pending voucher was read: it carries no unreadable reason'
);

select throws_ok(
  $$select pg_temp.add(5, 'pending_review', null, null)$$,
  '23514', null,
  'a pending voucher still needs its kind'
);

select lives_ok(
  $$update public.arca_received_vouchers set status = 'discarded'
     where punto_venta = 9180 and numero = 2$$,
  'an unreadable one without kind can be discarded'
);

select throws_ok(
  $$select pg_temp.add(6, 'unreadable', 'factura', 'whatever')$$,
  '23514', null,
  'the reason is one the parser gives'
);

select * from finish();
rollback;
