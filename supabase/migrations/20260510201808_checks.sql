-- F.2 — Cheques + endosos.
--
-- Modela la cartera de checks físicos y e-cheq que recibimos de clientes.
-- Lifecycle:
--
--   en_cartera ── depositar ──→ depositado ── acreditar ──→ acreditado
--        │
--        ├── endosar ──→ endosado (entregado a proveedor / acreedor)
--        │
--        └── rechazar ──→ rechazado
--
-- `checks` guarda el estado actual; `check_movements` el historial de
-- eventos. La integración con recibos está pensada para una iteración
-- siguiente: el form de recibo va a aprender a capturar check metadata
-- cuando la línea de pago va a una cuenta tipo `checks` / `echeq`, y
-- create_receipt va a insertar la row en `checks` automáticamente. En
-- esta migración dejamos la FK lista (`source_receipt_id`,
-- `source_payment_line_id`) para esa integración.

set row_security = off;

------------------------------------------------------------------------------
-- 1. checks table
------------------------------------------------------------------------------
create table public.checks (
  id                       uuid primary key default gen_random_uuid(),
  kind                     text not null check (kind in ('fisico', 'echeq')),
  check_number            text not null,
  bank_name                text not null,
  drawer_name              text not null,
  drawer_cuit              text,
  issue_date               date not null,
  due_date                 date not null,
  amount                   numeric(18, 2) not null check (amount > 0),
  currency                 text not null check (currency in ('ARS', 'USD')),

  -- De dónde vino el check (typically un recibo, pero también carga manual).
  source_kind              text not null
                             check (source_kind in ('receipt', 'manual')),
  source_receipt_id        uuid references public.receipts (id)
                             on delete restrict,
  source_payment_line_id   uuid references public.receipt_payment_lines (id)
                             on delete set null,
  source_client_id         uuid references public.clients (id)
                             on delete set null,

  -- Account de la cartera (CH Físico / e-cheq) — el check "vive" ahí.
  -- Cuando se deposita o endosa, se generan transactions que mueven el
  -- monto entre esta cuenta y la cuenta destino.
  cartera_account_id       uuid not null references public.accounts (id)
                             on delete restrict,

  status                   text not null default 'en_cartera'
                             check (status in (
                               'en_cartera',
                               'depositado',
                               'acreditado',
                               'endosado',
                               'rechazado'
                             )),

  notes                    text,
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.checks is
  'Cartera de checks físicos y e-cheq. Cada row mantiene el estado actual; el historial de eventos vive en check_movements.';
comment on column public.checks.cartera_account_id is
  'Cuenta de cartera donde el check "vive". Tipo accounts.checks (físicos) o accounts.echeq.';

-- Cheque numbers no son únicos globalmente (distintos bancos/firmantes
-- pueden usar la misma serie) así que no agregamos unique sobre número.
-- Sí agregamos un unique sobre (kind, bank_name, check_number) para
-- prevenir duplicados de carga manual contra el mismo banco.
create unique index checks_unique_number_per_bank_idx
  on public.checks (kind, lower(bank_name), check_number);

create index checks_status_idx on public.checks (status);
create index checks_due_date_idx on public.checks (due_date);
create index checks_source_receipt_idx on public.checks (source_receipt_id)
  where source_receipt_id is not null;
create index checks_source_client_idx on public.checks (source_client_id)
  where source_client_id is not null;

create trigger checks_set_updated_at
  before update on public.checks
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. check_movements
------------------------------------------------------------------------------
-- Historial inmutable de eventos. Cada deposit/endorse/credit/reject suma
-- una fila acá. La transaction generada (cuando aplica) se linkea para
-- poder navegar entre check y caja.
create table public.check_movements (
  id                  uuid primary key default gen_random_uuid(),
  check_id           uuid not null references public.checks (id)
                        on delete cascade,
  event               text not null check (event in (
                        'received',
                        'deposited',
                        'credited',
                        'endorsed',
                        'rejected'
                      )),
  event_date          date not null,

  -- Cuando el evento mueve plata a otra cuenta (depósito / acreditación)
  destination_account_id uuid references public.accounts (id)
                           on delete set null,

  -- Cuando es endorse: el endosatario.
  endorsed_to_name    text,
  endorsed_to_cuit    text,

  -- Transaction(s) generadas. Para deposit es un transfer (dos transactions
  -- linkeadas vía transfer_pair_id); guardamos solo la transfer_out.
  transaction_id      uuid references public.transactions (id)
                        on delete set null,

  notes               text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index check_movements_check_idx on public.check_movements (check_id);
create index check_movements_event_date_idx on public.check_movements (event_date desc);

------------------------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------------------------
alter table public.checks           enable row level security;
alter table public.check_movements  enable row level security;

create policy "Owners, admins and finance can view checks"
  on public.checks for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert checks"
  on public.checks for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update checks"
  on public.checks for update
  to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners can delete checks"
  on public.checks for delete
  to authenticated
  using (public.user_has_role(array['owner']));

create policy "Owners, admins and finance can view check movements"
  on public.check_movements for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert check movements"
  on public.check_movements for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners can delete check movements"
  on public.check_movements for delete
  to authenticated
  using (public.user_has_role(array['owner']));

------------------------------------------------------------------------------
-- 4. RPC: deposit_check (transfer cartera → bank, marca depositado)
------------------------------------------------------------------------------
-- Crea las dos halves de un transfer (pair) entre la cuenta de cartera y
-- la cuenta bancaria destino, registra el movimiento y flippea el status
-- a 'depositado'. Todo en una transacción.
--
-- "Acreditar" después es un step aparte: el banco confirma a los X días y
-- el usuario marca como `acreditado` desde la UI (pero la plata ya está
-- moviéndose desde el depósito).

create or replace function public.deposit_check(
  p_check_id        uuid,
  p_account_id       uuid,
  p_event_date       date,
  p_channel_id       text,
  p_description      text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_out_id       uuid;
  v_in_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  select * into v_check from public.checks where id = p_check_id;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status <> 'en_cartera' then
    raise exception 'check % está en estado % — solo se puede depositar desde en_cartera',
      p_check_id, v_check.status;
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;
  v_out_id := gen_random_uuid();
  v_in_id  := gen_random_uuid();

  insert into public.transactions (
    id, account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, transfer_pair_id, created_by
  ) values
    (v_out_id, v_check.cartera_account_id, p_channel_id, 'transfer_out',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_in_id, auth.uid()),
    (v_in_id, p_account_id, p_channel_id, 'transfer_in',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_out_id, auth.uid());

  update public.checks
     set status = 'depositado'
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, transaction_id,
    notes, created_by
  ) values (
    p_check_id, 'deposited', p_event_date, p_account_id, v_out_id,
    nullif(trim(p_description), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.deposit_check(uuid, uuid, date, text, text) from public;
grant execute on function public.deposit_check(uuid, uuid, date, text, text) to authenticated;

------------------------------------------------------------------------------
-- 5. RPC: credit_check (depositado → acreditado)
------------------------------------------------------------------------------
create or replace function public.credit_check(
  p_check_id   uuid,
  p_event_date  date,
  p_notes       text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_movement_id  uuid;
begin
  select * into v_check from public.checks where id = p_check_id;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status <> 'depositado' then
    raise exception 'check % está en estado % — solo se puede acreditar desde depositado',
      p_check_id, v_check.status;
  end if;

  update public.checks
     set status = 'acreditado'
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, notes, created_by
  ) values (
    p_check_id, 'credited', p_event_date,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.credit_check(uuid, date, text) from public;
grant execute on function public.credit_check(uuid, date, text) to authenticated;

------------------------------------------------------------------------------
-- 6. RPC: endorse_check (en_cartera → endosado)
------------------------------------------------------------------------------
-- Endosar = entregar el check a un proveedor como pago. Genera una
-- transaction de expense en la cuenta de cartera (sale el check del
-- activo). El proveedor queda registrado en endorsed_to_name/cuit pero
-- no creamos un row en clients — proveedores son distintos y van en
-- otra fase.

create or replace function public.endorse_check(
  p_check_id        uuid,
  p_event_date       date,
  p_channel_id       text,
  p_endorsed_to_name text,
  p_endorsed_to_cuit text,
  p_notes            text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_tx_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  select * into v_check from public.checks where id = p_check_id;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status <> 'en_cartera' then
    raise exception 'check % está en estado % — solo se puede endosar desde en_cartera',
      p_check_id, v_check.status;
  end if;
  if length(trim(coalesce(p_endorsed_to_name, ''))) = 0 then
    raise exception 'endorse_check: razón social del endosatario requerida';
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;
  v_tx_id := gen_random_uuid();

  insert into public.transactions (
    id, account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, created_by
  ) values (
    v_tx_id, v_check.cartera_account_id, p_channel_id, 'expense',
    v_check.amount, v_check.currency, p_event_date, v_accrual,
    'Endoso check ' || v_check.check_number || ' a ' || p_endorsed_to_name,
    auth.uid()
  );

  update public.checks
     set status = 'endosado'
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, endorsed_to_name, endorsed_to_cuit,
    transaction_id, notes, created_by
  ) values (
    p_check_id, 'endorsed', p_event_date, trim(p_endorsed_to_name),
    nullif(trim(p_endorsed_to_cuit), ''), v_tx_id,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.endorse_check(uuid, date, text, text, text, text) from public;
grant execute on function public.endorse_check(uuid, date, text, text, text, text) to authenticated;

------------------------------------------------------------------------------
-- 7. RPC: reject_check (depositado → rechazado, reversa la plata)
------------------------------------------------------------------------------
-- Cuando el banco rechaza el check, hay que revertir la plata que
-- entró al banco al depositar. Genera transactions inversas:
--   * expense en la cuenta bancaria (sale lo que había entrado)
--   * income en la cartera (vuelve el check, pero rechazado)

create or replace function public.reject_check(
  p_check_id        uuid,
  p_account_id       uuid,
  p_event_date       date,
  p_channel_id       text,
  p_notes            text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_movement_id  uuid;
  v_accrual      date;
begin
  select * into v_check from public.checks where id = p_check_id;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status not in ('depositado', 'en_cartera') then
    raise exception 'check % está en estado % — solo se puede rechazar desde depositado o en_cartera',
      p_check_id, v_check.status;
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;

  -- Solo si ya estaba depositado revertimos la plata; si estaba en cartera
  -- no hubo movimiento que revertir.
  if v_check.status = 'depositado' then
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, created_by
    ) values (
      p_account_id, p_channel_id, 'expense',
      v_check.amount, v_check.currency, p_event_date, v_accrual,
      'Cheque rechazado ' || v_check.check_number, auth.uid()
    );
  end if;

  update public.checks
     set status = 'rechazado'
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, notes, created_by
  ) values (
    p_check_id, 'rejected', p_event_date, p_account_id,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.reject_check(uuid, uuid, date, text, text) from public;
grant execute on function public.reject_check(uuid, uuid, date, text, text) to authenticated;

set row_security = on;
