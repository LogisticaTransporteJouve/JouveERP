-- H.5 — snapshot de tarifas aplicadas en cada corrida de facturación de
-- almacenaje. storage_billing_runs guardaba solo los totales computados; si
-- después la tarifa cambia (aumento %), el run pierde el registro de QUÉ
-- tarifa se usó. El snapshot lo hace autocontenido.

alter table public.storage_billing_runs
  add column if not exists applied_tariffs jsonb not null default '[]'::jsonb;

comment on column public.storage_billing_runs.applied_tariffs is
  'Snapshot de las tarifas usadas al facturar (client_id, rate_per_pallet, period, handling_in/out, vigencia). Registro histórico independiente de storage_tariffs.';
