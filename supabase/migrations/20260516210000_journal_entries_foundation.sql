-- L.2a — Foundation de asientos contables (journal entries).
--
-- Define las dos tablas base + el trigger de balance que cualquier
-- generador de asientos (manual o automático en L.2b+) tiene que
-- respetar. Sin triggers en source tables todavía — esto solo cablea la
-- infraestructura.
--
-- Decisiones:
--   - `journal_entries.source_table` + `source_id` es un FK informal
--     (no se puede FK contra una tabla que varía). Validación a nivel
--     app cuando se generen desde triggers L.2b+.
--   - `accrual_period` text 'YYYY-MM' separado de `entry_date` porque
--     un asiento de marzo puede entrar a libro en abril (devengado vs
--     percibido). Default es derived de entry_date pero se puede pisar.
--   - `enforce_journal_balance` corre en CONSTRAINT TRIGGER (DEFERRABLE
--     INITIALLY DEFERRED) para que sea posible insertar el entry y las
--     líneas en el mismo statement sin que cada línea individual viole
--     el balance.
--   - `auto_journal_mapping` queda vacío al principio. L.2b+ inserta
--     filas cuando aparezcan los casos no-1-a-1 (típico: IIBB que
--     necesita cuenta distinta por jurisdicción).
--   - Helper `find_account_by_role(role)` devuelve `id` de la cuenta
--     activa con ese rol; usado por triggers de L.2b+ y por la UI.

set row_security = off;

------------------------------------------------------------------------------
-- 1. journal_entries
------------------------------------------------------------------------------
create table public.journal_entries (
  id                  uuid         primary key default gen_random_uuid(),
  entry_date          date         not null,
  accrual_period      text         not null,
  description         text         not null,
  source_table        text,
  source_id           uuid,
  channel_id          text         references public.invoicing_channels (id) on delete set null,
  created_by          uuid         references auth.users (id) on delete set null,
  created_at          timestamptz  not null default now(),
  is_reversal         boolean      not null default false,
  reversed_entry_id   uuid         references public.journal_entries (id) on delete set null,

  constraint journal_entries_period_format
    check (accrual_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint journal_entries_reversal_consistency
    check (
      (is_reversal = false and reversed_entry_id is null) or
      (is_reversal = true  and reversed_entry_id is not null)
    )
);

comment on table public.journal_entries is
  'Asientos contables (libro diario). Generados manualmente o desde triggers L.2b+. source_table/source_id son FK informal hacia comprobantes / receipts / payment_orders / transactions.';
comment on column public.journal_entries.accrual_period is
  'Período de devengamiento YYYY-MM. Puede diferir de entry_date (ej: factura emitida 02/04 que devenga marzo).';
comment on column public.journal_entries.is_reversal is
  'true cuando el asiento revierte otro (e.g. anulación de OP/comprobante). reversed_entry_id apunta al asiento original.';

create index journal_entries_entry_date_idx     on public.journal_entries (entry_date desc);
create index journal_entries_accrual_period_idx on public.journal_entries (accrual_period);
create index journal_entries_source_idx         on public.journal_entries (source_table, source_id);
create index journal_entries_channel_idx        on public.journal_entries (channel_id);
create index journal_entries_reversed_idx       on public.journal_entries (reversed_entry_id);

------------------------------------------------------------------------------
-- 2. journal_entry_lines
------------------------------------------------------------------------------
create table public.journal_entry_lines (
  id                    uuid         primary key default gen_random_uuid(),
  journal_entry_id      uuid         not null references public.journal_entries (id) on delete cascade,
  chart_of_accounts_id  uuid         not null references public.chart_of_accounts (id) on delete restrict,
  debit                 numeric(18,2) not null default 0,
  credit                numeric(18,2) not null default 0,
  description           text,
  sort_order            int          not null default 0,

  constraint jel_debit_or_credit_exclusive
    check (
      (debit > 0 and credit = 0) or (debit = 0 and credit > 0)
    ),
  constraint jel_amounts_non_negative
    check (debit >= 0 and credit >= 0)
);

comment on table public.journal_entry_lines is
  'Líneas debe/haber de un asiento. Cada línea es 100% débito o 100% crédito (nunca mezcladas).';

create index jel_journal_entry_idx on public.journal_entry_lines (journal_entry_id);
create index jel_account_idx       on public.journal_entry_lines (chart_of_accounts_id);

------------------------------------------------------------------------------
-- 3. Trigger enforce_journal_balance (DEFERRABLE)
------------------------------------------------------------------------------
-- Corre al final del statement para que un INSERT múltiple del entry +
-- todas sus líneas vea el estado consistente. Si Σdebit ≠ Σcredit por
-- entry, falla con un mensaje claro.

create or replace function public.enforce_journal_balance()
returns trigger
language plpgsql
as $$
declare
  v_entry_id uuid;
  v_debit_sum  numeric(18,2);
  v_credit_sum numeric(18,2);
begin
  if tg_op = 'DELETE' then
    v_entry_id := old.journal_entry_id;
  else
    v_entry_id := new.journal_entry_id;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit_sum, v_credit_sum
    from public.journal_entry_lines
   where journal_entry_id = v_entry_id;

  if v_debit_sum <> v_credit_sum then
    raise exception
      'Asiento % desbalanceado: débito=% crédito=% (diferencia=%)',
      v_entry_id, v_debit_sum, v_credit_sum, v_debit_sum - v_credit_sum
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function public.enforce_journal_balance() is
  'Trigger DEFERRABLE que valida Σdebit = Σcredit por asiento al final del statement.';

create constraint trigger jel_enforce_balance
  after insert or update or delete on public.journal_entry_lines
  deferrable initially deferred
  for each row execute function public.enforce_journal_balance();

------------------------------------------------------------------------------
-- 4. auto_journal_mapping
------------------------------------------------------------------------------
-- Casos donde el system_role del plan no alcanza para elegir cuenta
-- (típico: IIBB tiene cuenta por jurisdicción). El generador de
-- asientos de L.2b+ consulta esta tabla primero; si no encuentra,
-- cae al lookup por system_role.

create table public.auto_journal_mapping (
  id                    uuid         primary key default gen_random_uuid(),
  event_type            text         not null,
  account_role          public.coa_system_role,
  chart_of_accounts_id  uuid         not null references public.chart_of_accounts (id) on delete restrict,
  conditions            jsonb        not null default '{}'::jsonb,
  notes                 text,
  is_active             boolean      not null default true,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now()
);

comment on table public.auto_journal_mapping is
  'Override por evento para casos no-1-a-1 (ej: IIBB por jurisdicción → cuenta distinta). Si el lookup matchea event_type + condiciones, usa esta cuenta en vez del system_role del plan.';
comment on column public.auto_journal_mapping.conditions is
  'JSON de condiciones (e.g. {"jurisdiction": "PBA"}). El generador hace match contra los datos del source row.';

create index auto_journal_mapping_event_idx on public.auto_journal_mapping (event_type, is_active);

create trigger auto_journal_mapping_set_updated_at
  before update on public.auto_journal_mapping
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 5. Helper: find_account_by_role
------------------------------------------------------------------------------
-- Devuelve el id de la cuenta activa con ese system_role. Usado por los
-- generadores de asientos de L.2b+. Marcado `stable` porque dentro de un
-- statement el resultado no cambia (system_role es unique parcial sobre
-- cuentas activas).

create or replace function public.find_account_by_role(p_role public.coa_system_role)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id
    from public.chart_of_accounts
   where system_role = p_role
     and is_active = true
   limit 1;
$$;

comment on function public.find_account_by_role(public.coa_system_role) is
  'Lookup atómico de la cuenta activa que cumple un rol del sistema. Devuelve null si no hay cuenta asignada — el generador de asientos debe manejar ese caso.';

------------------------------------------------------------------------------
-- 6. RLS
------------------------------------------------------------------------------
-- Read para cualquier rol con accounting:read. Write SOLO desde funciones
-- security definer (no exponemos INSERT/UPDATE/DELETE directos a
-- authenticated — los asientos se generan por trigger o por RPC).
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.auto_journal_mapping enable row level security;

create policy "Authenticated users can view journal_entries"
  on public.journal_entries for select
  to authenticated
  using (true);

create policy "Authenticated users can view journal_entry_lines"
  on public.journal_entry_lines for select
  to authenticated
  using (true);

create policy "Authenticated users can view auto_journal_mapping"
  on public.auto_journal_mapping for select
  to authenticated
  using (true);

-- Admin override para soporte (manualmente arreglar un asiento desde la BD).
create policy "Owners and admins can manage journal_entries"
  on public.journal_entries for all
  to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can manage journal_entry_lines"
  on public.journal_entry_lines for all
  to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners, admins and finance can manage auto_journal_mapping"
  on public.auto_journal_mapping for all
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

------------------------------------------------------------------------------
-- 7. RPC create_journal_entry — usado por triggers L.2b+ y entradas manuales
------------------------------------------------------------------------------
-- Acepta header + array JSON de líneas. Inserta entry + líneas en una
-- transacción; el trigger DEFERRABLE valida balance al cierre del
-- statement. Devuelve el id del asiento creado.
--
-- Acepta lookup por chart_of_accounts_id directo O por system_role
-- (resolviendo via find_account_by_role). Falla con mensaje claro si
-- un role no resuelve.

create or replace function public.create_journal_entry(
  p_entry_date       date,
  p_accrual_period   text,
  p_description      text,
  p_lines            jsonb,
  p_source_table     text default null,
  p_source_id        uuid default null,
  p_channel_id       text default null,
  p_is_reversal      boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line     jsonb;
  v_account_id uuid;
  v_role     text;
  v_sort     int := 0;
begin
  insert into public.journal_entries (
    entry_date, accrual_period, description,
    source_table, source_id, channel_id,
    created_by, is_reversal, reversed_entry_id
  )
  values (
    p_entry_date, p_accrual_period, p_description,
    p_source_table, p_source_id, p_channel_id,
    auth.uid(), p_is_reversal, p_reversed_entry_id
  )
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    -- Resolver cuenta: account_id directo gana sobre system_role.
    if v_line ? 'account_id' and v_line->>'account_id' is not null then
      v_account_id := (v_line->>'account_id')::uuid;
    elsif v_line ? 'system_role' and v_line->>'system_role' is not null then
      v_role := v_line->>'system_role';
      v_account_id := public.find_account_by_role(v_role::public.coa_system_role);
      if v_account_id is null then
        raise exception 'No hay cuenta activa asignada al rol "%" del plan de cuentas', v_role
          using errcode = 'P0002';
      end if;
    else
      raise exception 'Cada línea debe traer account_id o system_role'
        using errcode = '22023';
    end if;

    insert into public.journal_entry_lines (
      journal_entry_id, chart_of_accounts_id,
      debit, credit, description, sort_order
    )
    values (
      v_entry_id, v_account_id,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'description',
      v_sort
    );

    v_sort := v_sort + 1;
  end loop;

  -- Forzar evaluación del constraint trigger DEFERRABLE ahora mismo. Sin
  -- esto, el balance recién se chequea al COMMIT de la transacción y el
  -- caller perdería contexto del error (más difícil de propagar a la UI).
  set constraints public.jel_enforce_balance immediate;

  return v_entry_id;
end;
$$;

comment on function public.create_journal_entry is
  'Crea un asiento + líneas atomic. Cada línea puede traer account_id directo o system_role (el helper resuelve). El trigger DEFERRABLE valida Σdebit=Σcredit al cierre. Devuelve el id del asiento.';

revoke all on function public.create_journal_entry from public;
grant execute on function public.create_journal_entry to authenticated;

set row_security = on;
