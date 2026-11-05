SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W16 · S1 F1 / S3 F1: the void rule and the carga's share walk
-- the whole chain of notes under the factura, not only its first level.
--
-- The usual way to undo a wrong NC is an ND whose CbtesAsoc is that NC (an
-- authorized NC cannot be cancelled). The ARCA sync stores it with
-- invoice_origin_id = the NC (lib/afip/sync-issued.ts resolves CbtesAsoc of
-- any tipo). 20261105120100 netted each ND by its own NCs but read each NC
-- at face value, so factura 100 → NC 100 → ND 100 on that NC read void: the
-- carga was freed and billed a second time while the ND still billed it.
--
-- 1. billing_invoice_live_amount (new, invoker): what a comprobante still
--    bills (a factura or an ND) or credits (an NC) after its chain of
--    emitted notes. Per comprobante, greatest(0, its total + what its
--    notes on the same side still do − what its notes on the other side
--    still do), bottom-up, so each branch is floored at 0 as 120100
--    floored each ND. NDs are the factura's side, NCs the other. An interest
--    ND (late_interest_charges, linked or keyed on the charge) stays out
--    with its whole branch, as before. Walked with a recursive CTE, at most
--    10 notes deep and never through a comprobante twice; notes deeper than
--    that are not read. Replaces billing_invoice_live_debits, which only
--    callers below read: it is dropped.
-- 2. billing_invoice_is_void: a fiscal factura is void when what it still
--    bills is at most 0.01. With notes one level deep (and NDs' own NCs) this
--    is 120100's NC(F) >= total + live NDs − 0.01, so only chains deeper than
--    that change answer. Same signature, invoker and grants.
-- 3. shipment_invoice_billed_ratio: what the factura still bills / its
--    total; 0 when void, 1 for the internal channel or a total <= 0, as
--    before. Same signature, definer, role gate and grants.
--
-- Callers of the rule (latest definitions), none changed here:
-- - shipments: claim_shipment_for_invoicing, guard_billed_shipment,
--   guard_shipment_invoice, billing_void_invoice_ids (20261104194000),
--   shipment_invoice_is_void (20261105090001, no reader left) and the share
--   (v_trip_revenue, ai_fleet_margin, ai_shipments_summary in
--   20261105100001, get_vehicle_margin through v_trip_revenue);
-- - liquidaciones: guard_freight_settlement (invoiced → cancelled);
-- - storage: storage_invoice_is_void (wrapper) under
--   storage_billing_void_run_ids, claim_storage_billing_period(_with_relinks)
--   (20261104194001), guard_storage_billing_run_delete and
--   guard_storage_billing_run_invoice (20261104190301);
-- - the app: lib/source-invoice-key.ts (next attempt of a source's invoice).
-- An ND on an NC of the factura now keeps the link (the side that keeps it);
-- an NC on an ND on an NC frees it again, as the chain says.
--
-- Existing rows are not touched. Production (94f942b) holds no freight NCs
-- or NDs; the control query of this migration's item in
-- docs/pendientes/antes-de-promover.md lists the facturas whose answer
-- changes.
--
-- Rollback: older code calls billing_invoice_is_void and
-- shipment_invoice_billed_ratio by name with the same arguments and reads
-- the new answers. No app code calls billing_invoice_live_debits.

-- 1. What a comprobante still bills after its notes ----------------------------------

create function public.billing_invoice_live_amount(p_invoice_id uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_row record;
  v_amount numeric;
  -- Per comprobante of the chain, what its notes still do to it, signed.
  v_notes jsonb := '{}'::jsonb;
begin
  for v_row in
    with recursive chain (id, origin_id, is_credit, origin_is_credit, imp_total, depth, path) as (
      select i.id, null::uuid, i.kind = 'nc', null::boolean, i.imp_total, 0, array[i.id]
        from public.invoices i
       where i.id = p_invoice_id
      union all
      select n.id, ch.id, n.kind = 'nc', ch.is_credit, n.imp_total, ch.depth + 1, ch.path || n.id
        from chain ch
        join public.invoices n on n.invoice_origin_id = ch.id
       where ch.depth < 10
         and n.kind in ('nc', 'nd')
         and n.status = 'emitted'
         and n.id <> all (ch.path)
         and not (n.kind = 'nd' and exists (
               select 1 from public.late_interest_charges lc
                where lc.nd_invoice_id = n.id
                   or lc.id::text = n.idempotency_key))
    )
    select c.id, c.origin_id, c.is_credit, c.origin_is_credit, c.imp_total
      from chain c
     order by c.depth desc
  loop
    -- Deepest first: every note of this comprobante is already in v_notes.
    v_amount := greatest(0::numeric,
      v_row.imp_total + coalesce((v_notes ->> v_row.id::text)::numeric, 0));
    if v_row.origin_id is null then
      return v_amount;
    end if;
    v_notes := jsonb_set(v_notes, array[v_row.origin_id::text], to_jsonb(
      coalesce((v_notes ->> v_row.origin_id::text)::numeric, 0)
      + case when v_row.is_credit = v_row.origin_is_credit then v_amount else -v_amount end));
  end loop;
  return null;
end;
$$;

comment on function public.billing_invoice_live_amount(uuid) is
  'Lo que el comprobante todavía factura (factura o ND) o acredita (NC) después de su cadena de notas emitidas: su total, más lo que todavía hacen sus notas del mismo lado, menos lo de sus notas del otro lado, mínimo 0 por comprobante. Sin las ND de intereses por mora ni sus notas; hasta 10 notas de profundidad. Null si no existe.';

revoke all on function public.billing_invoice_live_amount(uuid) from public, anon, authenticated;
-- Read by billing_invoice_is_void, which runs as the signed-in user.
grant execute on function public.billing_invoice_live_amount(uuid) to authenticated, service_role;

-- 2. The void rule ---------------------------------------------------------------------

-- Same as 20261105120100, with the whole chain of notes.
create or replace function public.billing_invoice_is_void(p_invoice_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select i.status in ('failed', 'cancelled')
         or (c.is_fiscal and public.billing_invoice_live_amount(i.id) <= 0.01)
    from public.invoices i
    join public.invoicing_channels c on c.id = i.channel_id
   where i.id = p_invoice_id;
$$;

comment on function public.billing_invoice_is_void(uuid) is
  'La factura ya no factura lo que facturaba (una carga, una liquidación, un período de almacenaje): falló, se anuló, o es fiscal y lo que todavía factura después de toda su cadena de NC y ND emitidas (billing_invoice_live_amount) es 0,01 o menos. Null si no existe.';

-- 3. The carga's share -----------------------------------------------------------------

-- Same as 20261105120100, with the whole chain of notes.
create or replace function public.shipment_invoice_billed_ratio(p_shipment_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when public.billing_invoice_is_void(i.id) then 0::numeric
           when not c.is_fiscal or i.imp_total <= 0 then 1::numeric
           else public.billing_invoice_live_amount(i.id) / i.imp_total
         end
    from public.shipments s
    join public.invoices i on i.id = s.invoice_id
    join public.invoicing_channels c on c.id = i.channel_id
   where s.id = p_shipment_id
     and (coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          or public.user_has_role(array['owner', 'admin', 'operations']));
$$;

comment on function public.shipment_invoice_billed_ratio(uuid) is
  'Parte del flete de la carga que su factura todavía factura: lo que factura después de toda su cadena de NC y ND emitidas (billing_invoice_live_amount) / su total. 0 si la factura ya no la factura (billing_invoice_is_void). Solo cuentan las notas de una factura fiscal, sin las ND de intereses por mora. Para quien lee cargas (owner, admin, operations) o el service role. Null si la carga no tiene factura. SECURITY DEFINER.';

-- create or replace keeps the grants; restated as in 20261105120100.
revoke all on function public.shipment_invoice_billed_ratio(uuid) from public, anon, authenticated;
grant execute on function public.shipment_invoice_billed_ratio(uuid) to authenticated, service_role;

-- 4. The first-level helper, now unread ------------------------------------------------

-- Only the two functions above read it, and no app code calls it, so code
-- rolled back past this migration loses nothing.
-- squawk-ignore ban-drop-function
drop function public.billing_invoice_live_debits(uuid);
