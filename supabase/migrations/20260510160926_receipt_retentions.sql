-- F.5 — retenciones y percepciones en recibos.
--
-- Cuando un cliente paga un recibo, parte del monto puede ser retenido (no
-- entra como plata real, queda como certificado de crédito fiscal). Lo
-- mismo aplica a percepciones aplicadas al cobro.
--
-- Modelo:
--   total_amount (header) = sum(payment_lines.amount) + sum(retentions.amount)
--
-- Las retenciones cancelan parte del total pero no afectan el saldo de
-- ninguna cuenta de Caja: existen como crédito fiscal independiente.
--
-- `tax_type` cubre los regímenes argentinos típicos. `jurisdiction` se usa
-- solo para IIBB (varía por provincia). Otros regímenes específicos
-- (Bienes Personales, etc.) caen en `otros` con descripción libre en
-- `notes` — la idea es no pretender ser exhaustivos sino capturar los
-- montos para reportes fiscales (CITI / SICORE) en una fase posterior.

set row_security = off;

------------------------------------------------------------------------------
-- 1. receipt_retentions table
------------------------------------------------------------------------------
create table public.receipt_retentions (
  id                  uuid primary key default gen_random_uuid(),
  receipt_id          uuid not null references public.receipts (id)
                        on delete cascade,
  kind                text not null check (kind in ('retencion', 'percepcion')),
  tax_type            text not null check (tax_type in (
    'ganancias',
    'iva',
    'iibb',
    'suss',
    'otros'
  )),
  jurisdiction        text,
  certificate_number  text not null,
  certificate_date    date not null,
  amount              numeric(18, 2) not null check (amount > 0),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.receipt_retentions is
  'Retenciones y percepciones aplicadas al recibo. Cancelan parte del total pero no impactan saldo de cuentas de Caja — son créditos fiscales.';
comment on column public.receipt_retentions.jurisdiction is
  'Provincia / jurisdicción para IIBB (ej. caba, bsas, santa_fe). Null para retenciones nacionales.';

create index receipt_retentions_receipt_idx
  on public.receipt_retentions (receipt_id);
create index receipt_retentions_tax_type_idx
  on public.receipt_retentions (tax_type);

create trigger receipt_retentions_set_updated_at
  before update on public.receipt_retentions
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. RLS — same as receipts/payment_lines/allocations
------------------------------------------------------------------------------
alter table public.receipt_retentions enable row level security;

create policy "Owners, admins and finance can view receipt retentions"
  on public.receipt_retentions for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert receipt retentions"
  on public.receipt_retentions for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update receipt retentions"
  on public.receipt_retentions for update
  to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can delete receipt retentions"
  on public.receipt_retentions for delete
  to authenticated
  using (public.user_has_role(array['owner', 'finance']));

------------------------------------------------------------------------------
-- 3. Update create_receipt RPC (replace, with retentions support)
------------------------------------------------------------------------------
-- Drop the old signature so we can add the p_retentions jsonb param at the
-- end. PG identifies functions by full signature; just CREATE OR REPLACE
-- with a new arg list creates a second overload, which is not what we want.
drop function if exists public.create_receipt(
  text, int, int, uuid, date, numeric, text, text, jsonb, jsonb
);

create or replace function public.create_receipt(
  p_channel_id    text,
  p_punto_venta   int,
  p_numero        int,
  p_client_id     uuid,
  p_recibo_date   date,
  p_total_amount  numeric,
  p_currency      text,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb,
  p_retentions    jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_receipt_id   uuid;
  v_payment_sum  numeric := 0;
  v_alloc_sum    numeric := 0;
  v_retention_sum numeric := 0;
  v_line         jsonb;
begin
  insert into public.receipts (
    channel_id, punto_venta, numero, client_id, receipt_date,
    total_amount, currency, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_client_id, p_recibo_date,
    p_total_amount, p_currency, nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_receipt_id;

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      v_receipt_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    );
    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, invoice_id, amount_applied
    ) values (
      v_receipt_id,
      (v_line->>'invoice_id')::uuid,
      (v_line->>'amount_applied')::numeric
    );
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_retentions, '[]'::jsonb))
  loop
    insert into public.receipt_retentions (
      receipt_id, kind, tax_type, jurisdiction, certificate_number,
      certificate_date, amount, notes
    ) values (
      v_receipt_id,
      v_line->>'kind',
      v_line->>'tax_type',
      nullif(trim(v_line->>'jurisdiction'), ''),
      v_line->>'certificate_number',
      (v_line->>'certificate_date')::date,
      (v_line->>'amount')::numeric,
      nullif(trim(v_line->>'notes'), '')
    );
    v_retention_sum := v_retention_sum + (v_line->>'amount')::numeric;
  end loop;

  if round(v_payment_sum + v_retention_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines + retentions sum (%) does not match total_amount (%)',
      v_payment_sum + v_retention_sum, p_total_amount;
  end if;

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;

  return v_receipt_id;
end;
$$;

revoke all on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 4. Update update_receipt RPC
------------------------------------------------------------------------------
drop function if exists public.update_receipt(
  uuid, date, numeric, text, jsonb, jsonb
);

create or replace function public.update_receipt(
  p_id            uuid,
  p_recibo_date   date,
  p_total_amount  numeric,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb,
  p_retentions    jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status        text;
  v_payment_sum   numeric := 0;
  v_alloc_sum     numeric := 0;
  v_retention_sum numeric := 0;
  v_line          jsonb;
begin
  select status into v_status from public.receipts where id = p_id;
  if v_status is null then
    raise exception 'receipt % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled receipt (%)', p_id;
  end if;

  update public.receipts set
    receipt_date  = p_recibo_date,
    total_amount = p_total_amount,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  delete from public.receipt_payment_lines where receipt_id = p_id;
  delete from public.receipt_allocations    where receipt_id = p_id;
  delete from public.receipt_retentions     where receipt_id = p_id;

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      p_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    );
    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, invoice_id, amount_applied
    ) values (
      p_id,
      (v_line->>'invoice_id')::uuid,
      (v_line->>'amount_applied')::numeric
    );
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_retentions, '[]'::jsonb))
  loop
    insert into public.receipt_retentions (
      receipt_id, kind, tax_type, jurisdiction, certificate_number,
      certificate_date, amount, notes
    ) values (
      p_id,
      v_line->>'kind',
      v_line->>'tax_type',
      nullif(trim(v_line->>'jurisdiction'), ''),
      v_line->>'certificate_number',
      (v_line->>'certificate_date')::date,
      (v_line->>'amount')::numeric,
      nullif(trim(v_line->>'notes'), '')
    );
    v_retention_sum := v_retention_sum + (v_line->>'amount')::numeric;
  end loop;

  if round(v_payment_sum + v_retention_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines + retentions sum (%) does not match total_amount (%)',
      v_payment_sum + v_retention_sum, p_total_amount;
  end if;

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;
end;
$$;

revoke all on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb) to authenticated;

set row_security = on;
