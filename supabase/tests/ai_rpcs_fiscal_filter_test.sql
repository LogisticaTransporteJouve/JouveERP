-- p_is_fiscal on the AI aggregates: true / false keep only that scope's rows,
-- NULL reads every channel; payroll scopes only what was paid; the libro IVA
-- refuses a non-fiscal channel. As an authenticated finance user. One
-- transaction, rolled back.

begin;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f3', 'finance@ai-scope.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f3', 'finance');

-- Documents (and their journal entries) are created as this finance user.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000d301', '30999999987', 'Proveedor IA', 'responsable_inscripto');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000007a1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000d301',
   'factura', 'A', 1, 51, current_date, 100, 21, 121, 'received'),
  ('00000000-0000-0000-0000-0000000007a2', 'jouve_internal', '00000000-0000-0000-0000-00000000d301',
   'factura', null, 1, 52, current_date, 50, 0, 50, 'received');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000008a1', 'Caja IA', 'cash', 'ARS');
insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000000008b1', 'Empleado IA', 'mensual', '2020-01-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000000008c1', 2098, 12);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-0000000008c1',
   '00000000-0000-0000-0000-0000000008b1', 1000);
insert into public.payroll_payments (entry_id, account_id, channel_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-0000000008a1', 'jouve_fiscal', 300, 'transferencia', current_date),
  ('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-0000000008a1', 'jouve_internal', 200, 'efectivo', current_date);

set local role authenticated;

select is(
  (select purchased_ars from public.ai_supplier_purchases_summary(
     current_date, current_date, '00000000-0000-0000-0000-00000000d301', null, 50, true)),
  121::numeric,
  'purchases summary, fiscal: only the fiscal invoice'
);
select is(
  (select purchased_ars from public.ai_supplier_purchases_summary(
     current_date, current_date, '00000000-0000-0000-0000-00000000d301', null, 50, false)),
  50::numeric,
  'purchases summary, internal: only the internal invoice'
);
select is(
  (select purchased_ars from public.ai_supplier_purchases_summary(
     current_date, current_date, '00000000-0000-0000-0000-00000000d301')),
  171::numeric,
  'purchases summary, NULL: every channel'
);
select is(
  (select open_ars from public.ai_supplier_purchases_summary(
     current_date, current_date, '00000000-0000-0000-0000-00000000d301', null, 50, true)),
  121::numeric,
  'purchases summary, fiscal: the open balance is the fiscal one'
);
select is(
  (select count(*)::int from public.ai_supplier_upcoming_dues(
     365, '00000000-0000-0000-0000-00000000d301', 100, true)),
  1,
  'upcoming dues, fiscal: the internal document is left out'
);
select is(
  (select count(*)::int from public.ai_supplier_upcoming_dues(
     365, '00000000-0000-0000-0000-00000000d301')),
  2,
  'upcoming dues, NULL: both documents'
);
select is(
  (select net_ars from public.ai_supplier_price_evolution(
     current_date, current_date, 'supplier', '00000000-0000-0000-0000-00000000d301',
     null, null, 300, false)),
  50::numeric,
  'price evolution, internal: only the internal net'
);
select is(
  (select paid from public.ai_payroll_summary(
     '2098-12', '2098-12', 'month', '00000000-0000-0000-0000-0000000008b1', true)),
  300::numeric,
  'payroll, fiscal: paid counts the fiscal payment only'
);
select is(
  (select saldo from public.ai_payroll_summary(
     '2098-12', '2098-12', 'month', '00000000-0000-0000-0000-0000000008b1', true)),
  500::numeric,
  'payroll, fiscal: the balance is still the real one'
);
select is(
  (select paid from public.ai_payroll_summary(
     '2098-12', '2098-12', 'month', '00000000-0000-0000-0000-0000000008b1')),
  500::numeric,
  'payroll, NULL: every payment'
);

select throws_ok(
  $$select * from public.libro_iva_compras(to_char(current_date, 'YYYY-MM'), 'jouve_internal')$$,
  '23514',
  'El libro IVA solo incluye canales fiscales.',
  'libro IVA compras refuses an internal channel'
);
select throws_ok(
  $$select * from public.libro_iva_ventas(to_char(current_date, 'YYYY-MM'), 'jouve_internal')$$,
  '23514',
  'El libro IVA solo incluye canales fiscales.',
  'libro IVA ventas refuses an internal channel'
);
select lives_ok(
  $$select * from public.libro_iva_compras(to_char(current_date, 'YYYY-MM'), 'jouve_fiscal')$$,
  'libro IVA compras reads a fiscal channel'
);

reset role;

select ok(
  has_function_privilege('authenticated', 'public.ai_client_sales_summary(date, date, uuid, integer, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.ai_fleet_margin(date, date, text, integer, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.ai_payroll_summary(text, text, text, uuid, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ai_client_sales_summary(date, date, uuid, integer, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ai_supplier_upcoming_dues(integer, uuid, integer, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer, boolean)', 'execute'),
  'authenticated executes the new signatures, anon does not'
);

select * from finish();

rollback;
