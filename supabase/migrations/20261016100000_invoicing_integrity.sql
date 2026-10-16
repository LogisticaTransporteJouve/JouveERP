-- Invoicing integrity: writes only through the issue workflow, idempotent and
-- atomic numbering for internal and CAEA vouchers, links released when an
-- invoice fails or is cancelled, and NCs counted against their origin in
-- aging and receipt allocations.

set row_security = off;
set lock_timeout = '5s';

------------------------------------------------------------------------------
-- 1. invoices / invoice_items are written only by the service role.
------------------------------------------------------------------------------
-- Every write goes through issueFiscalInvoiceAction and the issue-invoice
-- function (service role). The authenticated INSERT/UPDATE policies let a
-- finance session POST an `emitted` fiscal invoice with any CAE straight to
-- PostgREST: it skipped AFIP and still posted its journal entry and showed up
-- in the libro IVA. Reads keep their existing policies.

drop policy if exists "Authenticated finance can insert invoices" on public.invoices;
drop policy if exists "Authenticated finance can update invoices" on public.invoices;
drop policy if exists "Authenticated finance can insert invoice items" on public.invoice_items;
drop policy if exists "Authenticated finance can update invoice items" on public.invoice_items;
drop policy if exists "Authenticated finance can delete invoice items" on public.invoice_items;

revoke insert, update, delete on public.invoices from anon, authenticated;
revoke insert, update, delete on public.invoice_items from anon, authenticated;

------------------------------------------------------------------------------
-- 2. Internal numbering: idempotent per invoice.
------------------------------------------------------------------------------
-- The issue-invoice step that calls this re-runs from scratch when its result
-- is lost after the commit. Returning the number the invoice already holds
-- keeps the retry from renumbering it to max + 1 and leaving a gap.

create or replace function public.next_internal_invoice_numero_atomic(
  p_invoice_id uuid,
  p_channel_id text,
  p_punto_venta int,
  p_kind text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next     int;
  v_existing int;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_channel_id || '|' || p_punto_venta::text || '|' || p_kind, 0)
  );

  select numero into v_existing
    from public.invoices
   where id = p_invoice_id
     and channel_id = p_channel_id
     and punto_venta = p_punto_venta
     and kind = p_kind
     for update;
  if not found then
    raise exception 'invoice % does not match channel %, punto de venta %, kind %',
      p_invoice_id, p_channel_id, p_punto_venta, p_kind
      using errcode = '22023';
  end if;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(max(numero), 0) + 1
    into v_next
    from public.invoices
   where channel_id = p_channel_id
     and punto_venta = p_punto_venta
     and kind = p_kind;

  update public.invoices
     set numero = v_next
   where id = p_invoice_id;

  return v_next;
end;
$$;

------------------------------------------------------------------------------
-- 3. CAEA numbering: atomic per (punto de venta, comprobante type).
------------------------------------------------------------------------------
-- A CAEA voucher is numbered locally (AFIP learns it only when informed):
-- greatest(local max, AFIP's last informed number) + 1, written to the invoice
-- in the same transaction under an advisory lock so two contingency emissions
-- on one punto de venta never pick the same number. Idempotent like the
-- internal one.

create or replace function public.reserve_caea_invoice_numero(
  p_invoice_id uuid,
  p_afip_last int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pv       int;
  v_tipo     int;
  v_existing int;
  v_next     int;
begin
  select punto_venta, cbte_tipo_afip into v_pv, v_tipo
    from public.invoices
   where id = p_invoice_id;
  if not found or v_tipo is null then
    raise exception 'invoice % is not a fiscal voucher', p_invoice_id
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('caea|' || v_pv::text || '|' || v_tipo::text, 0)
  );

  select numero into v_existing
    from public.invoices
   where id = p_invoice_id
     for update;
  if v_existing is not null then
    return v_existing;
  end if;

  select greatest(coalesce(max(numero), 0), coalesce(p_afip_last, 0)) + 1
    into v_next
    from public.invoices
   where punto_venta = v_pv
     and cbte_tipo_afip = v_tipo;

  update public.invoices
     set numero = v_next
   where id = p_invoice_id;

  return v_next;
end;
$$;

comment on function public.reserve_caea_invoice_numero(uuid, int) is
  'Assigns the next CAEA number on the invoice''s (punto de venta, cbte tipo): greatest(local max, AFIP last) + 1, under an advisory lock. Returns the existing number on a retry.';

revoke all on function public.reserve_caea_invoice_numero(uuid, int) from public, anon, authenticated;
grant execute on function public.reserve_caea_invoice_numero(uuid, int) to service_role;

------------------------------------------------------------------------------
-- 4. A failed or cancelled invoice releases what it billed.
------------------------------------------------------------------------------
-- Freight (shipments.invoice_id) and storage periods (storage_billing_runs)
-- are linked to their invoice when it is queued. When the emission fails
-- (AFIP rejection) or an internal invoice is cancelled, the link is cleared so
-- the shipment or period can be billed again.

create or replace function public.release_invoice_billing_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shipments
     set invoice_id = null
   where invoice_id = new.id;

  delete from public.storage_billing_runs
   where invoice_id = new.id;

  return new;
end;
$$;

revoke all on function public.release_invoice_billing_links() from public, anon, authenticated;

drop trigger if exists invoices_release_billing_links on public.invoices;
create trigger invoices_release_billing_links
  after update of status on public.invoices
  for each row
  when (old.status is distinct from new.status
        and new.status in ('failed', 'cancelled'))
  execute function public.release_invoice_billing_links();

create index if not exists storage_billing_runs_invoice_idx
  on public.storage_billing_runs (invoice_id)
  where invoice_id is not null;

------------------------------------------------------------------------------
-- 5. Aging: an emitted NC reduces what its origin still owes.
------------------------------------------------------------------------------

create or replace view public.v_aging_documents with (security_invoker = on) as
  SELECT c.id AS invoice_id,
    c.client_id,
    c.fecha,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    c.imp_total,
    COALESCE(alloc.applied, 0::numeric) + COALESCE(opening.applied, 0::numeric) AS amount_applied,
    c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric) AS open_amount,
    CURRENT_DATE - c.fecha AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - c.fecha) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - c.fecha) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - c.fecha) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    c.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    c.fch_vto_pago AS fch_vto_pago,
    c.moneda AS moneda,
    COALESCE(nc.credited, 0::numeric) AS amount_credited_by_nc
   FROM invoices c
     JOIN invoicing_channels ch ON ch.id = c.channel_id
     LEFT JOIN ( SELECT ra.invoice_id,
            sum(ra.amount_applied) AS applied
           FROM receipt_allocations ra
             JOIN receipts r ON r.id = ra.receipt_id
          WHERE r.status = 'issued'::text
          GROUP BY ra.invoice_id) alloc ON alloc.invoice_id = c.id
     LEFT JOIN ( SELECT client_opening_balance_allocations.invoice_id,
            client_opening_balance_allocations.amount_applied AS applied
           FROM client_opening_balance_allocations) opening ON opening.invoice_id = c.id
     LEFT JOIN ( SELECT n.invoice_origin_id,
            sum(n.imp_total) AS credited
           FROM invoices n
          WHERE n.kind = 'nc'::text AND n.status = 'emitted'::text AND n.invoice_origin_id IS NOT NULL
          GROUP BY n.invoice_origin_id) nc ON nc.invoice_origin_id = c.id
  WHERE c.status = 'emitted'::text AND (c.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND (c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric)) > 0::numeric;

------------------------------------------------------------------------------
-- 6. Receipt allocations: only to emitted facturas / NDs, within what is
--    left after receipts and NCs.
------------------------------------------------------------------------------

create or replace function public.guard_receipt_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client   uuid;
  v_total    numeric;
  v_status   text;
  v_kind     text;
  v_receipt_client uuid;
  v_sum      numeric;
  v_credited numeric;
begin
  select client_id, imp_total, status, kind
    into v_client, v_total, v_status, v_kind
    from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'Comprobante % no existe', new.invoice_id using errcode = '23503';
  end if;
  if v_status <> 'emitted' or v_kind not in ('factura', 'nd') then
    raise exception 'Solo se pueden imputar facturas y notas de débito emitidas'
      using errcode = '23514';
  end if;

  select client_id into v_receipt_client from public.receipts where id = new.receipt_id;
  if v_receipt_client is distinct from v_client then
    raise exception 'El comprobante no pertenece al cliente del recibo'
      using errcode = '23514';
  end if;

  select coalesce(sum(ra.amount_applied), 0) into v_sum
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
   where ra.invoice_id = new.invoice_id
     and ra.id <> new.id
     and r.status <> 'canceled';

  select coalesce(sum(n.imp_total), 0) into v_credited
    from public.invoices n
   where n.invoice_origin_id = new.invoice_id
     and n.kind = 'nc'
     and n.status = 'emitted';

  if v_sum + v_credited + new.amount_applied > v_total + 0.01 then
    raise exception 'La imputación excede el saldo del comprobante (% + % + % > %)',
      v_sum, v_credited, new.amount_applied, v_total using errcode = '23514';
  end if;

  return new;
end;
$$;

set row_security = on;
