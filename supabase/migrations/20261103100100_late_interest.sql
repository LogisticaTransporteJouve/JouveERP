SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Mora → Nota de débito (roadmap 4.6). Never automatic: the user picks the
-- overdue comprobantes and issues one ND per comprobante through the normal
-- issuance path (issueFiscalInvoiceAction, the ND's origin is the overdue
-- comprobante).
--
--   1. Rate: clients.late_interest_monthly_rate (monthly %, null = the
--      general one) and finance_settings 'late_interest_monthly_rate'.
--   2. late_interest_charges: one row per ND, the period it charges
--      (period_from..period_to, inclusive), the rate, the open balance it
--      was computed on and the interest. guard_late_interest_charge refuses a
--      period that overlaps a live charge of the same comprobante (no double
--      charge), interest on an interest ND, a period before the due date, and
--      any change to a charge but linking its ND or releasing it.
--      A charge is live until released; an unlinked one stays live while it
--      is fresh (15 minutes, the request in flight) or an ND carries its id
--      as idempotency key and has not failed (the link was lost, the ND
--      exists).
--   3. invoices_release_late_interest: a failed or cancelled ND releases its
--      charge, so the period can be charged again.
--   4. late_interest_candidates(as_of): the overdue comprobantes with open
--      balance, the day the next charge starts and the rate that applies
--      (service role; the action gates on invoices:read).
--
-- RLS: owner/admin/finance read; every write goes through the service client
-- behind invoices:issue + credit_debit_notes:issue (charges) or clients:write
-- (rates).

------------------------------------------------------------------------------
-- 1. Rates
------------------------------------------------------------------------------
create table public.finance_settings (
  key        text primary key check (key in ('late_interest_monthly_rate')),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint finance_settings_late_interest_rate check (
    key <> 'late_interest_monthly_rate'
    or (jsonb_typeof(value) = 'number'
        and (value #>> '{}')::numeric >= 0
        and (value #>> '{}')::numeric <= 100)
  )
);

comment on table public.finance_settings is
  'Config global de finanzas, key/value. Hoy: late_interest_monthly_rate (tasa de interés por mora mensual en %, la general).';

alter table public.finance_settings enable row level security;

create policy "finance_settings select"
  on public.finance_settings for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.finance_settings from public, anon;

alter table public.clients
  add column late_interest_monthly_rate numeric(6, 3);

-- The column is new and all null: the check validates at once.
alter table public.clients
  add constraint clients_late_interest_rate_range
    check (late_interest_monthly_rate is null
           or late_interest_monthly_rate between 0 and 100) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.clients validate constraint clients_late_interest_rate_range;

comment on column public.clients.late_interest_monthly_rate is
  'Interés por mora mensual (%) del cliente. Null = la tasa general (finance_settings).';

------------------------------------------------------------------------------
-- 2. late_interest_charges
------------------------------------------------------------------------------
create table public.late_interest_charges (
  id              uuid primary key default gen_random_uuid(),
  -- The overdue comprobante (factura or ND) and the ND origin.
  invoice_id      uuid not null references public.invoices (id) on delete restrict,
  client_id       uuid not null references public.clients (id) on delete restrict,
  period_from     date not null,
  period_to       date not null,
  monthly_rate    numeric(6, 3) not null check (monthly_rate > 0 and monthly_rate <= 100),
  base_amount     numeric(15, 2) not null check (base_amount > 0),
  interest_amount numeric(15, 2) not null check (interest_amount > 0),
  moneda          text not null,
  nd_invoice_id   uuid references public.invoices (id) on delete set null,
  released        boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint late_interest_charges_period check (period_to >= period_from)
);

comment on table public.late_interest_charges is
  'Intereses por mora cobrados con ND: comprobante vencido, período (inclusive), tasa mensual, saldo base, interés y la ND. Sin superposición de períodos vivos por comprobante (guard_late_interest_charge).';
comment on column public.late_interest_charges.released is
  'La ND falló o se anuló (o no se llegó a emitir): el período se puede volver a cobrar.';

create index late_interest_charges_invoice_idx
  on public.late_interest_charges (invoice_id, period_from);
create unique index late_interest_charges_nd_key
  on public.late_interest_charges (nd_invoice_id) where nd_invoice_id is not null;

alter table public.late_interest_charges enable row level security;

create policy "late_interest_charges select"
  on public.late_interest_charges for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.late_interest_charges from public, anon;

-- Whether a charge still holds its period (see the header).
create function public.late_interest_charge_is_live(p_charge public.late_interest_charges)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not p_charge.released
     and (p_charge.nd_invoice_id is not null
          or p_charge.created_at > now() - interval '15 minutes'
          or exists (
            select 1 from public.invoices i
             where i.idempotency_key = p_charge.id::text
               and i.status not in ('failed', 'cancelled')
          ));
$$;

revoke all on function public.late_interest_charge_is_live(public.late_interest_charges)
  from public, anon, authenticated;

create function public.guard_late_interest_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv   record;
  v_nd    record;
  v_other record;
begin
  if tg_op = 'DELETE' then
    if not old.released then
      raise exception 'Un interés por mora no se borra: anulá su nota de débito.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.invoice_id      is distinct from old.invoice_id
       or new.client_id    is distinct from old.client_id
       or new.period_from  is distinct from old.period_from
       or new.period_to    is distinct from old.period_to
       or new.monthly_rate is distinct from old.monthly_rate
       or new.base_amount  is distinct from old.base_amount
       or new.interest_amount is distinct from old.interest_amount
       or new.moneda       is distinct from old.moneda
       or new.created_at   is distinct from old.created_at
       or (old.released and not new.released)
       or (old.nd_invoice_id is not null
           and new.nd_invoice_id is distinct from old.nd_invoice_id
           and new.nd_invoice_id is not null) then
      raise exception 'Un interés por mora no se edita: anulá su nota de débito y generá otro.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;

    if new.nd_invoice_id is not null and old.nd_invoice_id is null then
      if old.released then
        raise exception 'El interés por mora ya se liberó: generá otro.'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
      select i.kind, i.invoice_origin_id, i.status
        into v_nd
        from public.invoices i
       where i.id = new.nd_invoice_id;
      if v_nd.kind is distinct from 'nd'
         or v_nd.invoice_origin_id is distinct from new.invoice_id then
        raise exception 'La nota de débito no corresponde al comprobante del interés.'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      if v_nd.status in ('failed', 'cancelled') then
        raise exception 'La nota de débito falló o se anuló: volvé a generar el interés.'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;

    -- A live ND keeps its period: only its failure or cancellation (the
    -- invoices trigger) releases it.
    if new.released and not old.released and old.nd_invoice_id is not null
       and exists (select 1 from public.invoices i
                    where i.id = old.nd_invoice_id
                      and i.status not in ('failed', 'cancelled')) then
      raise exception 'La nota de débito del interés sigue vigente: anulala para liberar el período.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  -- INSERT
  if new.released or new.nd_invoice_id is not null then
    raise exception 'Un interés por mora nace sin nota de débito y vigente.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- One writer per comprobante at a time.
  perform pg_advisory_xact_lock(
    hashtextextended('late_interest_charges:' || new.invoice_id::text, 0)
  );

  select i.client_id, i.kind, i.status, i.moneda,
         coalesce(i.fch_vto_pago, i.fecha) as due_date
    into v_inv
    from public.invoices i
   where i.id = new.invoice_id;
  if v_inv.status is distinct from 'emitted' or v_inv.kind not in ('factura', 'nd') then
    raise exception 'Solo se cobran intereses sobre una factura o nota de débito emitida.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_inv.client_id <> new.client_id or v_inv.moneda <> new.moneda then
    raise exception 'El interés no corresponde al cliente o la moneda del comprobante.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if exists (select 1 from public.late_interest_charges c
              where c.nd_invoice_id = new.invoice_id) then
    raise exception 'No se cobran intereses sobre una nota de débito de intereses.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if new.period_from <= v_inv.due_date then
    raise exception 'El interés corre desde el día siguiente al vencimiento (%).',
        to_char(v_inv.due_date, 'DD/MM/YYYY')
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select c.period_from, c.period_to
    into v_other
    from public.late_interest_charges c
   where c.invoice_id = new.invoice_id
     and c.id <> new.id
     and daterange(c.period_from, c.period_to, '[]')
         && daterange(new.period_from, new.period_to, '[]')
     and public.late_interest_charge_is_live(c)
   order by c.period_from
   limit 1;
  if found then
    raise exception 'Ya se cobraron intereses de ese comprobante del % al %.',
        to_char(v_other.period_from, 'DD/MM/YYYY'),
        to_char(v_other.period_to, 'DD/MM/YYYY')
      using errcode = '23P01', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_late_interest_charge() from public, anon, authenticated;

create trigger late_interest_charges_guard
  before insert or update or delete on public.late_interest_charges
  for each row execute function public.guard_late_interest_charge();

------------------------------------------------------------------------------
-- 3. A failed or cancelled ND releases its charge
------------------------------------------------------------------------------
create function public.release_late_interest_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.late_interest_charges
     set released = true
   where nd_invoice_id = new.id
     and not released;
  return new;
end;
$$;

revoke all on function public.release_late_interest_charge() from public, anon, authenticated;

create trigger invoices_release_late_interest
  after update of status on public.invoices
  for each row
  when ((new.status = 'failed' and old.status in ('draft', 'emitting'))
        or (new.status = 'cancelled' and old.status <> 'cancelled'))
  execute function public.release_late_interest_charge();

------------------------------------------------------------------------------
-- 4. Candidates
------------------------------------------------------------------------------
-- Every emitted factura or ND with open balance that is overdue on p_as_of
-- (an interest ND aside), the day its next charge starts (the day after the
-- due date or after the last live charge), the client's own monthly rate and
-- the one that applies (the client's, else the general one; null = none set).
create function public.late_interest_candidates(p_as_of date)
returns table (
  invoice_id      uuid,
  client_id       uuid,
  client_name     text,
  channel_id      text,
  channel_is_fiscal boolean,
  kind            text,
  letter          text,
  punto_venta     integer,
  numero          integer,
  fecha           date,
  due_date        date,
  moneda          text,
  open_amount     numeric,
  charged_to      date,
  charge_from     date,
  client_rate     numeric,
  monthly_rate    numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.invoice_id,
         d.client_id,
         cl.legal_name,
         d.channel_id,
         d.channel_is_fiscal,
         d.kind,
         d.letter::text,
         d.punto_venta,
         d.numero,
         d.fecha,
         coalesce(d.fch_vto_pago, d.fecha),
         d.moneda,
         d.open_amount,
         lc.charged_to,
         greatest(coalesce(d.fch_vto_pago, d.fecha), coalesce(lc.charged_to, d.fecha)) + 1,
         cl.late_interest_monthly_rate,
         coalesce(cl.late_interest_monthly_rate,
                  (select (s.value #>> '{}')::numeric
                     from public.finance_settings s
                    where s.key = 'late_interest_monthly_rate'))
    from public.v_aging_documents d
    join public.clients cl on cl.id = d.client_id
    left join lateral (
      select max(c.period_to) as charged_to
        from public.late_interest_charges c
       where c.invoice_id = d.invoice_id
         and public.late_interest_charge_is_live(c)
    ) lc on true
   where d.document_type = 'invoice'
     and d.open_amount > 0
     and coalesce(d.fch_vto_pago, d.fecha) < p_as_of
     and not exists (select 1 from public.late_interest_charges x
                      where x.nd_invoice_id = d.invoice_id)
   order by cl.legal_name, coalesce(d.fch_vto_pago, d.fecha), d.invoice_id
$$;

revoke all on function public.late_interest_candidates(date) from public, anon, authenticated;
grant execute on function public.late_interest_candidates(date) to service_role;
