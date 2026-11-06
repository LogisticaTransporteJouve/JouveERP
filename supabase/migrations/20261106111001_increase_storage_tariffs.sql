SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- increase_storage_tariffs: «Aumentar %» on the storage tariffs in one
-- transaction. increaseStorageTariffsAction used to insert the raised rows and
-- then close the old ones in a second write; when the close failed it only
-- logged it and answered ok, leaving the old and the new row of a tariff in
-- force on the same days.
--
-- A tariff is raised when it is active, not moved to the client's tarifario,
-- started before p_valid_from and still in force that day
-- (features/storage-tariffs/lib/increase.ts, which the dialog's preview uses).
-- Those rows are locked, each gets a new open-ended row from p_valid_from with
-- rate and handling × (1 + p_percent / 100) rounded to cents, and is closed the
-- day before. A second increase for the same day waits for the first and then
-- finds nothing left to raise. `skipped` counts the active rows in force that
-- day that start on or after it (edited by hand), as the action reported.
--
-- SECURITY INVOKER, called with the user's client: storage_tariffs' RLS
-- (owner, admin, finance) applies as before and created_by is auth.uid().
--
-- Rollback: older code does not call it and writes the rows itself.

create function public.increase_storage_tariffs(p_percent numeric, p_valid_from date)
returns table (updated integer, skipped integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_factor  numeric;
  v_ids     uuid[];
  v_skipped integer;
begin
  if p_percent is null or p_percent <= -100 or p_percent = 0 or p_valid_from is null then
    raise exception 'increase_storage_tariffs: p_percent must be above -100 and not 0, p_valid_from set';
  end if;
  v_factor := 1 + p_percent / 100;

  select array_agg(l.id) into v_ids
    from (
      select t.id
        from public.storage_tariffs t
       where t.is_active
         and t.migrated_to_client_tariffs_at is null
         and t.valid_from < p_valid_from
         and (t.valid_to is null or t.valid_to >= p_valid_from)
       order by t.id
         for update
    ) l;

  if v_ids is null then
    raise exception 'No hay tarifas vigentes anteriores a esa fecha para aumentar.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  select count(*)::integer into v_skipped
    from public.storage_tariffs t
   where t.is_active
     and t.migrated_to_client_tariffs_at is null
     and t.valid_from >= p_valid_from
     and (t.valid_to is null or t.valid_to >= p_valid_from);

  insert into public.storage_tariffs
    (client_id, area_id, rate_per_pallet, handling_in, handling_out, period,
     valid_from, valid_to, notes, created_by)
  select t.client_id,
         t.area_id,
         round(t.rate_per_pallet * v_factor, 2),
         round(t.handling_in * v_factor, 2),
         round(t.handling_out * v_factor, 2),
         t.period,
         p_valid_from,
         null,
         -- «Aumento 10% s/ $1.500,5»: the old rate as es-AR prints it.
         format('Aumento %s%% s/ $%s', p_percent,
                regexp_replace(
                  translate(to_char(t.rate_per_pallet, 'FM999,999,999,990.00'), ',.', '.,'),
                  ',?0+$', '')),
         auth.uid()
    from public.storage_tariffs t
   where t.id = any (v_ids);

  update public.storage_tariffs
     set valid_to = p_valid_from - 1
   where id = any (v_ids);

  return query select cardinality(v_ids), v_skipped;
end;
$$;

comment on function public.increase_storage_tariffs(numeric, date) is
  'Aumenta un porcentaje las tarifas de almacenaje vigentes desde una fecha: crea las nuevas y cierra las anteriores el día previo, en una transacción. Devuelve cuántas aumentó y cuántas salteó.';

revoke all on function public.increase_storage_tariffs(numeric, date) from public, anon, authenticated;
grant execute on function public.increase_storage_tariffs(numeric, date) to authenticated, service_role;
