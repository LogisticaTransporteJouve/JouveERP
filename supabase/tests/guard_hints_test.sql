-- Guard rejections carry hint 'jouve_guard' (lib/db/guard-errors.ts relies on
-- it); a native constraint does not. One transaction, rolled back.

begin;

select plan(5);

create function pg_temp.hint_of(p_sql text) returns text
language plpgsql as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;

-- Fiscal documents post through create_journal_entry, which wants a role.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.accounting_closed_periods (period) values ('1999-01');

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b301', '30555555556', 'Proveedor Hint', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000000b302', '30666666667', 'Otro Hint', 'responsable_inscripto');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000005c1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b301',
   'factura', 1, 50, current_date, 100, 0, 100, 'received');

select is(
  pg_temp.hint_of($$insert into public.journal_entries (entry_date, accrual_period, description)
                    values ('1999-01-10', '1999-01', 'Cerrado')$$),
  'jouve_guard',
  'guard_journal_period_closed'
);

select is(
  pg_temp.hint_of($$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status, invoice_origin_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000000b302', 'nc', 1, 51, current_date, 10,
            'received', '00000000-0000-0000-0000-0000000005c1')$$),
  'jouve_guard',
  'guard_purchase_invoice_origin'
);

select is(
  pg_temp.hint_of($$update public.invoicing_channels set is_fiscal = false where id = 'jouve_fiscal'$$),
  'jouve_guard',
  'guard_invoicing_channel_config'
);

select is(
  pg_temp.hint_of($$select public.create_manual_journal_entry('2026-10-15', 'x', '[]'::jsonb, null)$$),
  'jouve_guard',
  'create_manual_journal_entry'
);

select is(
  pg_temp.hint_of($$insert into public.chart_of_accounts (code, name, level, account_type)
                    values ('no-es-codigo', 'x', 1, 'activo')$$),
  null,
  'a native CHECK carries no hint'
);

select * from finish();

rollback;
