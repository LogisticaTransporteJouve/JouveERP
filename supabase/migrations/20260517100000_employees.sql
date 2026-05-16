-- N.1 — Employees catalog.
--
-- Single table p/ todo el personal de Jouve: choferes, administrativos,
-- mecánicos, monotributistas. No emula liquidación de sueldos completa
-- (CCT / antigüedad / aportes / contribuciones) — esa parte sigue
-- haciéndola el liquidador externo y los recibos llegan firmados de él.
--
-- Lo que sí cubre acá: identidad del empleado + datos de pago + flag
-- monotributo (si emite factura por aparte, esa factura vive en
-- `purchase_invoices` con `supplier_id` separado, no acá). Períodos de
-- liquidación mensual, planilla de pagos, vacaciones y asistencia van
-- en migraciones N.2-N.5.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Table
------------------------------------------------------------------------------
create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  legal_name         text not null,
  position           text,
  cuil               text,
  cbu                text,
  pay_frequency      text not null check (pay_frequency in (
    'semanal',
    'mensual',
    'mixto'
  )),
  -- base_salary se carga p/ administrativos (sueldo fijo mensual). Para
  -- choferes que cobran semanal, queda NULL y la planilla mensual sólo
  -- registra viáticos + extras.
  base_salary        numeric(15, 2),
  viatico_monthly    numeric(15, 2) not null default 20000,
  is_monotributo     boolean not null default false,
  hire_date          date not null,
  termination_date   date,
  notes              text,
  is_active          boolean not null default true,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint employees_cuil_format
    check (cuil is null or cuil ~ '^[0-9]{11}$'),

  constraint employees_cbu_format
    check (cbu is null or cbu ~ '^[0-9]{22}$'),

  constraint employees_termination_after_hire
    check (termination_date is null or termination_date >= hire_date),

  -- Consistencia: si tiene termination_date, no puede estar activo.
  constraint employees_inactive_when_terminated
    check (termination_date is null or is_active = false)
);

comment on table public.employees is
  'Personal de Jouve. Liquidación detallada va por liquidador externo; acá guardamos identidad + datos de pago + flags.';
comment on column public.employees.base_salary is
  'Sueldo bruto mensual. NULL para choferes que cobran semanal (sólo viáticos y extras se cargan en la planilla mensual).';
comment on column public.employees.is_monotributo is
  'true si factura como monotributista. La factura vive en purchase_invoices, no acá.';

create index employees_legal_name_idx on public.employees (legal_name);
create index employees_is_active_idx  on public.employees (is_active);
create index employees_pay_frequency_idx on public.employees (pay_frequency);
create index employees_legal_name_trgm_idx
  on public.employees using gin (lower(legal_name) gin_trgm_ops);

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.employees enable row level security;

create policy "Authenticated users with hr:read can view employees"
  on public.employees for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can insert employees"
  on public.employees for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can update employees"
  on public.employees for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

-- No delete policy: hard delete sólo vía service role cuando no hay refs.
-- Soft-delete (termination_date + is_active=false) en el resto de los casos.

------------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------------
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 4. search_employees RPC (fuzzy)
------------------------------------------------------------------------------
create or replace function public.search_employees(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int default 0,
  p_limit        int default 50
)
returns setof public.employees
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select e.*
  from public.employees e, q
  where (not p_only_active or e.is_active)
    and (
      q.needle = ''
      or lower(e.legal_name) like '%' || q.needle || '%'
      or coalesce(e.cuil, '') like q.needle || '%'
      or lower(e.legal_name) % q.needle
    )
  order by
    case when q.needle = '' then 0
         else similarity(lower(e.legal_name), q.needle)
    end desc nulls last,
    e.legal_name asc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.search_employees(text, boolean, int, int) is
  'Fuzzy employee search with offset/limit pagination. Honours RLS via security invoker.';

set row_security = on;
