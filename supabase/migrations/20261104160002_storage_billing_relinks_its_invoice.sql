SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W9 · S5 F1: storage billing never issues a second CAE for a
-- period. The peer of the freight-settlement and shipment fix (W1 F5).
--
-- invoiceStorageAction claims the period (a pending run), issues the invoice
-- and links it in a second commit. The invoice got a random idempotency key,
-- and claim_storage_billing_period (20261031200412) deleted any pending run
-- older than 15 minutes before its overlap check. When the link was lost (a
-- failed update, or the request killed after the issue), the next «Facturar»
-- for those days deleted the run and issued a second factura with its own
-- CAE. And the link wrote the invoice id with no status check, so an invoice
-- AFIP rejected before the link ran (release_invoice_billing_links found no
-- run to free) kept the period billed for good.
--
-- From now on the action issues under the run's id as the idempotency key
-- (and writes the run's totals before issuing). Then:
--
-- 1. claim_storage_billing_period, for each of the client's stale pending
--    runs: when a live invoice (not failed or cancelled, with its items) was
--    issued under the run's id, it links it to the run instead of deleting
--    the run. A claim that overlaps a run it just linked returns null and
--    claims nothing: the period is billed, and raising would roll the link
--    back. Any other overlap raises as before. A stale run with no live
--    invoice is deleted as before. Same signature, invoker, lock and
--    overlap rule as 20261031200412.
--
-- 2. guard_storage_billing_run_invoice (before insert or update of
--    invoice_id): a run links only an invoice of its client that has not
--    failed or been cancelled. The invoice row is locked (for share), so a
--    failure recorded at the same time either runs first (and the link is
--    refused) or after (and release_invoice_billing_links deletes the linked
--    run). The FK's set null on an invoice delete passes (no invoice).
--
-- The writers of storage_billing_runs, latest definitions: the claim
-- (insert, link, delete), invoiceStorageAction (totals, link, delete of its
-- own pending run), release_invoice_billing_links (delete) and the FK set
-- null. No seed, importer or other SQL writes it.
--
-- Existing rows are not touched: a pending run from older code has no invoice
-- under its id and is deleted as before.
--
-- Rollback: older code issues under a random key, so the claim deletes its
-- stale runs as before; the link guard refuses only a void invoice, which the
-- older code's link then reports as «no se registró el período». A claim that
-- links a run left by newer code returns null, which older code reports as
-- «No se pudo validar el período.» and issues nothing.

-- 1. The claim ------------------------------------------------------------------------

-- Same as 20261031200412 plus the relink of a stale run's live invoice.
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
       and i.status not in ('failed', 'cancelled')
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

-- 2. The link ---------------------------------------------------------------------------

create function public.guard_storage_billing_run_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_status    text;
begin
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

create trigger storage_billing_runs_guard_invoice
  before insert or update of invoice_id on public.storage_billing_runs
  for each row execute function public.guard_storage_billing_run_invoice();
