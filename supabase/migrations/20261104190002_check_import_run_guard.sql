SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W11 · S4 F3: a check's import run is set only by the importer and
-- never changes.
--
-- RLS lets finance insert and update checks on every column, and
-- guard_check_edit (latest 20261104140003) does not look at import_run_id.
-- Resultado de gestión (cash) reads that mark: a movement of a check with an
-- import run is an opening item, so it is neutral
-- (management_pnl_lines, latest 20261104120201). A PATCH that set the mark on
-- a bounced client check turned its rejection neutral while the collection
-- stayed in Servicios, and one that set it on a hand-loaded check took its
-- inflow out of revenue. The loan peer is pinned the same way
-- (guard_loan, 20261104170001).
--
-- guard_check_import_run (before insert or update of import_run_id): a check
-- is inserted with an import run only by commit_import_run, and an update
-- never changes it. Its own trigger, so a fixture that loads an imported
-- check directly can switch off just this rule.
--
-- The writers of checks.import_run_id, latest definitions:
-- - commit_import_run (20261104070000): inserts the imported checks with the
--   run (plpgsql, so pg_context names it);
-- - undo_import_run (20261103140100): locks and deletes them, never updates
--   the column. The FK is on delete restrict, so no cascade writes it.
-- No other SQL, seed or app code writes it: create_receipt, update_receipt
-- and the manual check form insert without it, and the check actions update
-- other columns.
--
-- Existing rows are not touched. Rollback: older code writes the column
-- only through commit_import_run.

create function public.guard_check_import_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.import_run_id is not null then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?commit_import_run\(' then
        raise exception 'Un cheque queda marcado como importado solo al importarlo desde «Importar datos»'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if new.import_run_id is distinct from old.import_run_id then
    raise exception 'La importación de la que viene un cheque no se cambia'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_check_import_run() from public, anon, authenticated;

create trigger checks_guard_import_run
  before insert or update of import_run_id on public.checks
  for each row execute function public.guard_check_import_run();
