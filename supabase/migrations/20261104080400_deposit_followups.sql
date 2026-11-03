SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Depósito: tarifa general por área e historial de bloqueos (follow-up de
-- 20261103100000_storage_areas_lots_blocks).
--
--   1. storage_tariffs.area_id: a general tariff (no client) for the pallets
--      of one area. Storage billing (features/storage-billing/lib/billing.ts)
--      prices a pallet day, carga and descarga with the first that applies:
--        a. the client's tariff for the pallet's area (client_tariffs),
--        b. the client's tariff for every area (client_tariffs),
--        c. the client's storage tariff (storage_tariffs with client),
--        d. the general tariff of the pallet's area (this column),
--        e. the general tariff (storage_tariffs, no client, no area).
--      A client tariff always beats a general one; rows without an area
--      (every existing one) bill exactly as before. A client row has no area
--      (client_tariffs carries the client's area prices).
--   2. pallet_block_events: who blocked or unblocked a pallet, when and why.
--      pallets_block_history (after update of blocked_at) writes it for any
--      writer: a block takes its block_reason; an unblock the reason
--      unblock_pallet passes (security invoker: the caller's RLS on pallets
--      applies), or none when something else cleared it.
--
-- Rollback: older code ignores the new column and table. It bills a general
-- area tariff as a general one for every pallet: do not load area rows
-- until this deploy sticks. An older unblock leaves an event without reason.
--
-- RLS: pallet_block_events like pallets (owner/admin/warehouse read); only
-- the trigger writes it.

------------------------------------------------------------------------------
-- 1. General area tariff
------------------------------------------------------------------------------

alter table public.storage_tariffs
  -- squawk-ignore adding-foreign-key-constraint
  add column area_id uuid references public.storage_areas (id) on delete restrict;

comment on column public.storage_tariffs.area_id is
  'Área a la que aplica una tarifa general (sin cliente). Null = todas las áreas. La de un cliente nunca lleva área (el tarifario del cliente tiene las suyas).';

-- The column is new and all null: the check validates at once.
alter table public.storage_tariffs
  add constraint storage_tariffs_area_general
    check (area_id is null or client_id is null) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.storage_tariffs validate constraint storage_tariffs_area_general;

-- squawk-ignore require-concurrent-index-creation
create index storage_tariffs_area_idx
  on public.storage_tariffs (area_id) where area_id is not null;

------------------------------------------------------------------------------
-- 2. Block history
------------------------------------------------------------------------------

create table public.pallet_block_events (
  id         uuid primary key default gen_random_uuid(),
  pallet_id  uuid not null references public.pallets (id) on delete cascade,
  action     text not null check (action in ('blocked', 'unblocked')),
  reason     text check (length(reason) <= 500),
  actor_id   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.pallet_block_events is
  'Historial de bloqueos de un pallet: quién lo bloqueó o desbloqueó, cuándo y por qué. Lo escribe el trigger pallets_block_history.';

create index pallet_block_events_pallet_idx
  on public.pallet_block_events (pallet_id, created_at desc);

alter table public.pallet_block_events enable row level security;

create policy "pallet_block_events select"
  on public.pallet_block_events for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'warehouse'])));

revoke all on table public.pallet_block_events from public, anon;

create function public.record_pallet_block_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.blocked_at is null and new.blocked_at is not null then
    insert into public.pallet_block_events (pallet_id, action, reason, actor_id)
    values (new.id, 'blocked', new.block_reason, coalesce(new.blocked_by, auth.uid()));
  elsif old.blocked_at is not null and new.blocked_at is null then
    insert into public.pallet_block_events (pallet_id, action, reason, actor_id)
    values (new.id, 'unblocked',
            nullif(trim(current_setting('jouve.pallet_unblock_reason', true)), ''),
            auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function public.record_pallet_block_event() from public, anon, authenticated;

create trigger pallets_block_history
  after update of blocked_at on public.pallets
  for each row
  when (old.blocked_at is distinct from new.blocked_at)
  execute function public.record_pallet_block_event();

-- Unblocks a pallet with the reason the history keeps. Security invoker: the
-- caller's RLS decides whether it may update the pallet. Returns false when
-- the pallet does not exist or is not blocked.
create function public.unblock_pallet(p_pallet_id uuid, p_reason text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_count  integer;
begin
  if v_reason = '' or length(v_reason) > 500 then
    raise exception 'Contá por qué se desbloquea el pallet (hasta 500 caracteres).'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  perform set_config('jouve.pallet_unblock_reason', v_reason, true);
  update public.pallets
     set blocked_at = null, blocked_by = null, block_reason = null
   where id = p_pallet_id
     and blocked_at is not null;
  get diagnostics v_count = row_count;
  perform set_config('jouve.pallet_unblock_reason', '', true);
  return v_count > 0;
end;
$$;

revoke all on function public.unblock_pallet(uuid, text) from public, anon;
grant execute on function public.unblock_pallet(uuid, text) to authenticated, service_role;
