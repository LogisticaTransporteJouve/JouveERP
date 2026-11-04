SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W8 · S2 F2: a receipt or a payment order moves a check cartera
-- only with a check. The cartera's balance is Σ the checks in it (W7 · S2 F3):
-- a check enters only with its row and leaves only by endorsement, deposit or
-- sale. Every other money RPC refuses a cartera in the database, but:
-- - create_payment_order / update_payment_order took a plain «cuenta» line,
--   or the bank of an own check, on a checks/echeq account, and booked an
--   expense on the cartera while all its checks stayed en_cartera;
-- - create_receipt / update_receipt booked the income of a cartera line and
--   created its check only when the line carried one, so a cartera line with
--   no check left money in the cartera that no check explains.
-- Only the forms kept this from happening (the order's editor hides carteras
-- for plain lines, the receipt's editor always attaches a check draft); the
-- AI scan and the API did not.
--
-- 1. Payment orders: a payment-order line on a checks/echeq account must be
--    an endorsed check. A trigger on the line covers both RPCs and the
--    writers that reach them: impute_purchase_remitos copies an order's lines
--    as plain lines, but purchase_remito_blocker refuses a remito paid with
--    checks; the seed pays from banks and cash. It fires after
--    payment_order_payment_lines_check_channel and _guard_rpc (name order),
--    so their messages still win.
-- 2. Receipts: create_receipt / update_receipt refuse a cartera line with no
--    check object before writing it. confirm_driver_settlement sends the
--    check of every cartera line (save_driver_settlement requires number,
--    bank and payment date), post_driver_settlement_difference pays from
--    cash, billed_remito_blocker refuses a remito collected with checks, and
--    the seed sends a check with every cartera line.
--
-- The RLS policies are not changed. Existing rows are not touched; an order
-- or receipt that already has such a line is refused when it is re-saved,
-- with the reason.
--
-- Rollback: older code sends the same lines; the forms never send these, so
-- it is unaffected.

-- 1. Payment-order lines ----------------------------------------------------------

create function public.guard_payment_order_line_cartera()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.endorsed_check_id is null
     and exists (
       select 1 from public.accounts a
        where a.id = new.account_id and a.type in ('checks', 'echeq')
     ) then
    raise exception 'Una orden de pago saca plata de una cartera de cheques solo endosando un cheque: pagá desde un banco o una caja, o endosá el cheque'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payment_order_line_cartera() from public, anon, authenticated;

create trigger payment_order_payment_lines_require_check
  before insert on public.payment_order_payment_lines
  for each row execute function public.guard_payment_order_line_cartera();

-- 2. Receipts: same as 20261103210000 plus the cartera check at the top of
-- each payment line.

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
  p_retentions    jsonb,
  p_cotizacion    numeric default null
)
returns uuid
language plpgsql
set search_path = ''
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
  v_check        jsonb;
  v_check_id     uuid;
begin
  -- Role guard (receipts:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear recibos'
      using errcode = '42501';
  end if;

  insert into public.receipts (
    channel_id, punto_venta, numero, client_id, receipt_date,
    total_amount, currency, cotizacion, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_client_id, p_recibo_date,
    p_total_amount, p_currency,
    case when p_currency = 'USD' then p_cotizacion end,
    nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_receipt_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo X'
    || lpad(p_punto_venta::text, 4, '0')
    || '-' || lpad(p_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    -- A cartera moves only with its check.
    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;
    v_check := v_line->'check';
    if v_account_type in ('checks', 'echeq')
       and (v_check is null or jsonb_typeof(v_check) <> 'object') then
      raise exception 'Un cobro en una cartera de cheques necesita su cheque: número, banco y fecha de pago'
        using errcode = '23514', hint = 'jouve_guard';
    end if;

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

    -- Auto-create the check of a cartera line.
    if v_account_type in ('checks', 'echeq') and v_check is not null
       and jsonb_typeof(v_check) = 'object' then
      insert into public.checks (
        kind, check_number, bank_name, drawer_name, drawer_cuit,
        issue_date, due_date, amount, currency,
        cartera_account_id, source_kind, source_receipt_id,
        source_payment_line_id, source_client_id, notes, created_by
      ) values (
        case when v_account_type = 'echeq' then 'echeq' else 'fisico' end,
        coalesce(nullif(trim(v_check->>'check_number'), ''),
                 v_line->>'reference'),
        v_check->>'bank_name',
        v_check->>'drawer_name',
        nullif(trim(v_check->>'drawer_cuit'), ''),
        coalesce((v_check->>'issue_date')::date, p_recibo_date),
        (v_check->>'due_date')::date,
        (v_line->>'amount')::numeric,
        p_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        v_receipt_id,
        v_line_id,
        p_client_id,
        nullif(trim(v_check->>'notes'), ''),
        auth.uid()
      )
      returning id into v_check_id;

      insert into public.check_movements (
        check_id, event, event_date, notes, created_by
      ) values (
        v_check_id, 'received', p_recibo_date, null, auth.uid()
      );
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if v_line->>'rejected_check_id' is not null then
      insert into public.receipt_rejected_check_allocations (
        receipt_id, check_id, amount_applied
      ) values (
        v_receipt_id,
        (v_line->>'rejected_check_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    else
      insert into public.receipt_allocations (
        receipt_id, invoice_id, amount_applied
      ) values (
        v_receipt_id,
        (v_line->>'invoice_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    end if;
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

revoke all on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb, numeric) to authenticated, service_role;

create or replace function public.update_receipt(
  p_id            uuid,
  p_recibo_date   date,
  p_total_amount  numeric,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb,
  p_retentions    jsonb,
  p_cotizacion    numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
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
  v_check        jsonb;
  v_check_id     uuid;
begin
  -- Role guard (receipts:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar recibos'
      using errcode = '42501';
  end if;

  select status, channel_id, currency, client_id, punto_venta, numero
    into v_status, v_channel_id, v_currency, v_client_id, v_punto_venta, v_numero
    from public.receipts where id = p_id
     for update;
  if v_status is null then
    raise exception 'receipt % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled receipt (%)', p_id;
  end if;

  -- An edit that sends no rate keeps the stored one.
  update public.receipts set
    receipt_date  = p_recibo_date,
    total_amount = p_total_amount,
    cotizacion   = case when v_currency = 'USD' then coalesce(p_cotizacion, cotizacion) end,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  -- Cascade-rebuild. Cheques con status <> en_cartera abortan el delete y
  -- forman un mensaje claro al usuario (ver guard_check_delete_in_lifecycle).
  delete from public.receipt_payment_lines where receipt_id = p_id;
  delete from public.receipt_allocations    where receipt_id = p_id;
  delete from public.receipt_rejected_check_allocations where receipt_id = p_id;
  delete from public.receipt_retentions     where receipt_id = p_id;
  delete from public.transactions           where receipt_id = p_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo X'
    || lpad(v_punto_venta::text, 4, '0')
    || '-' || lpad(v_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    -- A cartera moves only with its check.
    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;
    v_check := v_line->'check';
    if v_account_type in ('checks', 'echeq')
       and (v_check is null or jsonb_typeof(v_check) <> 'object') then
      raise exception 'Un cobro en una cartera de cheques necesita su cheque: número, banco y fecha de pago'
        using errcode = '23514', hint = 'jouve_guard';
    end if;

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

    if v_account_type in ('checks', 'echeq') and v_check is not null
       and jsonb_typeof(v_check) = 'object' then
      insert into public.checks (
        kind, check_number, bank_name, drawer_name, drawer_cuit,
        issue_date, due_date, amount, currency,
        cartera_account_id, source_kind, source_receipt_id,
        source_payment_line_id, source_client_id, notes, created_by
      ) values (
        case when v_account_type = 'echeq' then 'echeq' else 'fisico' end,
        coalesce(nullif(trim(v_check->>'check_number'), ''),
                 v_line->>'reference'),
        v_check->>'bank_name',
        v_check->>'drawer_name',
        nullif(trim(v_check->>'drawer_cuit'), ''),
        coalesce((v_check->>'issue_date')::date, p_recibo_date),
        (v_check->>'due_date')::date,
        (v_line->>'amount')::numeric,
        v_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        p_id,
        v_line_id,
        v_client_id,
        nullif(trim(v_check->>'notes'), ''),
        auth.uid()
      )
      returning id into v_check_id;

      insert into public.check_movements (
        check_id, event, event_date, notes, created_by
      ) values (
        v_check_id, 'received', p_recibo_date, null, auth.uid()
      );
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if v_line->>'rejected_check_id' is not null then
      insert into public.receipt_rejected_check_allocations (
        receipt_id, check_id, amount_applied
      ) values (
        p_id,
        (v_line->>'rejected_check_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    else
      insert into public.receipt_allocations (
        receipt_id, invoice_id, amount_applied
      ) values (
        p_id,
        (v_line->>'invoice_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    end if;
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

revoke all on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb, numeric) to authenticated, service_role;
