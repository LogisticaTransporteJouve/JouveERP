-- Auditoría W2 · S3 F2 (20261104102300): an NC against a purchase charged to
-- an employee lowers the employee's charge and posts its neto back to
-- anticipos_personal, never to the expense; cancelling it restores the
-- charge; a user-edited description survives a re-sync. One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(7);

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000000102e1', 'Empleado con NC', 'mensual', 1000, '2090-01-01');
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000102a1', true, '30999999994', 'Proveedor NC a cargo', 'responsable_inscripto');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, charged_employee_id)
values
  ('00000000-0000-0000-0000-0000000102f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000000102a1',
   'factura', 'A', 9, 1021, '2099-02-10', 1000, 210, 1210, 'received',
   '00000000-0000-0000-0000-0000000102e1');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000102f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000000102a1',
   'nc', 'A', 9, 1022, '2099-02-15', 200, 42, 242, 'received',
   '00000000-0000-0000-0000-0000000102f1');
set constraints all immediate;
set constraints all deferred;

select is(
  (select amount from public.employee_account_movements
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000102f1'),
  800.00::numeric,
  'the employee owes the factura net of its NC'
);

create function pg_temp.nc_line(p_role text) returns numeric
language sql as $$
  select coalesce(sum(l.credit - l.debit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = 'purchase_invoices'
     and je.source_id = '00000000-0000-0000-0000-0000000102f2'
     and l.chart_of_accounts_id = public.find_account_by_role(p_role::public.coa_system_role)
$$;

select is(pg_temp.nc_line('anticipos_personal'), 200.00::numeric,
  'the NC credits its neto to anticipos al personal');
select is(pg_temp.nc_line('compras'), 0::numeric,
  'and nothing to the expense, so Gestión shows no gain');

-- The user renames the charge; a later edit of the factura keeps the name.
update public.employee_account_movements set description = 'Celular de Juan'
 where purchase_invoice_id = '00000000-0000-0000-0000-0000000102f1';
update public.purchase_invoices set fecha = '2099-02-11'
 where id = '00000000-0000-0000-0000-0000000102f1';

select is(
  (select description from public.employee_account_movements
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000102f1'),
  'Celular de Juan',
  'a description the user edited survives the re-sync'
);

update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000000102f2';
set constraints all immediate;
set constraints all deferred;

select is(
  (select amount from public.employee_account_movements
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000102f1'),
  1000.00::numeric,
  'cancelling the NC restores the whole charge'
);

-- A second NC for the whole neto takes the charge away.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000102f3', 'jouve_fiscal', '00000000-0000-0000-0000-0000000102a1',
   'nc', 'A', 9, 1023, '2099-02-16', 1000, 210, 1210, 'received',
   '00000000-0000-0000-0000-0000000102f1');

select is(
  (select count(*)::int from public.employee_account_movements
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000102f1'),
  0,
  'an NC for the whole neto leaves nothing to charge'
);

-- Charging the factura to nobody re-posts its NCs to the expense side.
update public.purchase_invoices set charged_employee_id = null
 where id = '00000000-0000-0000-0000-0000000102f1';
set constraints all immediate;

select is(
  (select coalesce(sum(l.credit - l.debit), 0)
     from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'purchase_invoices'
      and je.source_id = '00000000-0000-0000-0000-0000000102f3'
      and l.chart_of_accounts_id = public.find_account_by_role('anticipos_personal')),
  0::numeric,
  'removing the charge re-posts the NC off anticipos al personal'
);

select * from finish();
rollback;
