-- K.6 — Cheques propios emitidos.
--
-- Tabla separada de `checks` (que modela los recibidos). Acá viven los
-- cheques que NOSOTROS emitimos para pagar proveedores. Diferencia clave:
--   * En `checks` el flujo es: cobramos → cartera → depositar → acreditar.
--   * En `issued_checks` el flujo es: emitimos → entregamos al proveedor
--     → el proveedor cobra → status=cashed (o rechazado).
--
-- Scope mínimo: alta manual + estado. El movimiento de caja se hace via
-- la OP/transaction como cualquier otro pago — el `issued_check` es
-- informativo (para que el contador vea qué cheques siguen en circulación
-- y la fecha de cobro probable).
--
-- Lifecycle: emitted → cashed | rejected | cancelled.

set row_security = off;

create table public.issued_checks (
  id                       uuid primary key default gen_random_uuid(),
  kind                     text not null check (kind in ('fisico', 'echeq')),
  check_number             text not null,
  bank_name                text not null,
  beneficiary_name         text,
  beneficiary_cuit         text,
  issue_date               date not null,
  due_date                 date not null,
  amount                   numeric(18, 2) not null check (amount > 0),
  currency                 text not null check (currency in ('ARS', 'USD')),

  -- Cuenta bancaria de la cual sale el cheque (chequera).
  bank_account_id          uuid not null references public.accounts (id) on delete restrict,

  -- Vínculos opcionales con OP / proveedor
  payment_order_id         uuid references public.payment_orders (id) on delete set null,
  supplier_id              uuid references public.suppliers (id) on delete set null,

  status                   text not null default 'emitted'
                             check (status in ('emitted', 'cashed', 'rejected', 'cancelled')),

  cashed_at                date,
  rejected_at              date,
  cancelled_at             timestamptz,
  cancelled_by             uuid references auth.users (id) on delete set null,

  notes                    text,
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- No cargar dos veces el mismo cheque del mismo banco
  constraint issued_checks_unique_number unique
    (kind, bank_name, check_number),

  -- Coherencia de fechas finales
  constraint issued_checks_status_dates check (
    (status = 'cashed'   and cashed_at   is not null and rejected_at is null)
    or (status = 'rejected' and rejected_at is not null and cashed_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
    or (status = 'emitted'  and cashed_at is null and rejected_at is null and cancelled_at is null)
  )
);

comment on table public.issued_checks is
  'Cheques propios emitidos. Se cargan manualmente o se enlazan a una OP. Informativos: el movimiento de caja lo hace la OP, no el cheque.';

create index issued_checks_status_idx on public.issued_checks (status);
create index issued_checks_due_date_idx on public.issued_checks (due_date);
create index issued_checks_supplier_idx on public.issued_checks (supplier_id) where supplier_id is not null;
create index issued_checks_payment_order_idx on public.issued_checks (payment_order_id) where payment_order_id is not null;
create index issued_checks_bank_account_idx on public.issued_checks (bank_account_id);

create trigger issued_checks_set_updated_at
  before update on public.issued_checks
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------
alter table public.issued_checks enable row level security;

create policy "Owners, admins and finance can view issued checks"
  on public.issued_checks for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert issued checks"
  on public.issued_checks for insert to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update issued checks"
  on public.issued_checks for update to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

-- Hard delete bloqueado; cancel via status='cancelled'.

set row_security = on;
