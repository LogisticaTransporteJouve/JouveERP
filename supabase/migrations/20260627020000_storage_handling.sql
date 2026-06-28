-- Storage tariff = per-day storage + one-off carga (in) and descarga (out) fees
-- per pallet. The billing computation (features/storage-billing) adds the carga
-- charge when a pallet enters within the period and the descarga charge when it
-- leaves within the period.

alter table public.storage_tariffs
  add column handling_in numeric(14, 2) not null default 0
    check (handling_in >= 0),
  add column handling_out numeric(14, 2) not null default 0
    check (handling_out >= 0);

comment on column public.storage_tariffs.handling_in is
  'Cargo de carga (ingreso) por pallet, una vez al entrar.';
comment on column public.storage_tariffs.handling_out is
  'Cargo de descarga (egreso) por pallet, una vez al salir.';
