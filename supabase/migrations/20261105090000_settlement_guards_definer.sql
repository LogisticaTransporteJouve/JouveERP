SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W13 · S2 F1: the liquidación and rendición guards on cargas and
-- trips bind whoever edits them.
--
-- guard_shipment_freight_settlement, guard_shipment_driver_settlement and
-- guard_trip_driver_settlement were security invoker. They look up the
-- carga's live liquidación or rendición in freight_settlement_items /
-- freight_settlements and driver_settlement_items / driver_settlements,
-- which only owner, admin and finance can read. Operations, the role that
-- edits cargas and trips (RLS lets it update shipments and trips), found
-- nothing, so the guards let it change the client, status, flete or cobranza
-- of a carga in a live liquidación or rendición, or the driver of its trip.
-- They are now security definer, as guard_billed_shipment already is
-- (20261104194000), so the rule reads the settlements whoever edits.
--
-- Bodies unchanged from their latest definitions:
-- - guard_shipment_freight_settlement: 20261104030000;
-- - guard_shipment_driver_settlement, guard_trip_driver_settlement:
--   20261103090100.
-- They are trigger functions: nothing calls them directly, so the grants stay
-- revoked from public, anon and authenticated. The triggers keep pointing at
-- them (create or replace keeps the function).
--
-- Who writes shipments and trips, and still passes:
-- - owner and admin (they already saw the settlements: same answers);
-- - operations: now refused on a carga in a live liquidación or rendición,
--   as the guards' messages say; any other carga or trip is unchanged;
-- - the settlement RPCs (security definer, service role): they already ran
--   as the owner and saw every row;
-- - «Facturar flete»'s claim (claim_shipment_for_invoicing, owner/admin):
--   the claim on a carga in a live liquidación already raised for them.
--
-- Rollback: older code issues the same writes; operations' edits of a carga
-- in a live liquidación or rendición are refused with the guard's message
-- (mapped by mapDbGuardError, hint jouve_guard), as owner's already were.

create or replace function public.guard_shipment_freight_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
begin
  select fs.id, fs.status, fs.invoice_id,
         case when fs.status = 'draft' then 'una liquidación en borrador'
              else public.freight_settlement_label(fs.numero, fs.remito_pos, fs.remito_number) end as label
    into v_s
    from public.freight_settlement_items i
    join public.freight_settlements fs on fs.id = i.settlement_id
   where i.shipment_id = old.id
     and not i.released
   limit 1;
  if not found then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'La carga está en %: sacala o cancelá la liquidación antes de borrarla.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- The liquidación links its grouped invoice and stamps the billed flete.
  if new.invoice_id is distinct from old.invoice_id
     and new.invoice_id is not null
     and new.invoice_id is not distinct from v_s.invoice_id then
    return new;
  end if;

  if (new.invoicing_claimed_at is not null
      and new.invoicing_claimed_at is distinct from old.invoicing_claimed_at)
     or (new.invoice_id is not null
      and new.invoice_id is distinct from old.invoice_id) then
    raise exception 'La carga está en %: se factura desde la liquidación.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.client_id is distinct from old.client_id
     or new.status is distinct from old.status then
    raise exception 'La carga está en %: sacala o cancelá la liquidación para cambiar su cliente o su estado.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_s.status <> 'draft'
     and new.freight_amount is distinct from old.freight_amount then
    raise exception 'La carga está en %, ya confirmada: su flete no cambia.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_shipment_freight_settlement() from public, anon, authenticated;

create or replace function public.guard_shipment_driver_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  select case when ds.numero is null then 'una rendición en borrador'
              else 'la rendición N° ' || ds.numero end
    into v_label
    from public.driver_settlement_items i
    join public.driver_settlements ds on ds.id = i.settlement_id
   where i.shipment_id = old.id
     and not i.released
   limit 1;
  if not found then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'La carga está en %: sacala o cancelá la rendición antes de borrarla.', v_label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.cod_amount is distinct from old.cod_amount
     or new.client_id is distinct from old.client_id
     or new.trip_id is distinct from old.trip_id
     or new.status is distinct from old.status then
    raise exception 'La carga está en %: sacala o cancelá la rendición para cambiar su cobranza, cliente, viaje o estado.', v_label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_shipment_driver_settlement() from public, anon, authenticated;

create or replace function public.guard_trip_driver_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.driver_id is distinct from old.driver_id
     and exists (
       select 1
         from public.shipments s
         join public.driver_settlement_items i
           on i.shipment_id = s.id and not i.released
        where s.trip_id = old.id
     ) then
    raise exception 'El viaje tiene cargas en una rendición: cancelala antes de cambiar el chofer.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_trip_driver_settlement() from public, anon, authenticated;
