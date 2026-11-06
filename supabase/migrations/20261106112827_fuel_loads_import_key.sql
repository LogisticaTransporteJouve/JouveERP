SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A fuel statement import is idempotent in the database.
--
-- confirmFuelImportAction read the loads already in the system and then
-- inserted the rest: a double click (or a retry while the first request was
-- still running) passed the read twice and imported the statement twice.
-- A unique key on (vehicle, date, amount, liters) cannot carry it: two real
-- loads can share those (the import lets the user keep such a row on
-- purpose, and hand-loaded rows have no such rule), and existing rows may
-- already repeat them.
--
-- Each imported row now carries import_key: the import's key (one per
-- statement read in the dialog) plus the row's identity within it. The
-- insert skips a row whose key exists (ON CONFLICT DO NOTHING), so the same
-- import sent twice adds nothing the second time. Hand-loaded rows and rows
-- imported before this migration keep import_key NULL; NULLs never conflict.
--
-- Rollback: older code does not write import_key (NULL), which the index
-- accepts.

alter table public.fuel_loads
  add column import_key text;

comment on column public.fuel_loads.import_key is
  'Imported rows only: the import''s key and the row''s identity within it. Unique, so the same import sent twice adds its rows once. NULL for hand-loaded rows.';

-- The column was just added, so every row is NULL: nothing to index or
-- check, and the write lock is momentary. CONCURRENTLY cannot run in this
-- migration's transaction. A full (not partial) unique index, so PostgREST's
-- on_conflict=import_key can infer it.
-- squawk-ignore require-concurrent-index-creation
create unique index fuel_loads_import_key_unique
  on public.fuel_loads (import_key);
