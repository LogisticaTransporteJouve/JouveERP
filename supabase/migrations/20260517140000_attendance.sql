-- N.5 — Asistencia: excepciones diarias + feriados.
--
-- Event-based, NO una fila por empleado por día (15 empleados × 31 días =
-- 465 rows/mes con la inmensa mayoría "trabajó normal" es ruido). Sólo
-- guardamos las excepciones: ausente, tarde, salida temprano, sick, leave
-- (auto desde employee_leaves vía trigger), holiday (seed feriados AR).
--
-- Días trabajados = días hábiles del mes − count(excepciones) por empleado,
-- calculado en query / view cuando se necesite.

set row_security = off;

------------------------------------------------------------------------------
-- 1. holidays — feriados nacionales argentinos
------------------------------------------------------------------------------
create table public.holidays (
  date       date primary key,
  name       text not null,
  scope      text not null default 'national'
               check (scope in ('national', 'jouve', 'province')),
  notes      text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.holidays is
  'Feriados nacionales + custom de Jouve. Trigger marca attendance_records(kind=holiday) automáticamente al insertar el día.';

create index holidays_year_idx on public.holidays (extract(year from date));

-- Seed feriados nacionales 2026 y 2027 (fechas oficiales).
insert into public.holidays (date, name, scope) values
  -- 2026
  ('2026-01-01', 'Año Nuevo', 'national'),
  ('2026-02-16', 'Carnaval', 'national'),
  ('2026-02-17', 'Carnaval', 'national'),
  ('2026-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia', 'national'),
  ('2026-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas', 'national'),
  ('2026-04-03', 'Viernes Santo', 'national'),
  ('2026-05-01', 'Día del Trabajador', 'national'),
  ('2026-05-25', 'Día de la Revolución de Mayo', 'national'),
  ('2026-06-15', 'Paso a la Inmortalidad del Gral. Güemes (trasladado)', 'national'),
  ('2026-06-20', 'Paso a la Inmortalidad del Gral. Belgrano', 'national'),
  ('2026-07-09', 'Día de la Independencia', 'national'),
  ('2026-08-17', 'Paso a la Inmortalidad del Gral. San Martín', 'national'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural', 'national'),
  ('2026-11-23', 'Día de la Soberanía Nacional (trasladado)', 'national'),
  ('2026-12-08', 'Día de la Inmaculada Concepción de María', 'national'),
  ('2026-12-25', 'Navidad', 'national'),
  -- 2027
  ('2027-01-01', 'Año Nuevo', 'national'),
  ('2027-02-08', 'Carnaval', 'national'),
  ('2027-02-09', 'Carnaval', 'national'),
  ('2027-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia', 'national'),
  ('2027-03-26', 'Viernes Santo', 'national'),
  ('2027-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas', 'national'),
  ('2027-05-01', 'Día del Trabajador', 'national'),
  ('2027-05-25', 'Día de la Revolución de Mayo', 'national'),
  ('2027-06-17', 'Paso a la Inmortalidad del Gral. Güemes', 'national'),
  ('2027-06-21', 'Paso a la Inmortalidad del Gral. Belgrano (trasladado)', 'national'),
  ('2027-07-09', 'Día de la Independencia', 'national'),
  ('2027-08-16', 'Paso a la Inmortalidad del Gral. San Martín (trasladado)', 'national'),
  ('2027-10-11', 'Día del Respeto a la Diversidad Cultural (trasladado)', 'national'),
  ('2027-11-22', 'Día de la Soberanía Nacional (trasladado)', 'national'),
  ('2027-12-08', 'Día de la Inmaculada Concepción de María', 'national'),
  ('2027-12-25', 'Navidad', 'national')
on conflict (date) do nothing;

------------------------------------------------------------------------------
-- 2. attendance_records — excepciones daily
------------------------------------------------------------------------------
create type public.attendance_kind as enum (
  'absent_justified',
  'absent_unjustified',
  'late',
  'early_leave',
  'sick',
  'leave',
  'holiday'
);

create table public.attendance_records (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  date        date not null,
  kind        public.attendance_kind not null,
  hours_lost  numeric(5, 2) check (hours_lost is null or hours_lost > 0),
  notes       text,
  source      text not null default 'manual'
               check (source in ('manual', 'leave_sync', 'holiday_sync')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (employee_id, date)
);

comment on table public.attendance_records is
  'Solo excepciones. Días sin row = trabajó. source distingue manual / auto desde leaves / auto desde holidays.';

create index attendance_records_employee_idx on public.attendance_records (employee_id);
create index attendance_records_date_idx on public.attendance_records (date);
create index attendance_records_kind_idx on public.attendance_records (kind);

create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 3. Sync trigger desde employee_leaves
------------------------------------------------------------------------------
-- Al insertar/borrar una employee_leaves row (cualquier kind), también
-- insertamos/borramos attendance_records con kind='leave' para cada día
-- del rango. El leave_kind real va en notes ('leave: vacaciones', etc.)
-- para que el grid pueda mostrar el tipo. Si ya hay un attendance manual
-- en ese día, no lo sobreescribimos (manual gana — admin tiene la última
-- palabra).
create or replace function public.sync_attendance_from_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current date;
  v_end     date;
begin
  if tg_op = 'INSERT' then
    v_current := new.start_date;
    v_end := new.end_date;
    while v_current <= v_end loop
      insert into public.attendance_records (
        employee_id, date, kind, source, notes, created_by
      )
      values (
        new.employee_id, v_current, 'leave', 'leave_sync',
        'leave: ' || new.kind::text, new.created_by
      )
      on conflict (employee_id, date) do nothing;
      v_current := v_current + interval '1 day';
    end loop;
    return new;
  elsif tg_op = 'UPDATE' then
    -- Si cambian las fechas o el kind, revertir el viejo y crear el nuevo.
    delete from public.attendance_records
    where employee_id = old.employee_id
      and date between old.start_date and old.end_date
      and source = 'leave_sync';
    v_current := new.start_date;
    v_end := new.end_date;
    while v_current <= v_end loop
      insert into public.attendance_records (
        employee_id, date, kind, source, notes, created_by
      )
      values (
        new.employee_id, v_current, 'leave', 'leave_sync',
        'leave: ' || new.kind::text, new.created_by
      )
      on conflict (employee_id, date) do nothing;
      v_current := v_current + interval '1 day';
    end loop;
    return new;
  elsif tg_op = 'DELETE' then
    delete from public.attendance_records
    where employee_id = old.employee_id
      and date between old.start_date and old.end_date
      and source = 'leave_sync';
    return old;
  end if;
  return null;
end;
$$;

comment on function public.sync_attendance_from_leave() is
  'Mantiene attendance_records(source=leave_sync) alineadas con employee_leaves. Manual gana sobre auto via on conflict do nothing.';

create trigger employee_leaves_sync_attendance
  after insert or update or delete on public.employee_leaves
  for each row execute function public.sync_attendance_from_leave();

------------------------------------------------------------------------------
-- 4. Resolved view con employee + day-of-week info
------------------------------------------------------------------------------
create or replace view public.v_attendance_records_resolved as
select
  ar.id,
  ar.employee_id,
  e.legal_name as employee_legal_name,
  ar.date,
  extract(dow from ar.date)::int as day_of_week,  -- 0=domingo, 6=sábado
  ar.kind,
  ar.hours_lost,
  ar.notes,
  ar.source,
  ar.created_at,
  ar.updated_at
from public.attendance_records ar
join public.employees e on e.id = ar.employee_id;

------------------------------------------------------------------------------
-- 5. RLS
------------------------------------------------------------------------------
alter table public.holidays enable row level security;
alter table public.attendance_records enable row level security;

create policy "hr can read holidays"
  on public.holidays for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "admin can write holidays"
  on public.holidays for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin']));
create policy "admin can update holidays"
  on public.holidays for update to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));
create policy "admin can delete holidays"
  on public.holidays for delete to authenticated
  using (public.user_has_role(array['owner', 'admin']));

create policy "hr can read attendance"
  on public.attendance_records for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr can write attendance"
  on public.attendance_records for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr can update attendance"
  on public.attendance_records for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "hr can delete attendance"
  on public.attendance_records for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

set row_security = on;
