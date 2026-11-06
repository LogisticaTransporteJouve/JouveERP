SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Km recorridos from Strix Flotas (the trucks' GPS), replacing the monthly
-- odometer reading (owner decision 2026-11-06,
-- docs/decisions/2026-11-06-km-recorridos-desde-strix.md):
--
--   1. strix_account: the Strix user the robot signs in with (one row). The
--      password lives in Supabase Vault; the row keeps the username, the
--      secret's id, how the last sign-ins went and the last run. Owner and
--      admin read it (fleet_km:admin); only the service role writes it.
--   2. vehicle_km_daily: km driven per vehicle and day, as Strix reports
--      them. Fleet roles read it; only the sync writes it.
--   3. sync_automatic_tasks loses the monthly «Cargar km» source: nobody
--      types km any more. Open km tasks close themselves on the next sync.
--   4. ai_vehicle_activity reads the km driven from vehicle_km_daily (sum
--      over the range). Same signature and columns: odometer_km now holds
--      Strix's km and odometer_start/end are null.
--
-- vehicle_km_readings stays (not read by the new code) so a rollback keeps
-- its data. Rollback: older code reads vehicle_km_readings and never this
-- table; its Km mensual shows no reminder task.

------------------------------------------------------------------------------
-- 1. strix_account
------------------------------------------------------------------------------

create table public.strix_account (
  id                   boolean primary key default true check (id),
  username             text not null check (char_length(username) between 1 and 200),
  secret_id            uuid,
  status               text not null default 'active'
                         check (status in ('active', 'sign_in_failing')),
  consecutive_failures bigint not null default 0 check (consecutive_failures >= 0),
  last_success_at      timestamptz,
  last_error_code      text check (last_error_code is null or char_length(last_error_code) <= 40),
  sync_requested_at    timestamptz,
  sync_started_at      timestamptz,
  sync_finished_at     timestamptz,
  sync_result          jsonb,
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);

comment on table public.strix_account is
  'Usuario de Strix Flotas para traer los km recorridos (una fila). La clave está en Vault (secret_id); acá solo el estado.';
comment on column public.strix_account.sync_result is
  'StrixSyncResult of the last run (lib/strix/km-sync.ts). Never the password.';

create index strix_account_updated_by_idx on public.strix_account (updated_by);

alter table public.strix_account enable row level security;

-- Same roles as fleet_km:admin (lib/auth/permissions.ts).
create policy "Fleet admins view the Strix account" on public.strix_account
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin'])) );

revoke all on table public.strix_account from public, anon, authenticated;
grant select on table public.strix_account to authenticated;
grant all on table public.strix_account to service_role;

-- Saves the username and, when given, a new password (a null password keeps
-- the stored one). A new password or username resets the failure state.
-- Never echoes the password, not even in an error.
create or replace function public.set_strix_credentials(
  p_username text,
  p_user_id  uuid,
  p_password text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret   uuid;
  v_username text;
begin
  p_username := btrim(coalesce(p_username, ''));
  if char_length(p_username) = 0 or char_length(p_username) > 200 then
    raise exception 'Usuario inválido.' using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_password is not null and (char_length(p_password) = 0 or char_length(p_password) > 200) then
    raise exception 'La clave no es válida.' using errcode = '22023', hint = 'jouve_guard';
  end if;

  select secret_id, username into v_secret, v_username from public.strix_account where id;

  if p_password is null and v_secret is null then
    raise exception 'Falta la clave.' using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_password is not null then
    if v_secret is null then
      select id into v_secret from vault.secrets where name = 'strix_password';
    end if;
    if v_secret is null then
      v_secret := vault.create_secret(p_password, 'strix_password',
                                      'Clave del usuario de Strix Flotas para los km recorridos');
    else
      perform vault.update_secret(v_secret, p_password);
    end if;
  end if;

  insert into public.strix_account as a (id, username, secret_id, updated_by, updated_at)
  values (true, p_username, v_secret, p_user_id, now())
  on conflict (id) do update
     set username = excluded.username,
         secret_id = excluded.secret_id,
         updated_by = excluded.updated_by,
         updated_at = now(),
         status = case when p_password is not null or a.username <> excluded.username
                       then 'active' else a.status end,
         consecutive_failures = case when p_password is not null or a.username <> excluded.username
                                     then 0 else a.consecutive_failures end,
         last_error_code = case when p_password is not null or a.username <> excluded.username
                                then null else a.last_error_code end;
end;
$$;

revoke all on function public.set_strix_credentials(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_strix_credentials(text, uuid, text) to service_role;

-- The password, for the job step that signs in. Null when not configured or
-- stopped: a rejected password is not retried until someone saves a new one.
create or replace function public.get_strix_password()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from public.strix_account a
    join vault.decrypted_secrets s on s.id = a.secret_id
   where a.id and a.status = 'active';
$$;

revoke all on function public.get_strix_password() from public, anon, authenticated;
grant execute on function public.get_strix_password() to service_role;

-- Records a sign-in against the credentials the run read (compare-and-set on
-- updated_at, which every save moves). A rejected password, or two failures
-- in a row, stop the account until the password is saved again.
create or replace function public.record_strix_attempt(
  p_ok         boolean,
  p_error_code text,
  p_version    timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.strix_account
       set status = 'active',
           consecutive_failures = 0,
           last_success_at = now(),
           last_error_code = null
     where id and updated_at = p_version;
  else
    update public.strix_account
       set consecutive_failures = consecutive_failures + 1,
           last_error_code = left(coalesce(nullif(p_error_code, ''), 'SIGN_IN_FAILED'), 40),
           status = case when p_error_code = 'SIGN_IN_REJECTED'
                           or consecutive_failures + 1 >= 2
                         then 'sign_in_failing' else status end
     where id and updated_at = p_version;
  end if;
  return found;
end;
$$;

revoke all on function public.record_strix_attempt(boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_strix_attempt(boolean, text, timestamptz) to service_role;

------------------------------------------------------------------------------
-- 2. vehicle_km_daily
------------------------------------------------------------------------------

create table public.vehicle_km_daily (
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  day        date not null,
  km         numeric(10, 1) not null check (km >= 0),
  synced_at  timestamptz not null default now(),
  primary key (vehicle_id, day)
);

comment on table public.vehicle_km_daily is
  'Km recorridos por vehículo y día según Strix Flotas (GPS). Solo los escribe la sincronización (lib/strix/km-sync.ts).';

create index vehicle_km_daily_day_idx on public.vehicle_km_daily (day);

alter table public.vehicle_km_daily enable row level security;

-- fleet_km:read roles: owner, admin, operations.
create policy "Fleet roles view daily km" on public.vehicle_km_daily
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'operations'])) );

revoke all on table public.vehicle_km_daily from public, anon, authenticated;
grant select on table public.vehicle_km_daily to authenticated;
grant all on table public.vehicle_km_daily to service_role;

------------------------------------------------------------------------------
-- 3. Tasks: no monthly «Cargar km» (the query of 20261105231001 without the
--    vehicle_km source)
------------------------------------------------------------------------------

create or replace function public.sync_automatic_tasks(p_today date)
returns table (task_id uuid, kind text, change text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform set_config('jouve.syncing_tasks', 'on', true);
  return query
    with desired as (
      select
        'purchase_invoices'::text as source_table,
        d.purchase_invoice_id as source_id,
        'supplier_payment'::text as kind,
        format('Pagar a %s: %s', s.legal_name, concat_ws(' ',
          case d.kind when 'nd' then 'ND' else 'Factura' end,
          d.letter,
          lpad(d.punto_venta::text, 4, '0') || '-' || lpad(d.numero::text, 8, '0'))) as title,
        coalesce(d.fch_vto_pago, d.fecha) as due_date
      from public.v_supplier_aging_documents d
      join public.suppliers s on s.id = d.supplier_id
      where d.document_type = 'purchase_invoice'
        and coalesce(d.fch_vto_pago, d.fecha) <= p_today + 7

      union all

      select
        'invoices',
        d.invoice_id,
        'collection',
        format('Cobrar a %s: %s', c.legal_name, concat_ws(' ',
          case d.kind when 'nd' then 'ND' else 'Factura' end,
          d.letter,
          lpad(d.punto_venta::text, 4, '0') || '-' || coalesce(lpad(d.numero::text, 8, '0'), 's/n'))),
        d.due_date
      from public.v_aging_documents d
      join public.clients c on c.id = d.client_id
      where d.document_type = 'invoice'
        and d.due_date < p_today

      union all

      select
        'loan_installments',
        li.id,
        'loan_installment',
        format('Pagar cuota %s de %s', li.number, l.description),
        li.due_date
      from public.loan_installments li
      join public.loans l on l.id = li.loan_id
      where li.status = 'pendiente'
        and l.status = 'active'
        and li.due_date <= p_today + 7

      union all

      select
        'issued_checks',
        ic.id,
        'issued_check',
        format('Cubrir cheque propio N° %s (%s)', ic.check_number, ic.bank_name),
        ic.due_date
      from public.issued_checks ic
      where ic.status = 'emitted'
        and ic.due_date <= p_today + 7

      union all

      select
        'fleet_documents',
        fd.id,
        'fleet_document',
        format('Renovar %s de %s', replace(fd.kind, '_', ' '), coalesce(v.patente, dr.full_name)),
        fd.expires_at
      from public.fleet_documents fd
      left join public.vehicles v on v.id = fd.vehicle_id
      left join public.drivers dr on dr.id = fd.driver_id
      where fd.expires_at <= p_today + 30
        and coalesce(v.is_active, dr.is_active, false)
        and not exists (
          select 1 from public.fleet_documents n
           where n.id <> fd.id
             and n.kind = fd.kind
             and n.vehicle_id is not distinct from fd.vehicle_id
             and n.driver_id is not distinct from fd.driver_id
             and n.expires_at > p_today + 30
        )

      union all

      select
        'employee_documents',
        ed.id,
        'employee_document',
        format('Renovar %s de %s', replace(ed.kind::text, '_', ' '), e.legal_name),
        ed.expires_at
      from public.employee_documents ed
      join public.employees e on e.id = ed.employee_id
      where ed.expires_at <= p_today + 30
        and e.is_active
        and not exists (
          select 1 from public.employee_documents n
           where n.id <> ed.id
             and n.employee_id = ed.employee_id
             and n.kind = ed.kind
             and n.expires_at > p_today + 30
        )

      union all

      select
        'tax_documents',
        td.id,
        'tax_document',
        format('Pagar %s del período %s',
          public.tax_document_label(td.kind, td.title, td.jurisdiction),
          to_char(to_date(td.period, 'YYYY-MM'), 'MM/YYYY')),
        td.due_date
      from public.tax_documents td
      where td.status in ('pendiente', 'liquidado')
        and td.due_date <= p_today + 7
        -- A month whose IVA DDJJ only leaves a saldo a favor has nothing to pay.
        and not (td.amount is null and td.credit_balance is not null)
    ),
    upserted as (
      insert into public.tasks as t (title, due_date, origin, kind, source_table, source_id)
      select d.title, d.due_date, 'automatic', d.kind, d.source_table, d.source_id
        from desired d
      on conflict (source_table, source_id, kind) do update
        set title = excluded.title,
            due_date = case when t.due_date_locked then t.due_date else excluded.due_date end,
            notified_stage = case
              when t.due_date_locked or t.due_date = excluded.due_date then t.notified_stage
            end,
            status = case when t.auto_closed then 'open' else t.status end,
            completed_at = case when t.auto_closed then null else t.completed_at end,
            auto_closed = false
        where t.title is distinct from excluded.title
           or (not t.due_date_locked and t.due_date is distinct from excluded.due_date)
           or t.auto_closed
      returning t.id, t.kind, (t.xmax = 0) as inserted
    ),
    closed as (
      update public.tasks t
         set status = 'done',
             completed_at = now(),
             completed_by = null,
             auto_closed = true
       where t.origin = 'automatic'
         and t.status = 'open'
         and not exists (
           select 1 from desired d
            where d.source_table = t.source_table
              and d.source_id = t.source_id
              and d.kind = t.kind
         )
      returning t.id, t.kind
    )
    select u.id, u.kind, case when u.inserted then 'created' else 'updated' end
      from upserted u
    union all
    select c.id, c.kind, 'closed'
      from closed c;
  perform set_config('jouve.syncing_tasks', '', true);
end;
$$;

revoke all on function public.sync_automatic_tasks(date) from public, anon, authenticated;
grant execute on function public.sync_automatic_tasks(date) to service_role;

------------------------------------------------------------------------------
-- 4. ai_vehicle_activity: km driven from Strix
------------------------------------------------------------------------------

create or replace function public.ai_vehicle_activity(
  p_from date,
  p_to date,
  p_include_fuel boolean default false,
  p_include_km boolean default false,
  p_include_revenue boolean default false
)
returns table(
  vehicle_id uuid,
  patente text,
  is_active boolean,
  trips integer,
  trip_km numeric,
  trips_without_km integer,
  unassigned_revenue numeric,
  fuel_loads integer,
  fuel_liters numeric,
  odometer_start numeric,
  odometer_end numeric,
  odometer_km numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with trips_in as (
    select t.id, t.vehicle_id, t.km
    from public.trips t
    where t.trip_date between p_from and p_to
      and t.status <> 'cancelled'
  ),
  tv as (
    select
      trips_in.vehicle_id,
      count(*)::integer as n,
      coalesce(sum(trips_in.km), 0) as km,
      (count(*) filter (where trips_in.km is null))::integer as no_km
    from trips_in
    group by trips_in.vehicle_id
  ),
  fl as (
    select f.vehicle_id, count(*)::integer as n, sum(f.liters) as liters
    from public.fuel_loads f
    where p_include_fuel
      and f.load_date between p_from and p_to
    group by f.vehicle_id
  ),
  km as (
    select d.vehicle_id, sum(d.km) as km
    from public.vehicle_km_daily d
    where p_include_km
      and d.day between p_from and p_to
    group by d.vehicle_id
  ),
  rows_out as (
    select
      v.id as vehicle_id,
      v.patente,
      v.is_active,
      coalesce(tv.n, 0) as trips,
      coalesce(tv.km, 0) as trip_km,
      coalesce(tv.no_km, 0) as trips_without_km,
      null::numeric as unassigned_revenue,
      case when p_include_fuel then coalesce(fl.n, 0) end as fuel_loads,
      case when p_include_fuel then coalesce(fl.liters, 0) end as fuel_liters,
      null::numeric as odometer_start,
      null::numeric as odometer_end,
      km.km as odometer_km
    from public.vehicles v
    left join tv on tv.vehicle_id = v.id
    left join fl on fl.vehicle_id = v.id
    left join km on km.vehicle_id = v.id
    where v.is_active
       or tv.vehicle_id is not null
       or fl.vehicle_id is not null
    union all
    select
      null::uuid,
      null::text,
      null::boolean,
      tv.n,
      tv.km,
      tv.no_km,
      case when p_include_revenue then (
        select coalesce(sum(r.revenue), 0)
        from public.v_trip_revenue r
        join trips_in t on t.id = r.trip_id
        where t.vehicle_id is null
      ) end,
      null::integer,
      null::numeric,
      null::numeric,
      null::numeric,
      null::numeric
    from tv
    where tv.vehicle_id is null
  )
  select
    o.vehicle_id,
    o.patente,
    o.is_active,
    o.trips,
    o.trip_km,
    o.trips_without_km,
    round(o.unassigned_revenue, 2),
    o.fuel_loads,
    o.fuel_liters,
    o.odometer_start,
    o.odometer_end,
    o.odometer_km
  from rows_out o
  order by (o.vehicle_id is null) desc, o.trips desc, o.patente
  limit 501;
$$;

comment on function public.ai_vehicle_activity(date, date, boolean, boolean, boolean) is
  'Actividad por vehículo en un rango: viajes no cancelados, km de viajes, cargas y litros de combustible, km recorridos según Strix (odometer_km: suma de vehicle_km_daily en el rango; odometer_start/end quedan en null). Fila sin vehículo = viajes sin vehículo. SECURITY INVOKER.';

revoke all on function public.ai_vehicle_activity(date, date, boolean, boolean, boolean) from public, anon;
grant execute on function public.ai_vehicle_activity(date, date, boolean, boolean, boolean) to authenticated, service_role;

select public.sync_automatic_tasks(
  (now() at time zone 'America/Argentina/Buenos_Aires')::date);
