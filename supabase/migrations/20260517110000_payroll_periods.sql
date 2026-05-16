-- N.2 — Períodos de liquidación + planilla mensual.
--
-- Un payroll_period por (año, mes). Al crearlo, se "sembran" entries draft
-- para todos los empleados activos con sus defaults (viático del empleado,
-- sueldo base si es admin). El usuario completa los valores que cambian
-- mes a mes: sueldo (si admin), extras con descripción libre, vacaciones
-- monto, deudas, descuento de teléfono, notas.
--
-- Cerrado el período (status='closed'), un trigger bloquea ediciones
-- posteriores tanto del header como de las entries y extras. Re-abrir
-- queda gated por hr:admin (validado en la action layer; la DB solo
-- garantiza inmutabilidad por status).
--
-- Pagos a empleados se modelan aparte en N.3 (payroll_payments + auto-
-- linked transactions).

set row_security = off;

------------------------------------------------------------------------------
-- 1. payroll_periods
------------------------------------------------------------------------------
create table public.payroll_periods (
  id          uuid primary key default gen_random_uuid(),
  year        int  not null check (year between 2020 and 2099),
  month       int  not null check (month between 1 and 12),
  status      text not null default 'draft' check (status in ('draft', 'closed')),
  notes       text,
  closed_at   timestamptz,
  closed_by   uuid references auth.users (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (year, month)
);

comment on table public.payroll_periods is
  'Período mensual de liquidación. Status driver: draft → closed. Re-open via hr:admin.';

create index payroll_periods_status_idx on public.payroll_periods (status);

------------------------------------------------------------------------------
-- 2. payroll_entries
------------------------------------------------------------------------------
create table public.payroll_entries (
  id                 uuid primary key default gen_random_uuid(),
  period_id          uuid not null references public.payroll_periods (id) on delete cascade,
  employee_id        uuid not null references public.employees (id) on delete restrict,
  sueldo_neto        numeric(15, 2) not null default 0 check (sueldo_neto >= 0),
  vacaciones_monto   numeric(15, 2) not null default 0 check (vacaciones_monto >= 0),
  viaticos           numeric(15, 2) not null default 0 check (viaticos >= 0),
  deudas             numeric(15, 2) not null default 0 check (deudas >= 0),
  telefono           numeric(15, 2) not null default 0 check (telefono >= 0),
  notes              text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (period_id, employee_id)
);

comment on table public.payroll_entries is
  'Una fila por (employee, period). Extras se guardan aparte en payroll_entry_extras.';

create index payroll_entries_period_idx on public.payroll_entries (period_id);
create index payroll_entries_employee_idx on public.payroll_entries (employee_id);

------------------------------------------------------------------------------
-- 3. payroll_entry_extras
------------------------------------------------------------------------------
create table public.payroll_entry_extras (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.payroll_entries (id) on delete cascade,
  amount      numeric(15, 2) not null check (amount > 0),
  description text not null check (length(description) between 1 and 200),
  sort_order  int not null default 0,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.payroll_entry_extras is
  'Líneas libres de extras (ej. "20% Fijo Tareas Gabriel", "Cambio funciones"). Suma en v_payroll_entries_resolved.';

create index payroll_entry_extras_entry_idx
  on public.payroll_entry_extras (entry_id);

------------------------------------------------------------------------------
-- 4. Resolved view (sums extras + computes total_a_pagar)
------------------------------------------------------------------------------
create or replace view public.v_payroll_entries_resolved as
select
  e.id,
  e.period_id,
  e.employee_id,
  e.sueldo_neto,
  coalesce(x.extras_total, 0)            as extras_total,
  e.vacaciones_monto,
  e.viaticos,
  e.deudas,
  e.telefono,
  e.sueldo_neto + coalesce(x.extras_total, 0) + e.vacaciones_monto + e.viaticos - e.deudas - e.telefono
                                          as total_a_pagar,
  e.notes,
  e.created_at,
  e.updated_at
from public.payroll_entries e
left join lateral (
  select sum(amount) as extras_total
  from public.payroll_entry_extras
  where entry_id = e.id
) x on true;

comment on view public.v_payroll_entries_resolved is
  'Entry + extras_total + total_a_pagar (sueldo + extras + vacaciones + viáticos − deudas − teléfono).';

------------------------------------------------------------------------------
-- 5. Updated_at triggers
------------------------------------------------------------------------------
create trigger payroll_periods_set_updated_at
  before update on public.payroll_periods
  for each row execute function public.set_updated_at();

create trigger payroll_entries_set_updated_at
  before update on public.payroll_entries
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 6. Immutability trigger: closed periods reject any edits to header,
-- entries, or extras.
------------------------------------------------------------------------------
create or replace function public.enforce_payroll_period_immutability()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  -- Resolver el status del período afectado según la tabla.
  if tg_table_name = 'payroll_periods' then
    -- Permitir transición closed → draft (re-abrir). La validación de
    -- permisos (hr:admin) la hace la action. Acá solo enforzamos que
    -- otros campos no cambien si quedaba cerrado.
    if old.status = 'closed' and new.status = 'closed' then
      if new.year is distinct from old.year
         or new.month is distinct from old.month then
        raise exception
          'Período cerrado (id=%): año/mes son inmutables', old.id
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entries' then
    select status into v_status
    from public.payroll_periods
    where id = coalesce(new.period_id, old.period_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar entries (period_id=%)',
        coalesce(new.period_id, old.period_id)
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entry_extras' then
    select pp.status into v_status
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
    where pe.id = coalesce(new.entry_id, old.entry_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar extras (entry_id=%)',
        coalesce(new.entry_id, old.entry_id)
        using errcode = '23514';
    end if;
    return new;
  end if;

  return new;
end;
$$;

create trigger payroll_periods_enforce_immutability
  before update on public.payroll_periods
  for each row execute function public.enforce_payroll_period_immutability();

create trigger payroll_entries_enforce_immutability
  before insert or update or delete on public.payroll_entries
  for each row execute function public.enforce_payroll_period_immutability();

create trigger payroll_entry_extras_enforce_immutability
  before insert or update or delete on public.payroll_entry_extras
  for each row execute function public.enforce_payroll_period_immutability();

------------------------------------------------------------------------------
-- 7. RLS
------------------------------------------------------------------------------
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_entry_extras enable row level security;

-- payroll_periods
create policy "hr can read periods"
  on public.payroll_periods for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can insert periods"
  on public.payroll_periods for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can update periods"
  on public.payroll_periods for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

-- payroll_entries
create policy "hr can read entries"
  on public.payroll_entries for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can write entries"
  on public.payroll_entries for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can update entries"
  on public.payroll_entries for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can delete entries"
  on public.payroll_entries for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- payroll_entry_extras
create policy "hr can read extras"
  on public.payroll_entry_extras for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can write extras"
  on public.payroll_entry_extras for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can update extras"
  on public.payroll_entry_extras for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can delete extras"
  on public.payroll_entry_extras for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

------------------------------------------------------------------------------
-- 8. RPC: seed_payroll_period — crea el período + entries draft p/ activos
------------------------------------------------------------------------------
create or replace function public.seed_payroll_period(
  p_year  int,
  p_month int
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_period_id uuid;
  v_actor     uuid := auth.uid();
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para crear períodos de liquidación.'
      using errcode = '42501';
  end if;

  -- Idempotencia: si ya existe, devuelve su id.
  select id into v_period_id
  from public.payroll_periods
  where year = p_year and month = p_month;

  if v_period_id is not null then
    return v_period_id;
  end if;

  insert into public.payroll_periods (year, month, created_by)
  values (p_year, p_month, v_actor)
  returning id into v_period_id;

  -- Seed entries con defaults: viatico_monthly del empleado, sueldo base
  -- si admin (mensual / mixto), 0 para los demás campos.
  insert into public.payroll_entries (
    period_id, employee_id, sueldo_neto, viaticos, created_by
  )
  select
    v_period_id,
    e.id,
    case when e.pay_frequency in ('mensual', 'mixto') then coalesce(e.base_salary, 0)
         else 0
    end,
    coalesce(e.viatico_monthly, 0),
    v_actor
  from public.employees e
  where e.is_active = true;

  return v_period_id;
end;
$$;

comment on function public.seed_payroll_period(int, int) is
  'Crea (idempotentemente) el período + entries draft p/ activos. Defaults: viático del empleado, sueldo si mensual/mixto.';

set row_security = on;
