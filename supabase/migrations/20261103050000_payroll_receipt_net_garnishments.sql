SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Sueldos reales (roadmap 3.1 + 3.2, decision D5): the liquidador's receipt,
-- formal employee data and garnishments.
--
--   1. employees: formal data the liquidador uses (convenio, categoría, obra
--      social, ART, retribución formal). All nullable; nothing reads them for
--      the totals.
--   2. payroll_entries.recibo_neto: the net of the liquidador's receipt. NULL
--      (every existing row) keeps today's behaviour; the app shows "Otros" =
--      sueldo pactado − recibo and suggests transferencia = recibo − embargo −
--      descuentos, efectivo = the rest.
--   3. payroll_entries.embargo + employee_garnishments: a garnishment
--      (percentage of the receipt net, or of the agreed salary while there is
--      no receipt, or a fixed amount) active between two dates. While one is
--      active for the entry's month, inserting the entry or changing its
--      salary or receipt sets embargo; a garnishment written or deleted
--      refreshes the entries of the draft periods. A closed period keeps what
--      it had. embargo stays editable by hand.
--   4. v_payroll_entries_resolved / v_payroll_entries_with_payments:
--      total_a_pagar also subtracts embargo (0 on every existing row, so the
--      totals do not move); recibo_neto, embargo and the amount paid per
--      method are appended, so older code reading the views by name still
--      works.
--   5. ai_payroll_concepts lists embargo as a deduction; ai_payroll_summary
--      returns it (same parameters, one more column).
--
-- Payroll payments and their posting are unchanged: the garnishment is a
-- deduction of the planilla, not a payment.

-- 1. Formal employee data -------------------------------------------------------

alter table public.employees
  add column convenio text,
  add column categoria text,
  add column obra_social text,
  add column art text,
  add column retribucion_formal numeric(15, 2);

alter table public.employees
  -- squawk-ignore constraint-missing-not-valid
  add constraint employees_formal_text_length check (
    coalesce(length(convenio), 0) <= 120
    and coalesce(length(categoria), 0) <= 120
    and coalesce(length(obra_social), 0) <= 120
    and coalesce(length(art), 0) <= 120
  ),
  -- squawk-ignore constraint-missing-not-valid
  add constraint employees_retribucion_formal_nonnegative check (
    retribucion_formal is null or retribucion_formal >= 0
  );

comment on column public.employees.convenio is 'Convenio colectivo del recibo formal (lo informa el liquidador).';
comment on column public.employees.categoria is 'Categoría del convenio en el recibo formal.';
comment on column public.employees.obra_social is 'Obra social del empleado.';
comment on column public.employees.art is 'Aseguradora de riesgos del trabajo.';
comment on column public.employees.retribucion_formal is 'Retribución formal (bruta) del recibo del liquidador. Solo informativa.';

-- 2 + 3. Receipt net and garnishment on the entry -------------------------------

alter table public.payroll_entries
  add column recibo_neto numeric(15, 2),
  add column embargo numeric(15, 2) not null default 0;

alter table public.payroll_entries
  -- squawk-ignore constraint-missing-not-valid
  add constraint payroll_entries_recibo_neto_nonnegative check (recibo_neto is null or recibo_neto >= 0),
  -- squawk-ignore constraint-missing-not-valid
  add constraint payroll_entries_embargo_nonnegative check (embargo >= 0);

comment on column public.payroll_entries.recibo_neto is
  'Neto del recibo del liquidador. NULL = sin recibo cargado (la planilla se comporta como antes).';
comment on column public.payroll_entries.embargo is
  'Descuento por embargo del período. Lo calcula employee_garnishments mientras haya uno vigente; editable.';

create table public.employee_garnishments (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete restrict,
  mode         text not null check (mode in ('percentage', 'fixed')),
  percentage   numeric(5, 2) check (percentage > 0 and percentage <= 100),
  amount       numeric(15, 2) check (amount > 0),
  active_from  date not null,
  active_to    date,
  beneficiary  text check (length(beneficiary) <= 200),
  court_note   text check (length(court_note) <= 500),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint employee_garnishments_mode_value check (
    (mode = 'percentage' and percentage is not null and amount is null)
    or (mode = 'fixed' and amount is not null and percentage is null)
  ),
  constraint employee_garnishments_range check (active_to is null or active_to >= active_from)
);

comment on table public.employee_garnishments is
  'Embargos sobre el sueldo: porcentaje del neto del recibo (o del sueldo pactado sin recibo) o monto fijo, vigente entre dos fechas. Se descuenta en payroll_entries.embargo.';

create index employee_garnishments_employee_idx
  on public.employee_garnishments (employee_id, active_from);

create trigger employee_garnishments_set_updated_at
  before update on public.employee_garnishments
  for each row execute function public.set_updated_at();

alter table public.employee_garnishments enable row level security;

create policy "hr can read garnishments"
  on public.employee_garnishments for select
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can insert garnishments"
  on public.employee_garnishments for insert
  to authenticated
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can update garnishments"
  on public.employee_garnishments for update
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can delete garnishments"
  on public.employee_garnishments for delete
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.employee_garnishments from public, anon;

-- Garnishment of an employee for a period's month over a base (the receipt
-- net, or the agreed salary without one). NULL when none is active that
-- month, so callers can tell "no garnishment" from "garnishment of 0".
create function public.payroll_garnishment_amount(
  p_employee_id uuid,
  p_period_id uuid,
  p_base numeric
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else sum(
                case when g.mode = 'percentage'
                     then round(greatest(coalesce(p_base, 0), 0) * g.percentage / 100, 2)
                     else g.amount
                end)
         end
  from public.employee_garnishments g
  join public.payroll_periods pp on pp.id = p_period_id
  where g.employee_id = p_employee_id
    and g.active_from <= (make_date(pp.year, pp.month, 1) + interval '1 month' - interval '1 day')::date
    and (g.active_to is null or g.active_to >= make_date(pp.year, pp.month, 1));
$$;

comment on function public.payroll_garnishment_amount(uuid, uuid, numeric) is
  'Embargo del empleado para el mes del período sobre la base dada; NULL si no hay embargo vigente. Security invoker.';

revoke all on function public.payroll_garnishment_amount(uuid, uuid, numeric) from public, anon;
grant execute on function public.payroll_garnishment_amount(uuid, uuid, numeric) to authenticated, service_role;

create function public.payroll_entry_apply_garnishment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  if tg_op = 'UPDATE'
     and new.sueldo_neto is not distinct from old.sueldo_neto
     and new.recibo_neto is not distinct from old.recibo_neto then
    return new;
  end if;
  v_amount := public.payroll_garnishment_amount(
    new.employee_id, new.period_id, coalesce(new.recibo_neto, new.sueldo_neto)
  );
  if v_amount is not null then
    new.embargo := v_amount;
  end if;
  return new;
end;
$$;

revoke all on function public.payroll_entry_apply_garnishment() from public, anon;

create trigger payroll_entries_apply_garnishment
  before insert or update of sueldo_neto, recibo_neto on public.payroll_entries
  for each row execute function public.payroll_entry_apply_garnishment();

create function public.employee_garnishment_refresh_entries()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_employee uuid := coalesce(new.employee_id, old.employee_id);
begin
  update public.payroll_entries pe
     set embargo = coalesce(
           public.payroll_garnishment_amount(pe.employee_id, pe.period_id, coalesce(pe.recibo_neto, pe.sueldo_neto)),
           0)
    from public.payroll_periods pp
   where pp.id = pe.period_id
     and pp.status = 'draft'
     and pe.employee_id in (v_employee, old.employee_id);
  return null;
end;
$$;

revoke all on function public.employee_garnishment_refresh_entries() from public, anon;

create trigger employee_garnishments_refresh_entries
  after insert or update or delete on public.employee_garnishments
  for each row execute function public.employee_garnishment_refresh_entries();

-- 4. Views -------------------------------------------------------------------------

create or replace view public.v_payroll_entries_resolved
with (security_invoker = on) as
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
  e.sueldo_neto + coalesce(x.extras_total, 0) + e.vacaciones_monto + e.viaticos
    - e.deudas - e.telefono - e.embargo   as total_a_pagar,
  e.notes,
  e.created_at,
  e.updated_at,
  e.recibo_neto,
  e.embargo
from public.payroll_entries e
left join lateral (
  select sum(amount) as extras_total
  from public.payroll_entry_extras
  where entry_id = e.id
) x on true;

comment on view public.v_payroll_entries_resolved is
  'Entry + extras_total + total_a_pagar (sueldo + extras + vacaciones + viáticos − deudas − teléfono − embargo).';

create or replace view public.v_payroll_entries_with_payments
with (security_invoker = on) as
select
  r.id,
  r.period_id,
  r.employee_id,
  r.sueldo_neto,
  r.extras_total,
  r.vacaciones_monto,
  r.viaticos,
  r.deudas,
  r.telefono,
  r.total_a_pagar,
  coalesce(p.paid_total, 0)                  as paid_total,
  r.total_a_pagar - coalesce(p.paid_total, 0) as saldo,
  coalesce(p.payments_count, 0)              as payments_count,
  r.notes,
  r.created_at,
  r.updated_at,
  r.recibo_neto,
  r.embargo,
  coalesce(p.paid_transferencia, 0)          as paid_transferencia,
  coalesce(p.paid_efectivo, 0)               as paid_efectivo
from public.v_payroll_entries_resolved r
left join lateral (
  select sum(amount) as paid_total,
         count(*)::int as payments_count,
         sum(amount) filter (where method = 'transferencia') as paid_transferencia,
         sum(amount) filter (where method = 'efectivo') as paid_efectivo
  from public.payroll_payments
  where entry_id = r.id
) p on true;

comment on view public.v_payroll_entries_with_payments is
  'Entry resolved + paid_total y saldo (total_a_pagar − paid_total), y lo pagado por método.';

-- 5. AI aggregates -------------------------------------------------------------------

create or replace function public.ai_payroll_concepts(
  p_from_period text,
  p_to_period text,
  p_drivers_only boolean default false
)
returns table(
  concept text,
  kind text,
  amount numeric,
  entries integer,
  employees integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ent as (
    select pe.id, pe.employee_id, pe.sueldo_neto, pe.vacaciones_monto, pe.viaticos, pe.deudas,
           pe.telefono, pe.embargo
    from public.payroll_periods pp
    join public.payroll_entries pe on pe.period_id = pp.id
    join public.employees e on e.id = pe.employee_id
    where to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') between p_from_period and p_to_period
      and (
        not p_drivers_only
        or e.pay_frequency = 'semanal'
        or public.is_driver_employee(e.id)
      )
  ),
  concept_lines as (
    select v.concept, 'fijo'::text as kind, v.amount, ent.id as entry_id, ent.employee_id
    from ent
    cross join lateral (
      values
        ('sueldo_neto', ent.sueldo_neto),
        ('vacaciones', ent.vacaciones_monto),
        ('viaticos', ent.viaticos),
        ('deudas', -ent.deudas),
        ('telefono', -ent.telefono),
        ('embargo', -ent.embargo)
    ) as v(concept, amount)
    where v.amount <> 0
    union all
    select lower(btrim(x.description)), 'extra'::text, x.amount, ent.id, ent.employee_id
    from ent
    join public.payroll_entry_extras x on x.entry_id = ent.id
  )
  select
    cl.concept,
    cl.kind,
    sum(cl.amount),
    count(distinct cl.entry_id)::integer,
    count(distinct cl.employee_id)::integer
  from concept_lines cl
  group by cl.concept, cl.kind
  order by cl.kind desc, abs(sum(cl.amount)) desc
  limit 200;
$$;

-- squawk-ignore ban-drop-function
drop function public.ai_payroll_summary(text, text, text, uuid, boolean);

create function public.ai_payroll_summary(
  p_from_period text,
  p_to_period text,
  p_group_by text default 'month',
  p_employee_id uuid default null,
  p_is_fiscal boolean default null
)
returns table(
  group_key text,
  label text,
  periods integer,
  employees integer,
  sueldo_neto numeric,
  extras numeric,
  vacaciones numeric,
  viaticos numeric,
  deudas numeric,
  telefono numeric,
  total_a_pagar numeric,
  paid numeric,
  saldo numeric,
  embargo numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sel_periods as (
    select pp.id, to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') as period
    from public.payroll_periods pp
    where to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') between p_from_period and p_to_period
  ),
  ent as (
    select
      p.period,
      r.employee_id,
      e.legal_name,
      r.sueldo_neto,
      r.extras_total,
      r.vacaciones_monto,
      r.viaticos,
      r.deudas,
      r.telefono,
      r.embargo,
      r.total_a_pagar,
      case when p_is_fiscal is null then r.paid_total else coalesce(sp.paid, 0) end as paid_total,
      r.saldo
    from sel_periods p
    join public.v_payroll_entries_with_payments r on r.period_id = p.id
    join public.employees e on e.id = r.employee_id
    left join lateral (
      select sum(pay.amount) as paid
      from public.payroll_payments pay
      join public.invoicing_channels c on c.id = pay.channel_id
      where p_is_fiscal is not null
        and pay.entry_id = r.id
        and c.is_fiscal = p_is_fiscal
    ) sp on true
    where p_employee_id is null or r.employee_id = p_employee_id
  )
  select
    case when p_group_by = 'employee' then ent.employee_id::text else ent.period end,
    case when p_group_by = 'employee' then ent.legal_name else ent.period end,
    count(distinct ent.period)::integer,
    count(distinct ent.employee_id)::integer,
    coalesce(sum(ent.sueldo_neto), 0),
    coalesce(sum(ent.extras_total), 0),
    coalesce(sum(ent.vacaciones_monto), 0),
    coalesce(sum(ent.viaticos), 0),
    coalesce(sum(ent.deudas), 0),
    coalesce(sum(ent.telefono), 0),
    coalesce(sum(ent.total_a_pagar), 0),
    coalesce(sum(ent.paid_total), 0),
    coalesce(sum(ent.saldo), 0),
    coalesce(sum(ent.embargo), 0)
  from ent
  group by 1, 2
  order by
    case when p_group_by = 'employee' then coalesce(sum(ent.total_a_pagar), 0) else 0 end desc,
    1;
$$;

revoke all on function public.ai_payroll_summary(text, text, text, uuid, boolean) from public, anon;
grant execute on function public.ai_payroll_summary(text, text, text, uuid, boolean) to authenticated, service_role;
comment on function public.ai_payroll_summary(text, text, text, uuid, boolean) is
  'Payroll totals per month or per employee (net salary, extras, vacation pay, viaticos, deductions incl. embargo, total, paid, balance). p_is_fiscal scopes the payments (paid). Security invoker.';
