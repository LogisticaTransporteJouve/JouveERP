SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Extras por viajes: the cargas a driver's recibo already pays. A driver
-- with, say, 8 cargas in the recibo is paid apart only for the rest, so the
-- planilla's trip extras suggestion bills max(descargas − this, 0) at
-- trip_rate_per_unload (features/hr/account-schema.ts tripExtrasLines).
-- NULL (every existing employee) = none in the recibo: the suggestion is as
-- before. Covered by the employees RLS policies already in place.
--
-- Rollback: older code ignores the column and suggests every descarga.

alter table public.employees
  add column trip_unloads_in_receipt bigint;

-- Every row holds the null just added: validated at once.
alter table public.employees
  -- squawk-ignore constraint-missing-not-valid
  add constraint employees_trip_unloads_in_receipt_nonnegative
    check (trip_unloads_in_receipt is null or trip_unloads_in_receipt >= 0);

comment on column public.employees.trip_unloads_in_receipt is
  'Cargas (descargas) que ya paga el recibo del chofer: los extras por viajes sugieren solo las que pasan esta cantidad. NULL = ninguna.';
