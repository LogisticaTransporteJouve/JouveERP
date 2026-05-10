-- F.2.b — Auto-creación de cheques desde recibos.
--
-- Cuando una payment_line de un recibo va a una cuenta tipo `cheques` o
-- `echeq`, el flujo natural es que el cliente nos haya entregado un cheque
-- y el recibo sea el comprobante de cobro. Antes de este PR había que
-- cargar el cheque dos veces (uno en el recibo, otro en /cheques manual).
-- Ahora el RPC create_receipt detecta el caso y crea la row en cheques
-- automáticamente.
--
-- Diseño: el payload `p_payment_lines` admite un campo `cheque` opcional
-- con la metadata del cheque (kind, bank, drawer, due_date). Cuando el
-- account es de tipo `cheques`/`echeq` y `cheque` está presente, se inserta
-- en `cheques` linkeado al recibo y a la payment_line, y se inserta el
-- movement inicial 'received'.
--
-- Edit y cancel del recibo: el delete cascade por receipt_id (existente)
-- borra los cheques al cancelar, pero solo cuando todavía están en cartera
-- — un cheque ya depositado no debería poder borrarse desde un recibo.
-- Eso lo enforce un trigger nuevo.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Trigger: bloquea delete de cheques con status != en_cartera
------------------------------------------------------------------------------
-- Cuando se cancela/edita un recibo, el RPC borra todas sus payment_lines
-- (cascade). Si una de esas payment_lines tenía un cheque asociado y el
-- cheque ya fue depositado/endosado/etc, NO podemos perder esa trazabilidad.
-- El trigger rechaza el delete y obliga al usuario a desligar manualmente.

create or replace function public.guard_cheque_delete_in_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'en_cartera' then
    raise exception 'No se puede eliminar el cheque % porque está en estado % — ya tiene movimientos en Caja. Desligalo manualmente desde /cheques antes de editar/cancelar el recibo.',
      old.cheque_number, old.status;
  end if;
  return old;
end;
$$;

create trigger cheques_guard_delete
  before delete on public.cheques
  for each row execute function public.guard_cheque_delete_in_lifecycle();

------------------------------------------------------------------------------
-- 2. Cascade chain: receipt → payment_line → cheque
------------------------------------------------------------------------------
-- receipt_payment_lines ya tiene `on delete cascade` desde receipts (vía
-- receipt_id). Necesitamos que cheques también se borren cuando la
-- payment_line se borra (siempre que esté en_cartera, sino el trigger
-- anterior aborta).

alter table public.cheques
  drop constraint if exists cheques_source_payment_line_id_fkey;

alter table public.cheques
  add constraint cheques_source_payment_line_id_fkey
    foreign key (source_payment_line_id)
    references public.receipt_payment_lines (id)
    on delete cascade;

------------------------------------------------------------------------------
-- 3. Replace create_receipt RPC with cheque auto-creation
------------------------------------------------------------------------------
drop function if exists public.create_receipt(
  text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb
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
  v_receipt_id    uuid;
  v_payment_sum   numeric := 0;
  v_alloc_sum     numeric := 0;
  v_retention_sum numeric := 0;
  v_accrual_month date;
  v_description   text;
  v_line          jsonb;
  v_line_id       uuid;
  v_account_type  text;
  v_cheque        jsonb;
  v_cheque_id     uuid;
begin
  insert into public.receipts (
    channel_id, punto_venta, numero, client_id, recibo_date,
    total_amount, currency, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_client_id, p_recibo_date,
    p_total_amount, p_currency, nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_receipt_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo R'
    || lpad(p_punto_venta::text, 4, '0')
    || '-' || lpad(p_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      v_receipt_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    )
    returning id into v_line_id;

    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;

    -- Income transaction in the destination account.
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_client_id, receipt_id, created_by
    ) values (
      (v_line->>'account_id')::uuid,
      p_channel_id,
      'income',
      (v_line->>'amount')::numeric,
      p_currency,
      p_recibo_date,
      v_accrual_month,
      v_description,
      p_client_id,
      v_receipt_id,
      auth.uid()
    );

    -- Auto-create cheque when applicable: account.type ∈ {cheques, echeq}
    -- and the payload includes cheque metadata.
    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;

    v_cheque := v_line->'cheque';
    if v_account_type in ('cheques', 'echeq') and v_cheque is not null
       and jsonb_typeof(v_cheque) = 'object' then
      insert into public.cheques (
        kind, cheque_number, bank_name, drawer_name, drawer_cuit,
        issue_date, due_date, amount, currency,
        cartera_account_id, source_kind, source_receipt_id,
        source_payment_line_id, source_client_id, notes, created_by
      ) values (
        case when v_account_type = 'echeq' then 'echeq' else 'fisico' end,
        coalesce(nullif(trim(v_cheque->>'cheque_number'), ''),
                 v_line->>'reference'),
        v_cheque->>'bank_name',
        v_cheque->>'drawer_name',
        nullif(trim(v_cheque->>'drawer_cuit'), ''),
        coalesce((v_cheque->>'issue_date')::date, p_recibo_date),
        (v_cheque->>'due_date')::date,
        (v_line->>'amount')::numeric,
        p_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        v_receipt_id,
        v_line_id,
        p_client_id,
        nullif(trim(v_cheque->>'notes'), ''),
        auth.uid()
      )
      returning id into v_cheque_id;

      insert into public.cheque_movements (
        cheque_id, event, event_date, notes, created_by
      ) values (
        v_cheque_id, 'received', p_recibo_date, null, auth.uid()
      );
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, comprobante_id, amount_applied
    ) values (
      v_receipt_id,
      (v_line->>'comprobante_id')::uuid,
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
-- 4. Replace update_receipt RPC with cheque auto-creation
------------------------------------------------------------------------------
drop function if exists public.update_receipt(
  uuid, date, numeric, text, jsonb, jsonb, jsonb
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
  v_channel_id    text;
  v_currency      text;
  v_client_id     uuid;
  v_punto_venta   int;
  v_numero        int;
  v_payment_sum   numeric := 0;
  v_alloc_sum     numeric := 0;
  v_retention_sum numeric := 0;
  v_accrual_month date;
  v_description   text;
  v_line          jsonb;
  v_line_id       uuid;
  v_account_type  text;
  v_cheque        jsonb;
  v_cheque_id     uuid;
begin
  select status, channel_id, currency, client_id, punto_venta, numero
    into v_status, v_channel_id, v_currency, v_client_id, v_punto_venta, v_numero
    from public.receipts where id = p_id;
  if v_status is null then
    raise exception 'receipt % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled receipt (%)', p_id;
  end if;

  update public.receipts set
    recibo_date  = p_recibo_date,
    total_amount = p_total_amount,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  -- Cascade-rebuild. Cheques con status <> en_cartera abortan el delete y
  -- forman un mensaje claro al usuario (ver guard_cheque_delete_in_lifecycle).
  delete from public.receipt_payment_lines where receipt_id = p_id;
  delete from public.receipt_allocations    where receipt_id = p_id;
  delete from public.receipt_retentions     where receipt_id = p_id;
  delete from public.transactions           where receipt_id = p_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo R'
    || lpad(v_punto_venta::text, 4, '0')
    || '-' || lpad(v_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      p_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    )
    returning id into v_line_id;

    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_client_id, receipt_id, created_by
    ) values (
      (v_line->>'account_id')::uuid,
      v_channel_id,
      'income',
      (v_line->>'amount')::numeric,
      v_currency,
      p_recibo_date,
      v_accrual_month,
      v_description,
      v_client_id,
      p_id,
      auth.uid()
    );

    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;
    v_cheque := v_line->'cheque';
    if v_account_type in ('cheques', 'echeq') and v_cheque is not null
       and jsonb_typeof(v_cheque) = 'object' then
      insert into public.cheques (
        kind, cheque_number, bank_name, drawer_name, drawer_cuit,
        issue_date, due_date, amount, currency,
        cartera_account_id, source_kind, source_receipt_id,
        source_payment_line_id, source_client_id, notes, created_by
      ) values (
        case when v_account_type = 'echeq' then 'echeq' else 'fisico' end,
        coalesce(nullif(trim(v_cheque->>'cheque_number'), ''),
                 v_line->>'reference'),
        v_cheque->>'bank_name',
        v_cheque->>'drawer_name',
        nullif(trim(v_cheque->>'drawer_cuit'), ''),
        coalesce((v_cheque->>'issue_date')::date, p_recibo_date),
        (v_cheque->>'due_date')::date,
        (v_line->>'amount')::numeric,
        p_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        p_id,
        v_line_id,
        v_client_id,
        nullif(trim(v_cheque->>'notes'), ''),
        auth.uid()
      )
      returning id into v_cheque_id;

      insert into public.cheque_movements (
        cheque_id, event, event_date, notes, created_by
      ) values (
        v_cheque_id, 'received', p_recibo_date, null, auth.uid()
      );
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, comprobante_id, amount_applied
    ) values (
      p_id,
      (v_line->>'comprobante_id')::uuid,
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
