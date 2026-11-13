SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The carga form asks for more: Tipo, Dirección de carga, Fecha de descarga,
-- Horario and Observaciones. Existing columns are reused: origin is the
-- «Dirección de carga», destination the «Dirección de descarga»,
-- scheduled_date the «Fecha de carga» and notes the «Observaciones».
-- delivery_date stays the delivery stamp of «Entregar»: the planned unload
-- day is a column of its own.
--
-- 1. kind ('retiro' | 'carga' | 'mudanza', default 'carga'), unload_date
--    (on or after scheduled_date) and time_window (short free text).
-- 2. shipments_keep_unload_after_load: moving the load day past an unload day
--    the same update does not touch shifts the unload day by the same days,
--    so reprogramming keeps the carga's duration and the check holds.
--
-- Existing RLS covers the new columns. Rollback: older code ignores them.

-- 1. Columns ------------------------------------------------------------------------

alter table public.shipments
  add column kind text not null default 'carga',
  add column unload_date date,
  add column time_window text;

-- Every row holds the defaults just added (kind 'carga', nulls): the checks
-- are validated at once.
alter table public.shipments
  -- squawk-ignore constraint-missing-not-valid
  add constraint shipments_kind_known
    check (kind in ('retiro', 'carga', 'mudanza')),
  -- squawk-ignore constraint-missing-not-valid
  add constraint shipments_unload_after_load
    check (unload_date is null or scheduled_date is null or unload_date >= scheduled_date),
  -- squawk-ignore constraint-missing-not-valid
  add constraint shipments_time_window_length
    check (time_window is null or char_length(btrim(time_window)) between 1 and 60);

comment on column public.shipments.kind is
  'Tipo de carga: retiro, carga o mudanza.';
comment on column public.shipments.unload_date is
  'Fecha de descarga prevista (igual o posterior a la fecha de carga). La entrega real es delivery_date.';
comment on column public.shipments.time_window is
  'Horario de la carga, texto libre corto (ej. «8 a 12 hs»).';
comment on column public.shipments.origin is
  'Dirección de carga.';
comment on column public.shipments.destination is
  'Dirección de descarga.';

-- 2. Keep the unload day after a moved load day ------------------------------------------

create function public.shipments_keep_unload_after_load()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.unload_date is not distinct from old.unload_date
     and new.unload_date is not null
     and old.scheduled_date is not null
     and new.scheduled_date is not null
     and new.unload_date < new.scheduled_date then
    new.unload_date := new.unload_date + (new.scheduled_date - old.scheduled_date);
  end if;
  return new;
end;
$$;

revoke all on function public.shipments_keep_unload_after_load() from public, anon, authenticated;

create trigger shipments_keep_unload_after_load
  before update of scheduled_date on public.shipments
  for each row
  when (new.scheduled_date is distinct from old.scheduled_date)
  execute function public.shipments_keep_unload_after_load();
