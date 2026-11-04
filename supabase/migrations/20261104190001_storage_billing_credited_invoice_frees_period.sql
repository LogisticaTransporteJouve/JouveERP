SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W11 · S2 F1, S7 F4 and S4 F4: storage billing.
--
-- 1. A fiscal factura credited in full frees its period (S2 F1, S7 F4).
--    A fiscal factura is never cancelled (check_fiscal_cancel_requires_nc,
--    20260517600000): it is undone with an NC. But only a failed or
--    cancelled invoice freed its storage run (release_invoice_billing_links,
--    20261016100000), so a factura credited in full kept its days billed for
--    good, and the delete guard (20261104170002) told the user that the NC
--    frees them. Now a storage invoice is void when it failed or was
--    cancelled, or when it is fiscal and its emitted NCs add up to its total
--    (Σ imp_total ≥ imp_total − 0.01), the test guard_freight_settlement
--    (20261104030000) uses for a liquidación's invoice.
--    storage_invoice_is_void holds that rule. An internal factura is freed
--    by cancelling it, and an internal NC can itself be cancelled later, so
--    its NCs do not free the period.
--
--    It is used by:
--    - claim_storage_billing_period: a stale pending run whose orphan
--      invoice is void is deleted, not relinked; and the client's linked
--      runs whose invoice is void are deleted before the overlap check;
--    - guard_storage_billing_run_delete: such a run can be deleted. The
--      message now names the paths that free a period;
--    - storage_billing_void_run_ids: the runs whose invoice is void, which
--      listStorageBillingRunsAction leaves out of the billed periods.
--
-- 2. A billed run keeps its invoice (S4 F4). guard_storage_billing_run_invoice
--    let a PATCH clear a run's invoice_id, and an unlinked run whose invoice
--    was issued under a random key (older code) then passed the delete
--    guard, freeing a period whose invoice is live. Now a run's invoice_id,
--    once set, does not change, unless the invoice is gone (the FK's set
--    null on an invoice delete).
--
-- The writers of storage_billing_runs, latest definitions:
-- - the claim (20261104160002, replaced here): inserts a pending run, links
--   a stale run's orphan invoice (null -> invoice), deletes stale runs with
--   no live orphan and now runs whose invoice is void;
-- - invoiceStorageAction: fills the totals of its pending run, links its
--   invoice (null -> invoice), deletes its own pending run (invoice_id is
--   null) when the issue fails or the invoice is void;
-- - release_invoice_billing_links (20261016100000): deletes the runs of an
--   invoice that just failed or was cancelled (after the status update);
-- - the FK's set null on an invoice delete. The only invoice delete is the
--   compensating delete of a just-inserted draft, which no run links.
-- No seed, importer or other SQL writes the table (undo_import_run,
-- 20261103140100, only reads it).
--
-- Existing rows are not touched. A run already linked to a fiscal factura
-- credited in full is freed by the next claim of its client.
--
-- Rollback: older code calls the claim with the same signature and never
-- changes a run's invoice once set; it does not read the new functions, so
-- its dialog keeps showing a credited period as billed until the next claim
-- deletes its run.

-- 1. The rule -------------------------------------------------------------------------

-- Null when there is no such invoice.
create function public.storage_invoice_is_void(p_invoice_id uuid)
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

comment on function public.storage_invoice_is_void(uuid) is
  'La factura de un período de almacenaje ya no lo factura: falló, se anuló, o es fiscal y sus NC emitidas suman su total. Null si no existe.';

revoke all on function public.storage_invoice_is_void(uuid) from public, anon, authenticated;
-- The claim runs as the signed-in user (invoker).
grant execute on function public.storage_invoice_is_void(uuid) to authenticated, service_role;

-- Invoker: RLS on storage_billing_runs and invoices is the role gate.
create function public.storage_billing_void_run_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id
    from public.storage_billing_runs r
   where r.invoice_id is not null
     and coalesce(public.storage_invoice_is_void(r.invoice_id), false);
$$;

comment on function public.storage_billing_void_run_ids() is
  'Los períodos de almacenaje cuya factura ya no los factura (storage_invoice_is_void): quedan libres para facturar de nuevo.';

revoke all on function public.storage_billing_void_run_ids() from public, anon, authenticated;
grant execute on function public.storage_billing_void_run_ids() to authenticated, service_role;

-- 2. The claim ------------------------------------------------------------------------

-- Same as 20261104160002, with the void rule for the orphan and for linked
-- runs.
create or replace function public.claim_storage_billing_period(
  p_client_id    uuid,
  p_channel_id   text,
  p_period_start date,
  p_period_end   date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id         uuid;
  v_run_id     uuid;
  v_invoice_id uuid;
  v_linked     uuid[] := '{}';
begin
  perform pg_advisory_xact_lock(
    hashtextextended('storage_billing:' || p_client_id::text, 0)
  );

  for v_run_id in
    select r.id
      from public.storage_billing_runs r
     where r.client_id = p_client_id
       and r.invoice_id is null
       and r.pending_since < now() - interval '15 minutes'
       for update
  loop
    select i.id
      into v_invoice_id
      from public.invoices i
     where i.idempotency_key = v_run_id::text
       and not coalesce(public.storage_invoice_is_void(i.id), true)
       and exists (select 1 from public.invoice_items it where it.invoice_id = i.id);
    if v_invoice_id is not null then
      update public.storage_billing_runs
         set invoice_id = v_invoice_id,
             pending_since = null
       where id = v_run_id;
      v_linked := v_linked || v_run_id;
    else
      delete from public.storage_billing_runs where id = v_run_id;
    end if;
  end loop;

  -- A fiscal factura credited in full no longer bills its days.
  delete from public.storage_billing_runs r
   where r.client_id = p_client_id
     and r.invoice_id is not null
     and coalesce(public.storage_invoice_is_void(r.invoice_id), false);

  if exists (
    select 1
      from public.storage_billing_runs r
     where r.id = any (v_linked)
       and coalesce(r.channel_id, p_channel_id) = p_channel_id
       and r.period_start <= p_period_end
       and r.period_end >= p_period_start
  ) then
    return null;
  end if;

  if exists (
    select 1
      from public.storage_billing_runs r
     where r.client_id = p_client_id
       and coalesce(r.channel_id, p_channel_id) = p_channel_id
       and r.period_start <= p_period_end
       and r.period_end >= p_period_start
  ) then
    raise exception 'Ese período ya fue facturado (total o parcialmente) para este cliente en este canal.'
      using errcode = '23P01', hint = 'jouve_guard';
  end if;

  insert into public.storage_billing_runs (
    client_id, channel_id, period_start, period_end, pending_since, created_by
  ) values (
    p_client_id, p_channel_id, p_period_start, p_period_end, now(), (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_storage_billing_period(uuid, text, date, date)
  from public, anon, authenticated;
grant execute on function public.claim_storage_billing_period(uuid, text, date, date)
  to authenticated;

-- 3. The delete guard -----------------------------------------------------------------

-- Same as 20261104170002, with the void rule and a message that holds.
create or replace function public.guard_storage_billing_run_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.invoice_id is not null
      and not coalesce(public.storage_invoice_is_void(old.invoice_id), true))
     or (old.invoice_id is null
         and exists (select 1 from public.invoices i
                      where i.idempotency_key = old.id::text
                        and not coalesce(public.storage_invoice_is_void(i.id), true)
                        and exists (select 1 from public.invoice_items it
                                     where it.invoice_id = i.id))) then
    raise exception 'El período de almacenaje tiene una factura vigente: para liberarlo, anulala si es interna, o emití una nota de crédito por el total si es fiscal.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_storage_billing_run_delete() from public, anon, authenticated;

-- 4. The link guard -------------------------------------------------------------------

-- Same as 20261104160002, plus: a linked run keeps its invoice.
create or replace function public.guard_storage_billing_run_invoice()
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
     and exists (select 1 from public.invoices i where i.id = old.invoice_id) then
    raise exception 'El período de almacenaje ya tiene su factura: no se desvincula ni se cambia.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.invoice_id is null
     or (tg_op = 'UPDATE' and new.invoice_id is not distinct from old.invoice_id) then
    return new;
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
    raise exception 'La factura no es del cliente del período de almacenaje.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_status in ('failed', 'cancelled') then
    raise exception 'La factura de almacenaje falló o se anuló: volvé a facturar el período.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_storage_billing_run_invoice() from public, anon, authenticated;
