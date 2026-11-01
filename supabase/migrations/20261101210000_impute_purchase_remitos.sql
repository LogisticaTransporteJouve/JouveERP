SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Imputing remitos internos de compra to a fiscal purchase factura
-- (docs/otras-ventas.md §6). When a supplier later bills what it delivered on
-- remitos internos, each remito is credited with a nota de crédito interna de
-- compra linked to the factura, and its internal payment orders pass to the
-- fiscal side applied to the factura, so the purchase is counted once:
--   * purchase_invoices.imputed_to_id: on that NC, the factura it was imputed to;
--   * purchase_remito_blocker: what keeps a remito from being imputed;
--   * guard_purchase_remito_frozen_*: while the NC is live the remito takes no
--     payment, ajuste or NC/ND, keeps its amounts and cannot be anulado; the NC
--     itself cannot be changed. Only impute_purchase_remitos and the factura's
--     cancellation (which cancels its NCs) write them, marking their
--     transaction;
--   * impute_purchase_remitos: one transaction that moves the payment orders
--     and creates the NCs.

-- 1. The link -----------------------------------------------------------------

alter table public.purchase_invoices
  add column imputed_to_id uuid;

alter table public.purchase_invoices
  add constraint purchase_invoices_imputed_to_id_fkey
  foreign key (imputed_to_id) references public.purchase_invoices(id)
  on delete restrict not valid;

-- The column is new and all null: validating scans nothing to fail.
-- squawk-ignore constraint-missing-not-valid
alter table public.purchase_invoices validate constraint purchase_invoices_imputed_to_id_fkey;

-- squawk-ignore require-concurrent-index-creation
create index purchase_invoices_imputed_to_idx
  on public.purchase_invoices (imputed_to_id)
  where imputed_to_id is not null;

-- The live factura a remito is imputed to, or null.
create or replace function public.purchase_remito_imputed_to(p_remito_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select n.imputed_to_id
  from public.purchase_invoices n
  where n.invoice_origin_id = p_remito_id
    and n.imputed_to_id is not null
    and n.status = 'received'
  limit 1;
$$;

revoke all on function public.purchase_remito_imputed_to(uuid) from public, anon, authenticated;

-- 2. What keeps a remito from being imputed ------------------------------------

-- A payment order moves whole to the fiscal side, so only one that pays this
-- remito alone, in pesos, without cheques, in an open accounting period.
create or replace function public.purchase_remito_blocker(p_remito_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with ops as (
    select po.id, po.currency, po.payment_date, po.total_amount, poa.amount_applied
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
    where poa.purchase_invoice_id = p_remito_id and po.status = 'issued'
  )
  select case
    when exists (
      select 1 from public.purchase_invoices n
      where n.invoice_origin_id = p_remito_id
        and n.kind in ('nc', 'nd')
        and n.status = 'received'
    ) then 'El remito ya tiene notas de crédito o débito: no se puede imputar.'
    when exists (
      select 1 from public.supplier_opening_balance_allocations soba
      where soba.purchase_invoice_id = p_remito_id
    ) then 'El remito está saldado en parte por el saldo inicial del proveedor: no se puede imputar.'
    when exists (
      select 1 from public.purchase_invoices r
      where r.id = p_remito_id and r.moneda <> 'PES'
    ) or exists (select 1 from ops where currency <> 'ARS')
      then 'El remito o su pago está en otra moneda: no se puede imputar.'
    when exists (
      select 1 from ops o
      where exists (
        select 1 from public.payment_order_allocations poa2
        where poa2.payment_order_id = o.id
          and poa2.purchase_invoice_id <> p_remito_id
      )
    ) then 'Una orden de pago de este remito también paga otros comprobantes: anulala, imputá el remito y cargá el pago en Compras.'
    when exists (select 1 from ops where total_amount <> amount_applied)
      then 'Una orden de pago de este remito tiene saldo a cuenta: anulala, imputá el remito y cargá el pago en Compras.'
    when exists (
      select 1 from public.payment_order_payment_lines l
      join ops o on o.id = l.payment_order_id
      where l.endorsed_check_id is not null or l.issued_check_id is not null
    ) then 'El remito se pagó con cheques: anulá esa orden de pago, imputá el remito y cargá el pago en Compras.'
    when exists (
      select 1 from ops o
      join public.accounting_closed_periods p
        on p.period = to_char(o.payment_date, 'YYYY-MM')
    ) then 'El remito se pagó en un período contable cerrado: no se puede pasar el pago a Compras.'
  end;
$$;

revoke all on function public.purchase_remito_blocker(uuid) from public, anon, authenticated;
grant execute on function public.purchase_remito_blocker(uuid) to service_role;

-- The blocker of each remito a picker lists.
create or replace function public.purchase_remito_blockers(p_remito_ids uuid[])
returns table (remito_id uuid, blocker text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, public.purchase_remito_blocker(r.id)
  from unnest(p_remito_ids) as r(id);
$$;

revoke all on function public.purchase_remito_blockers(uuid[]) from public, anon, authenticated;
grant execute on function public.purchase_remito_blockers(uuid[]) to service_role;

-- 3. An imputed remito is frozen ----------------------------------------------

create or replace function public.guard_purchase_remito_frozen_alloc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.purchase_remito_imputed_to(new.purchase_invoice_id) is not null then
    raise exception 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_remito_frozen_alloc() from public, anon, authenticated;

create trigger payment_order_allocations_remito_frozen
  before insert or update of purchase_invoice_id on public.payment_order_allocations
  for each row execute function public.guard_purchase_remito_frozen_alloc();

create trigger supplier_opening_allocations_remito_frozen
  before insert or update of purchase_invoice_id on public.supplier_opening_balance_allocations
  for each row execute function public.guard_purchase_remito_frozen_alloc();

create or replace function public.guard_purchase_remito_frozen_doc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- impute_purchase_remitos and the factura's cancellation.
  if current_setting('jouve.imputing_purchase', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.imputed_to_id is not null then
      raise exception 'Solo la imputación de remitos vincula una nota de crédito a una factura.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if new.invoice_origin_id is not null then
      if public.purchase_remito_imputed_to(new.invoice_origin_id) is not null then
        raise exception 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if new.imputed_to_id is distinct from old.imputed_to_id then
    raise exception 'Solo la imputación de remitos vincula una nota de crédito a una factura.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- A factura keeps room for the remitos imputed to it.
  if new.imp_total < old.imp_total
     and new.imp_total + 0.01 < coalesce((
       select sum(n.imp_total)
       from public.purchase_invoices n
       where n.imputed_to_id = new.id and n.status = 'received'
     ), 0) then
    raise exception 'La factura tiene remitos imputados por más que ese total.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if old.imputed_to_id is not null and old.status = 'received'
     and (new.status, new.kind, new.channel_id, new.supplier_id,
          new.invoice_origin_id, new.imp_neto, new.imp_iva, new.imp_trib,
          new.imp_total, new.moneda, new.cotizacion)
         is distinct from
         (old.status, old.kind, old.channel_id, old.supplier_id,
          old.invoice_origin_id, old.imp_neto, old.imp_iva, old.imp_trib,
          old.imp_total, old.moneda, old.cotizacion) then
    raise exception 'Esta nota de crédito acredita un remito imputado a una factura de Compras: no se puede cambiar ni anular mientras la factura esté vigente.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if old.status = 'received'
     and public.purchase_remito_imputed_to(old.id) is not null
     and (new.status, new.kind, new.channel_id, new.supplier_id,
          new.imp_neto, new.imp_iva, new.imp_trib, new.imp_total,
          new.moneda, new.cotizacion)
         is distinct from
         (old.status, old.kind, old.channel_id, old.supplier_id,
          old.imp_neto, old.imp_iva, old.imp_trib, old.imp_total,
          old.moneda, old.cotizacion) then
    raise exception 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if new.invoice_origin_id is distinct from old.invoice_origin_id
     and new.invoice_origin_id is not null then
    if public.purchase_remito_imputed_to(new.invoice_origin_id) is not null then
      raise exception 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_purchase_remito_frozen_doc() from public, anon, authenticated;

-- Named to fire before purchase_invoices_cancel_guard, whose "anulá esas
-- notas" does not apply to an imputation NC.
create trigger purchase_invoices_aa_imputed_remito_frozen
  before insert or update on public.purchase_invoices
  for each row execute function public.guard_purchase_remito_frozen_doc();

-- Anulando the factura un-imputes its remitos: their NCs are anuladas and the
-- remitos are owed again on the internal side. (Its moved payment orders keep
-- the factura from being anulada until they are anuladas themselves.)
create or replace function public.cancel_imputed_purchase_ncs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('jouve.imputing_purchase', 'on', true);
  update public.purchase_invoices
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = new.cancelled_by
  where imputed_to_id = new.id
    and status = 'received';
  perform set_config('jouve.imputing_purchase', '', true);
  return null;
end;
$$;

revoke all on function public.cancel_imputed_purchase_ncs() from public, anon, authenticated;

create trigger purchase_invoices_cancel_imputed_ncs
  after update of status on public.purchase_invoices
  for each row
  when (old.status = 'received' and new.status = 'cancelled')
  execute function public.cancel_imputed_purchase_ncs();

-- 4. Imputing -----------------------------------------------------------------

-- Called by imputePurchaseRemitosAction (service role). Returns the NCs' ids.
create or replace function public.impute_purchase_remitos(
  p_factura_id uuid,
  p_remito_ids uuid[],
  p_user_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factura   record;
  v_remito    record;
  v_op        record;
  v_pos       int;
  v_numero    int;
  v_lines     jsonb;
  v_blocker   text;
  v_open      numeric;
  v_total     numeric := 0;
  v_motivo    text;
  v_new_op    uuid;
  v_nc_id     uuid;
  v_nc_ids    uuid[] := '{}';
begin
  if coalesce(cardinality(p_remito_ids), 0) = 0 then
    raise exception 'Elegí al menos un remito.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select pi.id, pi.channel_id, pi.supplier_id, pi.kind, pi.status, pi.letter,
         pi.punto_venta, pi.numero, pi.imp_total, pi.moneda, ch.is_fiscal
    into v_factura
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.id = p_factura_id
  for update of pi;

  if v_factura is null
     or not v_factura.is_fiscal
     or v_factura.kind <> 'factura'
     or v_factura.status <> 'received' then
    raise exception 'Solo se imputan remitos a una factura de Compras recibida.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_factura.moneda <> 'PES' then
    raise exception 'La factura está en otra moneda: no se le pueden imputar remitos.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- Lock and check every remito before moving anything.
  for v_remito in
    select pi.id, pi.status, pi.kind, ch.is_fiscal,
           public.purchase_remito_imputed_to(pi.id) as imputed_to
    from public.purchase_invoices pi
    join public.invoicing_channels ch on ch.id = pi.channel_id
    where pi.id = any (p_remito_ids)
    order by pi.id
    for update of pi
  loop
    if v_remito.is_fiscal or v_remito.kind <> 'factura' or v_remito.status <> 'received' then
      raise exception 'Solo se imputan remitos internos de compra recibidos.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_remito.imputed_to is not null then
      raise exception 'Un remito ya está imputado a otra factura.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_blocker := public.purchase_remito_blocker(v_remito.id);
    if v_blocker is not null then
      raise exception '%', v_blocker using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_total := v_total + (
      select o.open_amount + o.amount_paid
      from public.v_purchase_invoice_open o
      where o.purchase_invoice_id = v_remito.id
    );
  end loop;

  if (select count(*) from public.purchase_invoices where id = any (p_remito_ids))
     <> cardinality(array(select distinct unnest(p_remito_ids))) then
    raise exception 'Un remito elegido no existe.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  -- Counting the remitos already imputed to it.
  v_total := v_total + coalesce((
    select sum(n.imp_total)
    from public.purchase_invoices n
    where n.imputed_to_id = v_factura.id and n.status = 'received'
  ), 0);
  if v_total > v_factura.imp_total + 0.01 then
    raise exception 'Los remitos suman más que la factura: revisá cuáles imputar.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_motivo := 'Imputado a la factura '
    || coalesce(v_factura.letter, '')
    || lpad(v_factura.punto_venta::text, 5, '0') || '-'
    || lpad(v_factura.numero::text, 8, '0');

  select sp.numero into v_pos
  from public.sales_points sp
  where sp.channel_id = v_factura.channel_id and sp.is_enabled
  order by sp.numero
  limit 1;

  perform set_config('jouve.imputing_purchase', 'on', true);

  -- The remitos' payment orders pass to the factura, whole.
  for v_op in
    select po.id, po.payment_date, po.total_amount, po.currency, po.cotizacion,
           po.punto_venta, po.numero, poa.amount_applied
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
    where poa.purchase_invoice_id = any (p_remito_ids)
      and po.status = 'issued'
    order by po.payment_date, po.numero
    for update of po
  loop
    if v_pos is null then
      raise exception 'El canal fiscal no tiene un punto de venta habilitado para órdenes de pago.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;

    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'account_id', l.account_id,
                 'amount', l.amount,
                 'reference', l.reference
               )
               order by l.created_at
             ),
             '[]'::jsonb
           )
      into v_lines
    from public.payment_order_payment_lines l
    where l.payment_order_id = v_op.id;

    -- Its treasury movements go with it (handle_payment_order_cancellation).
    update public.payment_orders
    set status = 'canceled',
        canceled_at = now(),
        canceled_by = p_user_id
    where id = v_op.id;

    perform pg_advisory_xact_lock(
      hashtext('payment_orders:' || v_factura.channel_id || ':' || v_pos));
    select coalesce(max(po.numero), 0) + 1 into v_numero
    from public.payment_orders po
    where po.channel_id = v_factura.channel_id and po.punto_venta = v_pos;

    v_new_op := public.create_payment_order(
      v_factura.channel_id,
      v_pos,
      v_numero,
      v_factura.supplier_id,
      v_op.payment_date,
      v_op.total_amount,
      v_op.currency,
      'Pago pasado de la OP '
        || lpad(v_op.punto_venta::text, 4, '0') || '-'
        || lpad(v_op.numero::text, 8, '0')
        || ' al imputar el remito.',
      v_lines,
      jsonb_build_array(
        jsonb_build_object(
          'purchase_invoice_id', v_factura.id,
          'amount_applied', v_op.amount_applied
        )
      ),
      v_op.cotizacion
    );
    update public.payment_orders set created_by = p_user_id where id = v_new_op;
  end loop;

  -- Each remito is credited for what it has open.
  for v_remito in
    select pi.id, pi.channel_id, pi.supplier_id, pi.punto_venta, pi.moneda,
           pi.cotizacion, pi.account_id, pi.cost_center_id
    from public.purchase_invoices pi
    where pi.id = any (p_remito_ids)
    order by pi.fecha, pi.numero
  loop
    select o.open_amount into v_open
    from public.v_purchase_invoice_open o
    where o.purchase_invoice_id = v_remito.id;
    if v_open <= 0 then
      continue;
    end if;

    perform pg_advisory_xact_lock(
      hashtext('purchase_nc:' || v_remito.supplier_id || ':' || v_remito.punto_venta));
    select coalesce(max(n.numero), 0) + 1 into v_numero
    from public.purchase_invoices n
    where n.supplier_id = v_remito.supplier_id
      and n.kind = 'nc'
      and n.letter is null
      and n.punto_venta = v_remito.punto_venta;

    insert into public.purchase_invoices (
      channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
      imp_neto, imp_iva, imp_trib, imp_total, moneda, cotizacion, status,
      invoice_origin_id, motivo_nc_nd, imputed_to_id, account_id,
      cost_center_id, created_by
    ) values (
      v_remito.channel_id, v_remito.supplier_id, 'nc', null,
      v_remito.punto_venta, v_numero,
      (now() at time zone 'America/Argentina/Buenos_Aires')::date,
      v_open, 0, 0, v_open, v_remito.moneda, v_remito.cotizacion, 'received',
      v_remito.id, v_motivo, v_factura.id, v_remito.account_id,
      v_remito.cost_center_id, p_user_id
    )
    returning id into v_nc_id;
    v_nc_ids := v_nc_ids || v_nc_id;
  end loop;

  perform set_config('jouve.imputing_purchase', '', true);
  return v_nc_ids;
end;
$$;

revoke all on function public.impute_purchase_remitos(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.impute_purchase_remitos(uuid, uuid[], uuid) to service_role;
