SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Audit w9-s5 F2 / w9-s1 F2: the ARCA issued import (lib/afip/sync-issued.ts)
-- wrote the invoice header and its per-alícuota items in two commits. A step
-- killed between them, or an items insert that failed once, left the voucher
-- header-only for good: the next batch resumes past it and a duplicate never
-- got items. Now the header and its items go in one transaction.
--
-- Same contract as the upsert it replaces: on an idempotency_key already
-- imported it inserts nothing and returns null (the caller counts it as
-- imported); a clash on another unique key raises 23505 as before. Items are
-- written only for the row this call inserted. The caller validates the ARCA
-- breakdown (known rates, no negatives, sums tie to the cent) and sends no
-- items when it does not; the function re-checks the sums so a breakdown that
-- does not tie can never land. Existing rows are not touched.

create or replace function public.import_arca_issued_invoice(
  p_invoice jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_neto  numeric;
  v_iva   numeric;
  v_bad   boolean;
begin
  if coalesce(p_invoice ->> 'idempotency_key', '') not like 'arca-sync-%' then
    raise exception 'import_arca_issued_invoice only imports ARCA vouchers'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'p_items must be a json array' using errcode = '22023';
  end if;

  insert into public.invoices (
    channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
    doc_tipo, doc_nro, iva_condition_receptor, cbte_tipo_afip,
    cbte_tipo_origen_afip, invoice_origin_id, origin_unlinked,
    imp_neto, imp_iva, imp_trib, imp_op_ex, imp_tot_conc, imp_total,
    moneda, cotizacion, fch_serv_desde, fch_serv_hasta, fch_vto_pago,
    cae, cae_vencimiento, emission_type, status, emitted_at, idempotency_key
  )
  select
    r.channel_id, r.client_id, r.kind, r.letter, r.punto_venta, r.numero, r.fecha, r.concepto,
    r.doc_tipo, r.doc_nro, r.iva_condition_receptor, r.cbte_tipo_afip,
    r.cbte_tipo_origen_afip, r.invoice_origin_id, r.origin_unlinked,
    r.imp_neto, r.imp_iva, r.imp_trib, r.imp_op_ex, r.imp_tot_conc, r.imp_total,
    r.moneda, r.cotizacion, r.fch_serv_desde, r.fch_serv_hasta, r.fch_vto_pago,
    r.cae, r.cae_vencimiento, r.emission_type, r.status, r.emitted_at, r.idempotency_key
  from jsonb_populate_record(null::public.invoices, p_invoice) r
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null or jsonb_array_length(v_items) = 0 then
    return v_id;
  end if;

  insert into public.invoice_items (
    invoice_id, sort_order, description, quantity, unit_price, iva_rate_id,
    line_neto, line_iva, line_total
  )
  select
    v_id, i.sort_order, i.description, i.quantity, i.unit_price, i.iva_rate_id,
    i.line_neto, i.line_iva, i.line_total
  from jsonb_populate_recordset(null::public.invoice_items, v_items) i;

  select coalesce(sum(it.line_neto), 0), coalesce(sum(it.line_iva), 0),
         bool_or(it.iva_rate_id is null or it.line_neto < 0 or it.line_iva < 0
                 or it.line_total <> it.line_neto + it.line_iva)
    into v_neto, v_iva, v_bad
    from public.invoice_items it
   where it.invoice_id = v_id;

  if v_bad or exists (
    select 1 from public.invoices inv
     where inv.id = v_id
       and (inv.imp_neto <> v_neto or inv.imp_iva <> v_iva)
  ) then
    raise exception 'ARCA breakdown of % does not tie to its header', p_invoice ->> 'idempotency_key'
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

comment on function public.import_arca_issued_invoice(jsonb, jsonb) is
  'ARCA issued import: inserts one emitted voucher and its per-alícuota items in one transaction. Returns null, inserting nothing, when its idempotency_key is already imported.';

revoke all on function public.import_arca_issued_invoice(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_arca_issued_invoice(jsonb, jsonb) to service_role;
