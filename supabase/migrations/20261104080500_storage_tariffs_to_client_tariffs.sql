SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Unificar tarifas (roadmap 4.2 follow-up): a client's storage_tariffs row
-- moves to its tarifario (client_tariffs) with the same prices and validity,
-- only where billing provably stays the same.
--
-- Storage billing (features/storage-billing/lib/billing.ts) prices each day
-- with the client's client_tariffs and the rest with ONE storage_tariffs row
-- picked for the whole period (the client's, latest valid_from). A client's
-- row R is migrated only when:
--   * it is the client's single active storage_tariffs row (with two, the
--     whole-period pick and a per-day tarifario can price a day differently);
--   * the client has no client_tariffs row of storage, carga or descarga
--     (no overlap, and R stays the only price of its days);
--   * R has no end (valid_to null) and starts on or before the first day of
--     the current month, so no billing period from this month on straddles
--     its validity (a straddling period would round the two parts apart).
-- Then, for every period from the current month on, every pallet day, carga
-- and descarga gets R's price either way: almacenaje at rate_per_pallet per
-- month (pallet_month) or day (pallet_day), carga at handling_in and descarga
-- at handling_out (only when > 0: a 0 fallback already bills 0).
--
-- R is kept, active, as the fallback it was (the days the tarifario covers
-- it no longer prices) and marked migrated_to_client_tariffs_at;
-- guard_storage_tariff_migrated keeps its prices and validity as they are
-- (edit them in the tarifario), and the bulk increase skips it. Rows that do
-- not qualify stay as they are.
--
-- migrate_client_storage_tariffs() does it and returns how many rows it
-- migrated; it is idempotent (a migrated row, or a client with a tarifario,
-- is skipped) and service-only.
--
-- Rollback: older code reads client_tariffs too (20261103080100) and bills
-- the same; it can still edit a migrated row's price, which the tarifario
-- then shadows. Revert by deleting the client_tariffs rows whose notes say
-- 'Migrada de tarifas de almacenaje' and clearing the marker.

alter table public.storage_tariffs
  add column migrated_to_client_tariffs_at timestamptz;

comment on column public.storage_tariffs.migrated_to_client_tariffs_at is
  'Cuándo pasó al tarifario del cliente (client_tariffs) con los mismos precios y vigencia. Queda como respaldo y no se edita: se cambia en el tarifario.';

create function public.guard_storage_tariff_migrated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.migrated_to_client_tariffs_at is null then
    return new;
  end if;
  if new.client_id is distinct from old.client_id
     or new.area_id is distinct from old.area_id
     or new.rate_per_pallet is distinct from old.rate_per_pallet
     or new.period is distinct from old.period
     or new.handling_in is distinct from old.handling_in
     or new.handling_out is distinct from old.handling_out
     or new.valid_from is distinct from old.valid_from
     or new.valid_to is distinct from old.valid_to
     or new.migrated_to_client_tariffs_at is distinct from old.migrated_to_client_tariffs_at then
    raise exception 'Esta tarifa pasó al tarifario del cliente: cambiala en el detalle del cliente › Tarifario.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_storage_tariff_migrated() from public, anon, authenticated;

create trigger storage_tariffs_guard_migrated
  before update on public.storage_tariffs
  for each row execute function public.guard_storage_tariff_migrated();

create function public.migrate_client_storage_tariffs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.storage_tariffs%rowtype;
  v_count integer := 0;
  v_note  text := 'Migrada de tarifas de almacenaje';
begin
  for v_row in
    select t.*
      from public.storage_tariffs t
     where t.client_id is not null
       and t.is_active
       and t.migrated_to_client_tariffs_at is null
       and t.area_id is null
       and t.valid_to is null
       and t.valid_from <= date_trunc('month', current_date)::date
       and t.period in ('daily', 'monthly')
       and not exists (
         select 1 from public.storage_tariffs o
          where o.client_id = t.client_id
            and o.is_active
            and o.id <> t.id
       )
       and not exists (
         select 1 from public.client_tariffs c
          where c.client_id = t.client_id
            and c.concept in ('storage', 'handling_in', 'handling_out')
       )
     order by t.client_id
       for update of t
  loop
    insert into public.client_tariffs
      (client_id, concept, unit, price, currency, valid_from, valid_to, notes, created_by)
    values
      (v_row.client_id, 'storage',
       case when v_row.period = 'monthly' then 'pallet_month' else 'pallet_day' end,
       v_row.rate_per_pallet, 'ARS', v_row.valid_from, null, v_note, v_row.created_by);
    if v_row.handling_in > 0 then
      insert into public.client_tariffs
        (client_id, concept, unit, price, currency, valid_from, valid_to, notes, created_by)
      values
        (v_row.client_id, 'handling_in', 'pallet', v_row.handling_in, 'ARS',
         v_row.valid_from, null, v_note, v_row.created_by);
    end if;
    if v_row.handling_out > 0 then
      insert into public.client_tariffs
        (client_id, concept, unit, price, currency, valid_from, valid_to, notes, created_by)
      values
        (v_row.client_id, 'handling_out', 'pallet', v_row.handling_out, 'ARS',
         v_row.valid_from, null, v_note, v_row.created_by);
    end if;
    update public.storage_tariffs
       set migrated_to_client_tariffs_at = now()
     where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.migrate_client_storage_tariffs() is
  'Pasa al tarifario del cliente las tarifas de almacenaje de cliente cuya facturación no cambia (ver la migración 20261104080500). Idempotente; devuelve cuántas pasó.';

revoke all on function public.migrate_client_storage_tariffs() from public, anon, authenticated;
grant execute on function public.migrate_client_storage_tariffs() to service_role;

select public.migrate_client_storage_tariffs();
