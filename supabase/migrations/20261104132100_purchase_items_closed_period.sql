SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W6 · S1 F2: the items of a fiscal purchase in a closed period are
-- frozen, like its header (guard_purchase_invoice_edit, 20261104113001).
--
-- libro_iva_compras splits a purchase by the alícuota of its items, so
-- removing them (p_items = []) or moving neto between rates rewrote a
-- «Definitivo» book and its TXT while the header guard saw no change.
--
-- - replace_purchase_invoice_items refuses a replace that changes what the
--   book reads: the neto and IVA per alícuota, and whether there are items.
--   Re-saving the same lines (the edit form always sends them) still passes,
--   so notes, due date and account stay editable in a closed period.
-- - A trigger refuses any other write to those items (finance can write the
--   table directly under RLS). The RPC tells it, through the transaction-local
--   setting jouve.replacing_purchase_items, that it already checked.
--
-- A purchase cannot be created received in a closed period (its entry would
-- post there), so the create flow's items call never meets the lock.
--
-- Rollback: older code calls the same RPC; an edit that changes a closed
-- period's items gets the 55006 message, as a header change already does.

-- Same predicate as the header guard: received, fiscal, period closed.
create or replace function public.purchase_items_period_closed(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.purchase_invoices p
      join public.accounting_closed_periods cp on cp.period = to_char(p.fecha, 'YYYY-MM')
     where p.id = p_invoice_id
       and p.status = 'received'
       and coalesce(public.is_channel_fiscal(p.channel_id), false)
  );
$$;

revoke all on function public.purchase_items_period_closed(uuid) from public, anon, authenticated;

create or replace function public.guard_purchase_invoice_items_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('jouve.replacing_purchase_items', true) = 'on' then
    return coalesce(new, old);
  end if;
  if (tg_op <> 'INSERT' and public.purchase_items_period_closed(old.purchase_invoice_id))
     or (tg_op <> 'DELETE' and public.purchase_items_period_closed(new.purchase_invoice_id)) then
    raise exception 'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_purchase_invoice_items_period() from public, anon, authenticated;

create trigger purchase_invoice_items_guard_period
  before insert or update or delete on public.purchase_invoice_items
  for each row execute function public.guard_purchase_invoice_items_period();

-- From 20261104096400, plus the closed-period check and the setting the trigger reads.
create or replace function public.replace_purchase_invoice_items(p_invoice_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_sum_neto  numeric(15, 2);
  v_sum_iva   numeric(15, 2);
  v_sum_total numeric(15, 2);
begin
  -- Role guard (purchase_invoices:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar ítems de facturas de compra'
      using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a jsonb array';
  end if;

  -- What libro_iva_compras reads from the items: neto and IVA per alícuota.
  if public.purchase_items_period_closed(p_invoice_id)
     and exists (
       with stored as (
         select it.iva_rate_id, sum(it.line_neto) as neto, sum(it.line_iva) as iva
           from public.purchase_invoice_items it
          where it.purchase_invoice_id = p_invoice_id
          group by it.iva_rate_id
       ),
       incoming as (
         select nullif(e ->> 'iva_rate_id', '')::int as iva_rate_id,
                sum((e ->> 'line_neto')::numeric(15, 2)) as neto,
                sum(coalesce((e ->> 'line_iva')::numeric(15, 2), 0)) as iva
           from jsonb_array_elements(p_items) e
          group by 1
       ),
       changed as (
         (select * from stored except select * from incoming)
         union all
         (select * from incoming except select * from stored)
       )
       select 1 from changed
     ) then
    raise exception 'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  perform set_config('jouve.replacing_purchase_items', 'on', true);

  delete from public.purchase_invoice_items
   where purchase_invoice_id = p_invoice_id;

  if jsonb_array_length(p_items) = 0 then
    perform set_config('jouve.replacing_purchase_items', '', true);
    return;
  end if;

  -- An item without a rate would count exempt or non-taxed amounts a second time.
  if exists (
       select 1 from public.purchase_invoices
        where id = p_invoice_id and imp_no_gravado + imp_op_exentas > 0
     )
     and exists (
       select 1 from jsonb_array_elements(p_items) e
        where nullif(e ->> 'iva_rate_id', '') is null
     ) then
    raise exception 'Con exento o no gravado en el encabezado, los ítems deben tener alícuota.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.purchase_invoice_items (
      purchase_invoice_id, sort_order, description,
      quantity, unit_price, iva_rate_id,
      line_neto, line_iva, line_total
    ) values (
      p_invoice_id,
      coalesce((v_item ->> 'sort_order')::int, 0),
      v_item ->> 'description',
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      nullif(v_item ->> 'iva_rate_id', '')::int,
      (v_item ->> 'line_neto')::numeric,
      coalesce((v_item ->> 'line_iva')::numeric, 0),
      (v_item ->> 'line_total')::numeric
    );
  end loop;

  perform set_config('jouve.replacing_purchase_items', '', true);

  -- Recalc header totals from items. imp_trib, imp_no_gravado and
  -- imp_op_exentas (header-level) preserved.
  select
    coalesce(sum(line_neto),  0),
    coalesce(sum(line_iva),   0),
    coalesce(sum(line_total), 0)
    into v_sum_neto, v_sum_iva, v_sum_total
  from public.purchase_invoice_items
  where purchase_invoice_id = p_invoice_id;

  update public.purchase_invoices
     set imp_neto  = v_sum_neto,
         imp_iva   = v_sum_iva,
         imp_total = v_sum_total + coalesce(imp_trib, 0) + imp_no_gravado + imp_op_exentas,
         updated_at = now()
   where id = p_invoice_id;
end;
$$;

revoke all on function public.replace_purchase_invoice_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_purchase_invoice_items(uuid, jsonb) to authenticated, service_role;
