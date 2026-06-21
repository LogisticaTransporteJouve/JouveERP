-- Fase R — Pagos recurrentes (recurring_payments).
--
-- Compromisos de egreso que se repiten: alquiler, servicios, préstamos,
-- impuestos y sueldos fijos. Es una feature CRUD normal (no IA) y el INSUMO del
-- cash-flow proyectado de AI.5 — sin estos datos la proyección de caja ignora
-- una porción grande de los egresos reales. docs/roadmap.md Fase R.

set row_security = off;

create table public.recurring_payments (
  id             uuid primary key default gen_random_uuid(),
  description    text not null,
  category       text not null
                   check (category in ('alquiler', 'servicios', 'prestamo', 'impuesto', 'sueldo', 'otro')),
  amount         numeric(14, 2) not null check (amount > 0),
  currency       text not null default 'ARS' check (currency in ('ARS', 'USD')),
  frequency      text not null
                   check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_date  date not null,
  end_date       date,
  account_id     uuid references public.accounts (id) on delete set null,
  channel_id     text references public.invoicing_channels (id) on delete set null,
  cost_center_id uuid references public.cost_centers (id) on delete set null,
  is_active      boolean not null default true,
  notes          text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint recurring_payments_end_after_next
    check (end_date is null or end_date >= next_due_date)
);

comment on table public.recurring_payments is
  'Pagos recurrentes (alquiler, servicios, préstamos, impuestos, sueldos fijos). Insumo del cash-flow proyectado de la IA (AI.5).';

create index recurring_payments_active_due_idx
  on public.recurring_payments (is_active, next_due_date);

create trigger recurring_payments_set_updated_at
  before update on public.recurring_payments
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- RLS — gestión por owner/admin/finance (recurring_payments:read/write).
------------------------------------------------------------------------------
alter table public.recurring_payments enable row level security;

create policy "recurring_payments select"
  on public.recurring_payments for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "recurring_payments insert"
  on public.recurring_payments for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "recurring_payments update"
  on public.recurring_payments for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "recurring_payments delete"
  on public.recurring_payments for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
