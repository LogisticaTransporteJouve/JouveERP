SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W12 · S5 F3: the storage claim says which runs it relinked.
--
-- claim_storage_billing_period links a stale run's orphan invoice (issued
-- under the run's id) instead of deleting the run. invoiceStorageAction then
-- wrote the missing `storage.invoiced` event for every linked run of the
-- client keyed by its run id and with no event yet. A run another tab had
-- just linked on the normal path (its own event not written yet), or whose
-- event failed to write, was picked up too: a second event, under another
-- user, marked `relinked`.
--
-- claim_storage_billing_period_with_relinks is the claim, unchanged, that
-- also returns the ids of the runs it relinked itself, so the action audits
-- exactly those. claim_storage_billing_period keeps its signature and result
-- as a wrapper, for code deployed before this change and for the tests.
--
-- Writers of storage_billing_runs: as in 20261104190301; the claim's body
-- moves here unchanged.
--
-- Rollback: older code calls claim_storage_billing_period, which still
-- answers the same run id (or null after a relink) and raises the same
-- errors.

create function public.claim_storage_billing_period_with_relinks(
  p_client_id    uuid,
  p_channel_id   text,
  p_period_start date,
  p_period_end   date
)
returns table (run_id uuid, relinked_run_ids uuid[])
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
    return query select null::uuid, v_linked;
    return;
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

  return query select v_id, v_linked;
end;
$$;

comment on function public.claim_storage_billing_period_with_relinks(uuid, text, date, date) is
  'Reserva el período de almacenaje (run_id; null si una factura huérfana ya lo factura) y devuelve los períodos cuya factura huérfana vinculó esta reserva (relinked_run_ids).';

revoke all on function public.claim_storage_billing_period_with_relinks(uuid, text, date, date)
  from public, anon, authenticated;
grant execute on function public.claim_storage_billing_period_with_relinks(uuid, text, date, date)
  to authenticated;

-- Same signature, result and errors as 20261104190301.
create or replace function public.claim_storage_billing_period(
  p_client_id    uuid,
  p_channel_id   text,
  p_period_start date,
  p_period_end   date
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select c.run_id
    from public.claim_storage_billing_period_with_relinks(
      p_client_id, p_channel_id, p_period_start, p_period_end) as c;
$$;

revoke all on function public.claim_storage_billing_period(uuid, text, date, date)
  from public, anon, authenticated;
grant execute on function public.claim_storage_billing_period(uuid, text, date, date)
  to authenticated;
