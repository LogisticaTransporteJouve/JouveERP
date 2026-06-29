-- Préstamos y leasing con cronograma de cuotas.
--
-- Un loan = capital + N cuotas (cronograma editable cuota por cuota, para
-- soportar UVA / tasa variable / leasing). Cada cuota se paga registrando un
-- recibo que marca la cuota pagada y genera el egreso en caja (transactions),
-- con el canal del préstamo (fiscal = blanco / interno = negro). Las cuotas
-- pendientes alimentan el flujo de caja proyectado por su fecha de vencimiento.
--
-- RLS: owner/admin/finance (igual que el resto de tesorería/contable).

set row_security = off;

create type public.loan_kind as enum ('prestamo', 'leasing');
create type public.loan_status as enum ('active', 'paid', 'cancelled');
create type public.loan_installment_status as enum ('pendiente', 'pagada');

create table public.loans (
  id                  uuid primary key default gen_random_uuid(),
  kind                public.loan_kind not null default 'prestamo',
  description         text not null,
  lender              text,
  principal           numeric(14, 2) not null check (principal > 0),
  currency            text not null default 'ARS' check (currency in ('ARS', 'USD')),
  channel_id          text not null references public.invoicing_channels (id) on delete restrict,
  installments_count  int not null check (installments_count between 1 and 600),
  first_due_date      date not null,
  status              public.loan_status not null default 'active',
  notes               text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.loans is
  'Préstamos y leasing. El canal (fiscal/interno) clasifica las cuotas como blanco/negro en el flujo de caja. principal = capital total; el cronograma vive en loan_installments.';

create index loans_status_idx on public.loans (status);
create index loans_channel_idx on public.loans (channel_id);

create table public.loan_installments (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.loans (id) on delete cascade,
  number          int not null check (number > 0),
  due_date        date not null,
  amount          numeric(14, 2) not null check (amount >= 0),
  status          public.loan_installment_status not null default 'pendiente',
  paid_date       date,
  paid_amount     numeric(14, 2) check (paid_amount is null or paid_amount >= 0),
  transaction_id  uuid references public.transactions (id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (loan_id, number)
);

comment on table public.loan_installments is
  'Cuotas del préstamo/leasing. amount editable mientras está pendiente. Al pagar: status=pagada + paid_date/paid_amount + transaction_id (egreso en caja).';

create index loan_installments_loan_idx on public.loan_installments (loan_id, number);
create index loan_installments_due_idx
  on public.loan_installments (due_date) where status = 'pendiente';

create trigger loans_set_updated_at
  before update on public.loans
  for each row execute function public.set_updated_at();
create trigger loan_installments_set_updated_at
  before update on public.loan_installments
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- RLS — owner/admin/finance
------------------------------------------------------------------------------
alter table public.loans enable row level security;
alter table public.loan_installments enable row level security;

create policy "loans select"
  on public.loans for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "loans insert"
  on public.loans for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "loans update"
  on public.loans for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "loans delete"
  on public.loans for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "loan_installments select"
  on public.loan_installments for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "loan_installments insert"
  on public.loan_installments for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "loan_installments update"
  on public.loan_installments for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "loan_installments delete"
  on public.loan_installments for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

set row_security = on;
