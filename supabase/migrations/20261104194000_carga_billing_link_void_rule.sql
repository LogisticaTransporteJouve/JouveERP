SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W12 · S1: a carga's invoice link follows the storage rule.
--
-- 1. One void rule (w12-s5 F1, w12-s2 F1, w12-s1 F1, w12-s2 F2).
--    billing_invoice_is_void holds the rule storage_invoice_is_void
--    (20261104190301) introduced: an invoice no longer bills what it billed
--    when it failed or was cancelled, or when it is fiscal and its emitted
--    NCs add up to its total (Σ imp_total ≥ imp_total − 0.01). An internal
--    NC can itself be cancelled later, so it never frees anything: an
--    internal remito is undone by cancelling it. storage_invoice_is_void is
--    now a wrapper, so storage keeps its callers.
--
-- 2. A carga billed alone on a fiscal factura credited in full is freed
--    (w12-s5 F1, w12-s2 F1, w12-s1 F1). Only release_invoice_billing_links
--    cleared a carga's link, on failed or cancelled, and a fiscal factura is
--    never cancelled (check_fiscal_cancel_requires_nc), so the carga read
--    billed for good while guard_billed_shipment told the user that the NC
--    frees it. Now:
--    - claim_shipment_for_invoicing, the claim of «Facturar flete», clears
--      a void link before claiming (the storage claim deletes its void runs
--      the same way) and returns the invoice it dropped, for the audit;
--    - guard_billed_shipment no longer holds a carga whose invoice is void,
--      so it can be corrected or deleted; its messages name the paths that
--      free it. It is now security definer, so the rule reads the NCs
--      whoever edits the carga;
--    - guard_shipment_invoice refuses linking a factura credited in full;
--    - billing_void_invoice_ids answers which of the given invoices are void,
--      for the cargas list («Facturar flete» shows again).
--    A carga in a live liquidación is freed only by cancelling the
--    liquidación: the claim's update still raises
--    guard_shipment_freight_settlement there.
--
-- 3. A billed carga keeps its invoice (w12-s5 F2, w12-s4 F2). RLS lets
--    operations update every column of shipments, and guard_shipment_invoice
--    let a PATCH clear or swap a live link (and guard_billed_shipment skips
--    its field check when the link changes in the same statement). Now, like
--    guard_storage_billing_run_invoice (20261104190301):
--    - a set invoice_id changes only when the old invoice is gone (the FK's
--      set null) or void (billing_invoice_is_void);
--    - only owner, admin, finance or the service role set a link.
--
-- 4. A liquidación credited by internal NCs stays (w12-s2 F2).
--    guard_freight_settlement let invoiced → cancelled through when the
--    emitted NCs of the invoice added up to its total on any channel; a
--    remito interno's NC can then be cancelled and the remito bills the
--    freed cargas again. It now uses billing_invoice_is_void.
--
-- The writers of shipments.invoice_id, latest definitions:
-- - invoiceFreightAction (owner/admin: shipments:write + invoices:issue):
--   links null → its carga's invoice with the user's client; now claims
--   through claim_shipment_for_invoicing, which clears a void link;
-- - link_freight_settlement_invoice (20261103090000, service role): links
--   null → the grouped invoice (a carga enters a liquidación only unlinked,
--   guard_freight_settlement_item);
-- - release_invoice_billing_links (20261016100000): clears the link after
--   the invoice turned failed or cancelled, which reads void;
-- - cancel_freight_settlement (20261103090000): clears its cargas' link once
--   guard_freight_settlement let the cancel through, i.e. the invoice is
--   void (failed or cancelled already released them, so only a fiscal
--   factura credited in full is left);
-- - the FK's set null on an invoice delete: the invoice is gone.
-- No seed, importer, cron or other SQL writes it. The pgTAP fixtures that
-- insert billed cargas run as the service role or as finance.
--
-- Existing rows are not touched. A carga already linked to a fiscal factura
-- credited in full is freed by its next «Facturar flete».
--
-- Rollback: older code claims with a plain update (invoice_id is null), so
-- a credited carga stays billed for it, as today; it links only after a
-- claim (null → invoice) as owner/admin, and never clears a live link. The
-- new functions are not read by it.

-- 1. The rule -------------------------------------------------------------------------

-- Null when there is no such invoice.
create function public.billing_invoice_is_void(p_invoice_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select i.status in ('failed', 'cancelled')
         or (c.is_fiscal
             and coalesce((select sum(n.imp_total)
                             from public.invoices n
                            where n.invoice_origin_id = i.id
                              and n.kind = 'nc'
                              and n.status = 'emitted'), 0) >= i.imp_total - 0.01)
    from public.invoices i
    join public.invoicing_channels c on c.id = i.channel_id
   where i.id = p_invoice_id;
$$;

comment on function public.billing_invoice_is_void(uuid) is
  'La factura ya no factura lo que facturaba (una carga, una liquidación, un período de almacenaje): falló, se anuló, o es fiscal y sus NC emitidas suman su total. Null si no existe.';

revoke all on function public.billing_invoice_is_void(uuid) from public, anon, authenticated;
-- The claims run as the signed-in user (invoker).
grant execute on function public.billing_invoice_is_void(uuid) to authenticated, service_role;

-- Same signature and grants as 20261104190301; the rule lives above.
create or replace function public.storage_invoice_is_void(p_invoice_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.billing_invoice_is_void(p_invoice_id);
$$;

comment on function public.storage_invoice_is_void(uuid) is
  'La factura de un período de almacenaje ya no lo factura (billing_invoice_is_void). Null si no existe.';

-- Invoker: RLS on invoices is the role gate (an invoice the caller cannot
-- read is left out, so it reads billed).
create function public.billing_void_invoice_ids(p_invoice_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct t.id
    from unnest(p_invoice_ids) as t(id)
   where coalesce(public.billing_invoice_is_void(t.id), false);
$$;

comment on function public.billing_void_invoice_ids(uuid[]) is
  'De las facturas dadas, las que ya no facturan lo que facturaban (billing_invoice_is_void).';

revoke all on function public.billing_void_invoice_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.billing_void_invoice_ids(uuid[]) to authenticated, service_role;

-- 2. The carga's claim ----------------------------------------------------------------

-- «Facturar flete» claims the carga before issuing. A link to a void invoice
-- is dropped first; a live link or a claim younger than 15 minutes (the TTL
-- of guard_billed_shipment) answers claimed = false. Invoker: RLS on
-- shipments (owner, admin, operations update) and on invoices is the gate.
create function public.claim_shipment_for_invoicing(p_shipment_id uuid)
returns table (claimed boolean, freed_invoice_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_claimed_at timestamptz;
begin
  select s.invoice_id, s.invoicing_claimed_at
    into v_invoice_id, v_claimed_at
    from public.shipments s
   where s.id = p_shipment_id
     for update;
  if not found then
    return query select false, null::uuid;
    return;
  end if;

  if v_invoice_id is not null then
    if not coalesce(public.billing_invoice_is_void(v_invoice_id), false) then
      return query select false, null::uuid;
      return;
    end if;
  elsif v_claimed_at > now() - interval '15 minutes' then
    return query select false, null::uuid;
    return;
  end if;

  update public.shipments
     set invoice_id = null,
         invoicing_claimed_at = now()
   where id = p_shipment_id;

  return query select true, v_invoice_id;
end;
$$;

comment on function public.claim_shipment_for_invoicing(uuid) is
  'Reserva la carga para «Facturar flete». Si su factura ya no la factura (billing_invoice_is_void), la desvincula antes y la devuelve en freed_invoice_id.';

revoke all on function public.claim_shipment_for_invoicing(uuid) from public, anon, authenticated;
grant execute on function public.claim_shipment_for_invoicing(uuid) to authenticated;

-- 3. The billed-carga guard -----------------------------------------------------------

-- Same as 20261031200412, with the void rule, true messages and security
-- definer (the rule reads the invoice's NCs whoever edits the carga).
create or replace function public.guard_billed_shipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_billed boolean := (old.invoice_id is not null
      and not coalesce(public.billing_invoice_is_void(old.invoice_id), false))
    or coalesce(old.invoicing_claimed_at > now() - interval '15 minutes', false);
begin
  if not v_billed then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'La carga ya está facturada: para borrarla, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.invoice_id is not distinct from old.invoice_id
     and (new.client_id is distinct from old.client_id
       or new.channel_id is distinct from old.channel_id
       or new.freight_amount is distinct from old.freight_amount
       or new.origin is distinct from old.origin
       or new.destination is distinct from old.destination) then
    raise exception 'La carga ya está facturada: para cambiar cliente, canal, ruta o flete, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_billed_shipment() from public, anon, authenticated;

-- 4. The link guard -------------------------------------------------------------------

-- Same as 20261104190300, plus: a live link stays, only the billing roles
-- set one, and a factura credited in full is not linked.
create or replace function public.guard_shipment_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_status    text;
begin
  if tg_op = 'UPDATE'
     and old.invoice_id is not null
     and new.invoice_id is distinct from old.invoice_id
     and not coalesce(public.billing_invoice_is_void(old.invoice_id), true) then
    raise exception 'La carga ya tiene su factura: no se desvincula ni se cambia mientras esa factura esté vigente.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.invoice_id is null
     or (tg_op = 'UPDATE' and new.invoice_id is not distinct from old.invoice_id) then
    return new;
  end if;

  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Solo administración o finanzas vinculan la factura de una carga.'
      using errcode = '42501', hint = 'jouve_guard';
  end if;

  select i.client_id, i.status::text
    into v_client_id, v_status
    from public.invoices i
   where i.id = new.invoice_id
     for share;
  if not found then
    -- The foreign key refuses it.
    return new;
  end if;
  if v_client_id is distinct from new.client_id then
    raise exception 'La factura no es del cliente de la carga.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_status in ('failed', 'cancelled') then
    raise exception 'La factura del flete falló o se anuló: volvé a facturar la carga.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if public.billing_invoice_is_void(new.invoice_id) then
    raise exception 'La factura del flete tiene notas de crédito por el total: volvé a facturar la carga.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_shipment_invoice() from public, anon, authenticated;

-- 5. The liquidación guard ------------------------------------------------------------

-- Same as 20261104030000, with billing_invoice_is_void for invoiced →
-- cancelled (internal NCs no longer count) and a message that names the
-- paths.
create or replace function public.guard_freight_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Una liquidación confirmada no se borra: cancelala.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if old.status = 'cancelled' then
    raise exception 'La liquidación está cancelada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.client_id is distinct from old.client_id then
    raise exception 'El cliente de una liquidación no cambia: cancelala y armá otra.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.status <> 'draft'
     and (new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.total is distinct from old.total
       or new.numero is distinct from old.numero
       or new.channel is distinct from old.channel
       or new.remito_pos is distinct from old.remito_pos
       or new.remito_number is distinct from old.remito_number) then
    raise exception 'La liquidación ya está confirmada: no se pueden cambiar su período, sus cargas, su total ni su número.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.status = 'invoiced' and new.status = 'invoiced'
     and new.invoice_id is distinct from old.invoice_id then
    raise exception 'La liquidación ya tiene su factura.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if (old.status = 'draft' and new.status in ('confirmed', 'cancelled'))
     or (old.status = 'confirmed' and new.status in ('invoiced', 'cancelled'))
     or (old.status = 'invoiced' and new.status = 'confirmed' and new.invoice_id is null) then
    return new;
  end if;

  if old.status = 'invoiced' and new.status = 'cancelled' then
    if coalesce(public.billing_invoice_is_void(old.invoice_id), false) then
      return new;
    end if;
    raise exception 'La liquidación está facturada: antes de cancelarla, anulá el remito si es interno, o emití una nota de crédito por el total si la factura es fiscal.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  raise exception 'Una liquidación % no pasa a %.', old.status, new.status
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_freight_settlement() from public, anon, authenticated;
