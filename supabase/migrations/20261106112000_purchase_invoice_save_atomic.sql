SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A purchase invoice was saved in two writes from TypeScript: the header
-- (insert or update on purchase_invoices) and then its items
-- (replace_purchase_invoice_items). When the items failed, the header stayed:
-- a create left a purchase without its lines (returned as `createdId`, with no
-- audit event) and an update left the new header over the old items.
--
-- create_purchase_invoice / update_purchase_invoice do both in one
-- transaction: when the items are refused nothing is saved. SECURITY INVOKER:
-- the caller's RLS on purchase_invoices applies as before, and
-- replace_purchase_invoice_items keeps its own role guard.
--
-- Only the fields present in the JSON are written, as the PostgREST insert and
-- update did, so triggers declared `UPDATE OF <column>` fire for the same
-- columns as before. A key outside the editable list is an error.
--
-- Rollback: older code does not call these functions; dropping them is safe.

create or replace function public.purchase_invoice_editable_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'channel_id', 'account_id', 'cost_center_id', 'charged_employee_id',
    'supplier_id', 'kind', 'letter', 'punto_venta', 'numero', 'fecha',
    'fch_vto_pago', 'imp_neto', 'imp_iva', 'imp_trib', 'imp_no_gravado',
    'imp_op_exentas', 'imp_perc_iva', 'imp_perc_nacionales', 'imp_perc_iibb',
    'imp_perc_municipales', 'imp_impuestos_internos', 'imp_total', 'moneda',
    'cotizacion', 'cae_proveedor', 'cae_vto_proveedor', 'invoice_origin_id',
    'motivo_nc_nd', 'notes'
  ]::text[];
$$;

revoke all on function public.purchase_invoice_editable_fields() from public, anon, authenticated;
grant execute on function public.purchase_invoice_editable_fields() to authenticated, service_role;

-- Inserts the purchase (p_header: the editable fields plus created_by) and,
-- when p_items is a non-empty array, its items. Returns the new id.
create or replace function public.create_purchase_invoice(p_header jsonb, p_items jsonb default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fields text[] := public.purchase_invoice_editable_fields() || array['created_by'];
  v_cols   text;
  v_vals   text;
  v_id     uuid;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'p_header must be a jsonb object';
  end if;
  if exists (select 1 from jsonb_object_keys(p_header) k where k <> all (v_fields)) then
    raise exception 'p_header has a field that is not editable';
  end if;

  select string_agg(format('%I', f), ', '), string_agg(format('r.%I', f), ', ')
    into v_cols, v_vals
    from unnest(v_fields) f
   where p_header ? f;

  execute format(
    'insert into public.purchase_invoices (%s) select %s from jsonb_populate_record(null::public.purchase_invoices, $1) r returning id',
    v_cols, v_vals
  ) into v_id using p_header;

  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    perform public.replace_purchase_invoice_items(v_id, p_items);
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_purchase_invoice(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_purchase_invoice(jsonb, jsonb) to authenticated, service_role;

-- Writes the fields present in p_patch and, when p_items is not null, replaces
-- the items with it (an empty array removes them). Returns the id, or null
-- when the purchase does not exist or the caller cannot update it; then
-- nothing is written.
create or replace function public.update_purchase_invoice(p_id uuid, p_patch jsonb, p_items jsonb default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fields text[] := public.purchase_invoice_editable_fields();
  v_set    text;
  v_id     uuid;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a jsonb object';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_fields)) then
    raise exception 'p_patch has a field that is not editable';
  end if;

  select string_agg(format('%I = r.%I', f, f), ', ')
    into v_set
    from unnest(v_fields) f
   where p_patch ? f;

  if v_set is null then
    select id into v_id from public.purchase_invoices where id = p_id for update;
  else
    execute format(
      'update public.purchase_invoices t set %s from jsonb_populate_record(null::public.purchase_invoices, $2) r where t.id = $1 returning t.id',
      v_set
    ) into v_id using p_id, p_patch;
  end if;

  if v_id is null then
    return null;
  end if;

  if p_items is not null then
    perform public.replace_purchase_invoice_items(v_id, p_items);
  end if;

  return v_id;
end;
$$;

revoke all on function public.update_purchase_invoice(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_purchase_invoice(uuid, jsonb, jsonb) to authenticated, service_role;
