-- N.4 — Vacaciones y balances anuales (LCT Argentina).
--
-- Dos tablas:
--   * employee_leaves: fechas concretas de licencias (vacaciones,
--     enfermedad, franco, otro). Días corridos = end_date − start_date + 1.
--   * employee_vacation_balances: 1 row por (empleado, año_aniversario).
--     entitled_days según LCT Art. 150 (14/21/28/35 según antigüedad).
--     Renovación anual el 1° de octubre; el período se "abre" para
--     tomar entre 1-oct-N y 30-abr-{N+1}.
--
-- Política Jouve: días no usados al 30/4 se ARRASTRAN al próximo
-- período (carryover_days). Configurable via hr_settings(key='vacation_carryover').
--
-- Trigger sobre employee_leaves(kind='vacaciones'): sincroniza
-- used_days en la balance activa del empleado. FIFO si hay múltiples.
--
-- Cron Inngest "vacation-balances-grant" corre 1-oct: para cada empleado
-- activo determina entitled_days (con prorating Art. 153 si tiene <6
-- meses); inserta balance del año + arrastra remainder del anterior.

set row_security = off;

------------------------------------------------------------------------------
-- 1. hr_settings (simple key/value table for config)
------------------------------------------------------------------------------
create table public.hr_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.hr_settings is
  'Config global de HR. key/value, jsonb p/ flexibilidad. Hoy: vacation_carryover.';

insert into public.hr_settings (key, value) values
  ('vacation_carryover', to_jsonb(true))
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 2. employee_leaves
------------------------------------------------------------------------------
create type public.leave_kind as enum (
  'vacaciones',
  'enfermedad',
  'franco',
  'maternidad',
  'paternidad',
  'otro'
);

create table public.employee_leaves (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  days        int generated always as ((end_date - start_date) + 1) stored,
  kind        public.leave_kind not null,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint employee_leaves_end_after_start
    check (end_date >= start_date)
);

comment on table public.employee_leaves is
  'Licencias concretas con fechas. Días corridos LCT (end − start + 1).';

create index employee_leaves_employee_idx on public.employee_leaves (employee_id);
create index employee_leaves_kind_idx on public.employee_leaves (kind);
create index employee_leaves_dates_idx on public.employee_leaves (start_date, end_date);

create trigger employee_leaves_set_updated_at
  before update on public.employee_leaves
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 3. employee_vacation_balances
------------------------------------------------------------------------------
create table public.employee_vacation_balances (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  period_year     int  not null check (period_year between 2020 and 2099),
  entitled_days   int  not null default 0 check (entitled_days >= 0),
  bonus_days      int  not null default 0 check (bonus_days >= 0),
  carryover_days  int  not null default 0 check (carryover_days >= 0),
  used_days       int  not null default 0 check (used_days >= 0),
  granted_at      date not null,
  expires_at      date not null,
  status          text not null default 'active'
                    check (status in ('active', 'expired', 'extended')),
  notes           text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (employee_id, period_year)
);

comment on table public.employee_vacation_balances is
  '1 row por (empleado, año_aniversario). Saldo = entitled + bonus + carryover − used.';

create index employee_vacation_balances_employee_idx
  on public.employee_vacation_balances (employee_id);
create index employee_vacation_balances_status_idx
  on public.employee_vacation_balances (status);

create trigger employee_vacation_balances_set_updated_at
  before update on public.employee_vacation_balances
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 4. View: saldo computado
------------------------------------------------------------------------------
create or replace view public.v_employee_vacation_balances as
select
  b.*,
  (b.entitled_days + b.bonus_days + b.carryover_days - b.used_days) as remaining_days
from public.employee_vacation_balances b;

comment on view public.v_employee_vacation_balances is
  'Balance + remaining_days computado (entitled + bonus + carryover − used).';

------------------------------------------------------------------------------
-- 5. Trigger: sync used_days desde leaves(kind='vacaciones')
------------------------------------------------------------------------------
-- FIFO: descontar primero de la balance más vieja con saldo positivo.
-- Si no alcanza, deja used_days que supere entitled (queda en negativo
-- vía remaining_days; admin decide qué hacer).
create or replace function public.sync_vacation_balance_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_days_delta  int;
  v_days_left   int;
  v_balance     record;
begin
  if tg_op = 'INSERT' then
    if new.kind <> 'vacaciones' then return new; end if;
    v_employee_id := new.employee_id;
    v_days_delta := new.days;
  elsif tg_op = 'UPDATE' then
    -- Si cambia el kind a/desde 'vacaciones' o cambian las fechas,
    -- revertir el viejo y aplicar el nuevo.
    if old.kind = 'vacaciones' then
      perform public.apply_vacation_delta(old.employee_id, -old.days);
    end if;
    if new.kind = 'vacaciones' then
      perform public.apply_vacation_delta(new.employee_id, new.days);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.kind = 'vacaciones' then
      perform public.apply_vacation_delta(old.employee_id, -old.days);
    end if;
    return old;
  else
    return null;
  end if;

  perform public.apply_vacation_delta(v_employee_id, v_days_delta);
  return new;
end;
$$;

-- Helper que distribuye un delta (positivo o negativo) FIFO entre los
-- balances del empleado. delta positivo = consume días (used_days++);
-- delta negativo = devuelve días (used_days−−).
create or replace function public.apply_vacation_delta(
  p_employee_id uuid,
  p_delta       int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int := p_delta;
  v_balance   record;
  v_avail     int;
  v_take      int;
begin
  if p_delta = 0 then return; end if;

  if p_delta > 0 then
    -- Consumir: descontar de balances activas/extended, más vieja primero.
    for v_balance in
      select id, entitled_days, bonus_days, carryover_days, used_days
      from public.employee_vacation_balances
      where employee_id = p_employee_id
        and status in ('active', 'extended')
      order by period_year asc
    loop
      v_avail := (v_balance.entitled_days + v_balance.bonus_days + v_balance.carryover_days) - v_balance.used_days;
      if v_avail <= 0 then continue; end if;
      v_take := least(v_remaining, v_avail);
      update public.employee_vacation_balances
         set used_days = used_days + v_take
       where id = v_balance.id;
      v_remaining := v_remaining - v_take;
      if v_remaining <= 0 then return; end if;
    end loop;
    -- Si sobra delta y no hay capacidad, lo apilamos en la balance más
    -- reciente como sobreuso (queda con remaining_days negativo).
    if v_remaining > 0 then
      update public.employee_vacation_balances
         set used_days = used_days + v_remaining
       where id = (
         select id from public.employee_vacation_balances
         where employee_id = p_employee_id
         order by period_year desc
         limit 1
       );
    end if;
  else
    -- Devolver: descontar de used_days, más reciente primero (LIFO),
    -- nunca pasar abajo de 0.
    for v_balance in
      select id, used_days
      from public.employee_vacation_balances
      where employee_id = p_employee_id
        and status in ('active', 'extended')
      order by period_year desc
    loop
      if v_balance.used_days <= 0 then continue; end if;
      v_take := least(-v_remaining, v_balance.used_days);
      update public.employee_vacation_balances
         set used_days = used_days - v_take
       where id = v_balance.id;
      v_remaining := v_remaining + v_take;
      if v_remaining >= 0 then return; end if;
    end loop;
  end if;
end;
$$;

create trigger employee_leaves_sync_vacation_balance
  after insert or update or delete on public.employee_leaves
  for each row execute function public.sync_vacation_balance_used();

------------------------------------------------------------------------------
-- 6. RPC: grant_vacation_balances — runs every year on 1-oct
------------------------------------------------------------------------------
-- Idempotente: si la balance del (employee, period_year) ya existe, la
-- saltea. Aplica:
--   * entitled_days según antigüedad al 31-dic de period_year
--   * Prorating Art. 153 si hire_date está dentro del año (< 6 meses)
--   * carryover_days = remaining_days del período anterior si la
--     política vacation_carryover está activa
--   * granted_at = today, expires_at = 30-abr del año siguiente
--   * Marca status='expired' las balances pasadas con expires_at < today
create or replace function public.grant_vacation_balances(
  p_target_year int default extract(year from now())::int,
  p_carryover   boolean default true
)
returns table (employee_id uuid, balance_id uuid, entitled_days int, carryover_days int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp           record;
  v_anios         int;
  v_entitled      int;
  v_prev_balance  record;
  v_carry         int;
  v_balance_id    uuid;
  v_granted_at    date := make_date(p_target_year, 10, 1);
  v_expires_at    date := make_date(p_target_year + 1, 4, 30);
  v_dec31         date := make_date(p_target_year, 12, 31);
begin
  -- Expira balances vencidas con fecha anterior a hoy (excepto extended).
  update public.employee_vacation_balances
     set status = 'expired'
   where status = 'active'
     and expires_at < current_date;

  for v_emp in
    select id, hire_date
    from public.employees
    where is_active = true
  loop
    -- Si ya existe la balance del año, saltear (idempotencia).
    if exists (
      select 1 from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year
    ) then
      continue;
    end if;

    v_anios := extract(year from age(v_dec31, v_emp.hire_date))::int;

    -- Prorating Art. 153: si el empleado tiene <6 meses al 31-dic, le
    -- corresponde 1 día cada 20 trabajados.
    if v_emp.hire_date > make_date(p_target_year, 7, 1) then
      v_entitled := greatest(0, ((v_dec31 - v_emp.hire_date) / 20)::int);
    elsif v_anios < 5 then
      v_entitled := 14;
    elsif v_anios < 10 then
      v_entitled := 21;
    elsif v_anios < 20 then
      v_entitled := 28;
    else
      v_entitled := 35;
    end if;

    -- Carryover del período anterior.
    v_carry := 0;
    if p_carryover then
      select id,
             (entitled_days + bonus_days + carryover_days - used_days) as remaining
        into v_prev_balance
      from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year - 1
      order by period_year desc
      limit 1;

      if found and v_prev_balance.remaining > 0 then
        v_carry := v_prev_balance.remaining;
      end if;
    end if;

    insert into public.employee_vacation_balances (
      employee_id, period_year, entitled_days, carryover_days,
      granted_at, expires_at, status, created_by
    )
    values (
      v_emp.id, p_target_year, v_entitled, v_carry,
      v_granted_at, v_expires_at, 'active', auth.uid()
    )
    returning id into v_balance_id;

    employee_id    := v_emp.id;
    balance_id     := v_balance_id;
    entitled_days  := v_entitled;
    carryover_days := v_carry;
    return next;
  end loop;
end;
$$;

comment on function public.grant_vacation_balances(int, boolean) is
  'Otorga balances anuales (1-oct). Idempotente. Aplica prorating Art. 153 si hire_date <6m. carryover de remaining del año anterior si vacation_carryover=true.';

revoke all on function public.grant_vacation_balances(int, boolean) from public;
grant execute on function public.grant_vacation_balances(int, boolean) to service_role;
grant execute on function public.grant_vacation_balances(int, boolean) to authenticated;

------------------------------------------------------------------------------
-- 7. RLS
------------------------------------------------------------------------------
alter table public.employee_leaves enable row level security;
alter table public.employee_vacation_balances enable row level security;
alter table public.hr_settings enable row level security;

create policy "hr can read leaves"
  on public.employee_leaves for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr can write leaves"
  on public.employee_leaves for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr can update leaves"
  on public.employee_leaves for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr can delete leaves"
  on public.employee_leaves for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can read balances"
  on public.employee_vacation_balances for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr admin can write balances"
  on public.employee_vacation_balances for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin']));
create policy "hr admin can update balances"
  on public.employee_vacation_balances for update to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

create policy "hr can read settings"
  on public.hr_settings for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr admin can update settings"
  on public.hr_settings for update to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

set row_security = on;
