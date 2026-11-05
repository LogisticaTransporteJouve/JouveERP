SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W15 · S3 F1 / F2: a freight ND counts net of its own NCs, in the
-- carga's share and in the void rule.
--
-- 1. billing_invoice_live_debits (new, invoker): what the emitted freight NDs
--    of a factura still bill, Σ over each ND of greatest(0, its total − the
--    emitted NCs whose origin is that ND). An NC issued against an ND (the
--    ARCA sync resolves CbtesAsoc of any tipo, lib/afip/sync-issued.ts) used
--    to be read by nobody: the ND kept adding to the carga's share after it
--    was credited (F1). An interest ND (late_interest_charges, linked or
--    keyed on the charge) is not freight and stays out, with its NCs.
-- 2. billing_invoice_is_void: a fiscal factura is void when its emitted NCs
--    reach its total plus its live freight NDs (minus 0.01), not its total
--    alone (F2). A factura credited in full whose freight ND is still owed
--    keeps billing what it billed: the carga, the liquidación or the
--    storage period stays billed, as the ND says, and the share is that
--    ND's part instead of 0. With no ND (or every ND credited) the rule is
--    the one of 20261104194000. Same signature, invoker and grants.
-- 3. shipment_invoice_billed_ratio:
--    (total − Σ NC on the factura + live freight NDs) / total, min 0; 0 when
--    the rule above says void, so «billed» is share > 0 as before. Same
--    signature, definer, role gate and grants as 20261105100001.
--
-- Callers of the rule (latest definitions), none changed here:
-- - shipments: claim_shipment_for_invoicing (20261104194000, invoker),
--   guard_billed_shipment and guard_shipment_invoice (definer),
--   billing_void_invoice_ids (cargas list), shipment_invoice_is_void
--   (20261105090001, no reader left) and the share;
-- - liquidaciones: guard_freight_settlement (invoiced → cancelled);
-- - storage: storage_invoice_is_void (wrapper) under
--   storage_billing_void_run_ids, claim_storage_billing_period(_with_relinks)
--   (20261104194001), guard_storage_billing_run_delete and
--   guard_storage_billing_run_invoice (20261104190301);
-- - the app: lib/source-invoice-key.ts (next attempt of a source's invoice).
-- Each now reads «void» one case less often (a live freight ND under a full
-- NC), the side that keeps a link: nothing is billed twice.
--
-- The rule stays invoker: a caller reads only the invoices RLS lets it read.
-- One who reads invoices but not late_interest_charges (fiscal_reader, who
-- claims nothing) would take an interest ND for freight and read «not void».
--
-- Existing rows are not touched. A factura that this makes non-void again is
-- listed by the control query of this migration's item in
-- docs/pendientes/antes-de-promover.md.
--
-- Rollback: older code calls the same functions by name with the same
-- arguments and reads the new answers; billing_invoice_live_debits is new
-- and unread by it.

-- 1. What the freight NDs still bill -------------------------------------------------

create function public.billing_invoice_live_debits(p_invoice_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(greatest(0::numeric, d.imp_total - coalesce((
           select sum(n.imp_total)
             from public.invoices n
            where n.invoice_origin_id = d.id
              and n.kind = 'nc'
              and n.status = 'emitted'), 0))), 0)
    from public.invoices d
   where d.invoice_origin_id = p_invoice_id
     and d.kind = 'nd'
     and d.status = 'emitted'
     and not exists (
       select 1 from public.late_interest_charges lc
        where lc.nd_invoice_id = d.id
           or lc.id::text = d.idempotency_key
     );
$$;

comment on function public.billing_invoice_live_debits(uuid) is
  'Lo que todavía facturan las ND emitidas de la factura (sin las de intereses por mora): por cada ND, su total menos sus NC emitidas, mínimo 0. 0 si no tiene.';

revoke all on function public.billing_invoice_live_debits(uuid) from public, anon, authenticated;
-- Read by billing_invoice_is_void, which runs as the signed-in user.
grant execute on function public.billing_invoice_live_debits(uuid) to authenticated, service_role;

-- 2. The void rule ---------------------------------------------------------------------

-- Same as 20261104194000, with the live freight NDs added to what the NCs
-- must reach.
create or replace function public.billing_invoice_is_void(p_invoice_id uuid)
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
                              and n.status = 'emitted'), 0)
                 >= i.imp_total + public.billing_invoice_live_debits(i.id) - 0.01)
    from public.invoices i
    join public.invoicing_channels c on c.id = i.channel_id
   where i.id = p_invoice_id;
$$;

comment on function public.billing_invoice_is_void(uuid) is
  'La factura ya no factura lo que facturaba (una carga, una liquidación, un período de almacenaje): falló, se anuló, o es fiscal y sus NC emitidas suman su total más lo que todavía facturan sus ND (billing_invoice_live_debits). Null si no existe.';

-- 3. The carga's share -----------------------------------------------------------------

-- Same as 20261105100001, with each freight ND net of its own NCs.
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
           else greatest(0::numeric,
                         (i.imp_total - adj.credited + public.billing_invoice_live_debits(i.id))
                         / i.imp_total)
         end
    from public.shipments s
    join public.invoices i on i.id = s.invoice_id
    join public.invoicing_channels c on c.id = i.channel_id
    cross join lateral (
      select coalesce(sum(n.imp_total), 0) as credited
        from public.invoices n
       where n.invoice_origin_id = i.id
         and n.kind = 'nc'
         and n.status = 'emitted'
    ) adj
   where s.id = p_shipment_id
     and (coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          or public.user_has_role(array['owner', 'admin', 'operations']));
$$;

comment on function public.shipment_invoice_billed_ratio(uuid) is
  'Parte del flete de la carga que su factura todavía factura: (total − NC emitidas + lo que todavía facturan sus ND) / total, mínimo 0; cada ND cuenta neta de sus propias NC. 0 si la factura ya no la factura (billing_invoice_is_void). Solo cuentan las NC y ND de una factura fiscal, sin las ND de intereses por mora. Para quien lee cargas (owner, admin, operations) o el service role. Null si la carga no tiene factura. SECURITY DEFINER.';

-- create or replace keeps the grants; restated as in 20261105100001.
revoke all on function public.shipment_invoice_billed_ratio(uuid) from public, anon, authenticated;
grant execute on function public.shipment_invoice_billed_ratio(uuid) to authenticated, service_role;
