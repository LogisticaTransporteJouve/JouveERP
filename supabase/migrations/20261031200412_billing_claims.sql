SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Freight and storage invoicing read "not billed yet", issued the invoice and
-- only then linked it: two concurrent clicks both passed the check and billed
-- twice. Both flows now claim first, atomically, and link after issuing.
-- A claim older than 15 minutes is treated as abandoned (the request died
-- between claiming and linking) so the document can be billed again.

------------------------------------------------------------------------------
-- 1. Shipments: claim column + guard on billed loads.
------------------------------------------------------------------------------

alter table public.shipments
  add column invoicing_claimed_at timestamptz;

comment on column public.shipments.invoicing_claimed_at is
  'Set by invoiceFreightAction with UPDATE ... WHERE invoice_id IS NULL before issuing; cleared when the invoice is linked or the issue fails.';

-- A billed load (or one being billed) keeps what its invoice says: its
-- client, channel, route and freight cannot change and it cannot be deleted.
-- Status, notes, dates and the invoice link itself stay editable (cancelling
-- the invoice clears invoice_id through release_invoice_billing_links).
create or replace function public.guard_billed_shipment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_billed boolean := old.invoice_id is not null
    or coalesce(old.invoicing_claimed_at > now() - interval '15 minutes', false);
begin
  if not v_billed then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'La carga ya está facturada: anulá la factura (o emití la nota de crédito) antes de borrarla.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.invoice_id is not distinct from old.invoice_id
     and (new.client_id is distinct from old.client_id
       or new.channel_id is distinct from old.channel_id
       or new.freight_amount is distinct from old.freight_amount
       or new.origin is distinct from old.origin
       or new.destination is distinct from old.destination) then
    raise exception 'La carga ya está facturada: anulá la factura (o emití la nota de crédito) para cambiar cliente, canal, ruta o flete.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_billed_shipment() from public, anon, authenticated;

create trigger shipments_guard_billed
  before update or delete on public.shipments
  for each row execute function public.guard_billed_shipment();

------------------------------------------------------------------------------
-- 2. Storage billing runs: channel + pending claim, claimed under a lock.
------------------------------------------------------------------------------

-- storage_billing_runs holds one row per billed client period (a few hundred
-- at most) and the new column starts null, so the FK check and the index
-- build hold their locks for milliseconds.
alter table public.storage_billing_runs
  -- squawk-ignore adding-foreign-key-constraint
  add column channel_id text references public.invoicing_channels (id) on delete restrict,
  add column pending_since timestamptz;

-- squawk-ignore require-concurrent-index-creation
create index storage_billing_runs_channel_idx
  on public.storage_billing_runs (channel_id)
  where channel_id is not null;

comment on column public.storage_billing_runs.pending_since is
  'Set while the run is claimed and its invoice is being issued; null once linked.';

update public.storage_billing_runs r
   set channel_id = i.channel_id
  from public.invoices i
 where i.id = r.invoice_id
   and r.channel_id is null;

-- Claims [p_period_start, p_period_end] for the client on the channel and
-- returns the run id to link the invoice to. Serialised per client by an
-- advisory lock, so two concurrent claims cannot both see "no overlap". A run
-- with no channel (its invoice is gone) counts against every channel, as the
-- app check did. Invoker: RLS on storage_billing_runs is the role gate.
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
  v_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('storage_billing:' || p_client_id::text, 0)
  );

  delete from public.storage_billing_runs
   where client_id = p_client_id
     and invoice_id is null
     and pending_since < now() - interval '15 minutes';

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

-- invoiceStorageAction fills the totals and the invoice on the claimed run.
create policy "storage_billing_runs update" on public.storage_billing_runs
  for update to authenticated
  using ( (select public.user_has_role(array['owner','admin','finance'])) )
  with check ( (select public.user_has_role(array['owner','admin','finance'])) );
