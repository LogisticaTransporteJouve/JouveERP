SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Impuestos: deshacer un pago devuelve el documento a como estaba.
-- Expand-only: two nullable columns and replacements that keep every
-- signature.
--
-- pay_tax_document and link_tax_document_payment fill a missing amount with
-- the paid one (amount = coalesce(amount, paid)), and the undo picked the
-- status from what was left: a pendiente document with no amount, paid 100
-- and undone, came back liquidado with amount 100, as if someone had typed a
-- liquidated figure. Now pay and link keep the amount and status the
-- document had (payment_previous_amount, payment_previous_status) and the
-- undo restores both. A document paid before this migration has neither and
-- keeps the old rule (liquidado when it has a firm amount, else pendiente).
-- guard_tax_document lets only pay/link set the columns; clearing them is
-- free.
--
-- Rollback: older pay/link never write the columns, and an older undo never
-- clears them: the row stays editable (the guard refuses only setting a new
-- value outside pay/link). The one residue: a document paid by newer code,
-- undone by older code and paid again by older code keeps the first
-- payment's values, which a later new undo restores.

alter table public.tax_documents
  add column payment_previous_amount numeric(18, 2),
  add column payment_previous_status text;

-- New, all-NULL columns: NOT VALID skips a scan with nothing to check.
alter table public.tax_documents
  add constraint tax_documents_payment_previous_status_known check (
    payment_previous_status is null or payment_previous_status in ('pendiente', 'liquidado')
  ) not valid;

comment on column public.tax_documents.payment_previous_amount is
  'Importe que tenía el impuesto antes del pago (NULL si no tenía); lo devuelve undo_tax_document_payment.';
comment on column public.tax_documents.payment_previous_status is
  'Estado que tenía el impuesto antes del pago (pendiente o liquidado); lo devuelve undo_tax_document_payment. NULL sin pago o en pagos anteriores a 20261104092200.';

------------------------------------------------------------------------------
-- guard_tax_document
------------------------------------------------------------------------------

-- Same as 20261104050100 plus the pre-payment amount and status: set only by
-- pay/link, absent on insert. Clearing them is free, so the undo (and an
-- older undo that never clears them, on rollback) leaves an editable row.
create or replace function public.guard_tax_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  get diagnostics v_stack = pg_context;

  if tg_op = 'INSERT' then
    if new.status not in ('pendiente', 'liquidado')
       or new.payment_transaction_id is not null
       or new.paid_date is not null
       or new.paid_amount is not null
       or new.payment_origin is not null
       or new.payment_previous_expense_account_id is not null
       or new.payment_previous_amount is not null
       or new.payment_previous_status is not null then
      raise exception 'Un impuesto se carga pendiente o liquidado: el pago se registra con "Pagar"'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  else
    if old.status = 'anulado' then
      raise exception 'El impuesto está anulado: no se puede editar'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if old.status = 'pagado' and v_stack !~ 'function (public\.)?undo_tax_document_payment\(' then
      if to_jsonb(new) - 'notes' - 'updated_at' is distinct from to_jsonb(old) - 'notes' - 'updated_at' then
        raise exception 'El impuesto ya está pagado: solo se editan las notas (para cambiar el pago, deshacelo)'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
      return new;
    end if;
    if v_stack !~ 'function (public\.)?(pay_tax_document|link_tax_document_payment)\('
       and (new.status = 'pagado'
         or new.payment_transaction_id is not null
         or new.paid_date is not null
         or new.paid_amount is not null
         or new.payment_origin is not null
         or new.payment_previous_expense_account_id is not null
         or (new.payment_previous_amount is not null
             and new.payment_previous_amount is distinct from old.payment_previous_amount)
         or (new.payment_previous_status is not null
             and new.payment_previous_status is distinct from old.payment_previous_status)) then
      raise exception 'El pago de un impuesto se registra con "Pagar" o "Vincular movimiento existente", que dejan el egreso en caja y su asiento'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  if new.status = 'liquidado' and new.amount is null then
    raise exception 'Para marcar el impuesto como liquidado cargá su importe'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if new.account_id is not null
     and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id)
     and not exists (
       select 1 from public.chart_of_accounts a
        where a.id = new.account_id
          and a.is_active
          and a.account_type in ('activo', 'pasivo', 'resultado_negativo')
          and (a.system_role is null
               or a.system_role not in ('caja', 'banco', 'cheques_cartera', 'clientes', 'proveedores'))
          and not exists (select 1 from public.chart_of_accounts c where c.parent_id = a.id)
     ) then
    raise exception 'La cuenta contable del impuesto debe ser una cuenta hoja activa de pasivo, activo o gasto (no caja, banco, clientes ni proveedores)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_tax_document() from public, anon, authenticated;

------------------------------------------------------------------------------
-- pay and link keep the state before the payment
------------------------------------------------------------------------------

-- Same as 20261104050100 plus the amount and status before the payment.
create or replace function public.pay_tax_document(
  p_tax_document_id uuid,
  p_paid_date       date,
  p_account_id      uuid,
  p_amount          numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc          public.tax_documents;
  v_account_type text;
  v_currency     text;
  v_channel_id   text;
  v_period       text := to_char(p_paid_date, 'YYYY-MM');
  v_tx_id        uuid;
begin
  -- Role guard (taxes:write holders in lib/auth/permissions.ts). The service
  -- role passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de impuestos'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe pagado tiene que ser mayor a cero'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_paid_date is null then
    raise exception 'Indicá la fecha de pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_doc
    from public.tax_documents td
   where td.id = p_tax_document_id
     and td.status in ('pendiente', 'liquidado')
     for update;
  if not found then
    raise exception 'El impuesto no existe o ya está pagado o anulado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_doc.account_id is null then
    raise exception 'Elegí la cuenta contable del impuesto antes de pagarlo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if exists (select 1 from public.accounting_closed_periods where period = v_period) then
    raise exception 'El período contable % está cerrado: usá una fecha de pago de un período abierto o pedí que lo reabran en Contabilidad.', v_period
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  select a.type, a.currency into v_account_type, v_currency
    from public.accounts a
   where a.id = p_account_id and a.is_active;
  if not found then
    raise exception 'La cuenta de pago no existe o está inactiva'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_account_type in ('checks', 'echeq') then
    raise exception 'Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_currency <> 'ARS' then
    raise exception 'Los impuestos se pagan en pesos: elegí una cuenta en ARS'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select c.id into v_channel_id
    from public.invoicing_channels c
   where c.is_fiscal and c.is_active
   order by c.id
   limit 1;
  if v_channel_id is null then
    raise exception 'No hay un canal fiscal activo para registrar el pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, created_by
  ) values (
    p_account_id, v_channel_id, 'expense', p_amount, 'ARS', p_paid_date,
    date_trunc('month', p_paid_date)::date,
    format('Pago de %s — período %s',
      public.tax_document_label(v_doc.kind, v_doc.title, v_doc.jurisdiction),
      to_char(to_date(v_doc.period, 'YYYY-MM'), 'MM/YYYY')),
    auth.uid()
  )
  returning id into v_tx_id;

  update public.tax_documents
     set status = 'pagado',
         amount = coalesce(amount, p_amount),
         payment_transaction_id = v_tx_id,
         paid_date = p_paid_date,
         paid_amount = p_amount,
         payment_origin = 'pay',
         -- The row before this update: what the undo restores.
         payment_previous_amount = amount,
         payment_previous_status = status
   where id = p_tax_document_id;

  -- Posted at insert as a loose expense; now the builder sees the document.
  perform public.repost_journal('transactions', v_tx_id);

  return v_tx_id;
end;
$$;

comment on function public.pay_tax_document(uuid, date, uuid, numeric) is
  'Registra el pago de un impuesto: egreso en caja del canal fiscal, vinculado al documento (pagado) y asentado contra la cuenta contable del impuesto.';

revoke all on function public.pay_tax_document(uuid, date, uuid, numeric) from public, anon, authenticated;
grant execute on function public.pay_tax_document(uuid, date, uuid, numeric) to authenticated, service_role;

-- Same as 20261104050100 plus the amount and status before the payment.
create or replace function public.link_tax_document_payment(
  p_tax_document_id  uuid,
  p_transaction_id   uuid,
  p_user_id          uuid,
  p_allow_difference boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc          public.tax_documents;
  v_tx           public.transactions;
  v_account_type text;
  v_period       text;
  v_accrual      text;
  v_differs      boolean;
begin
  -- No role check: granted to service_role only; the action gates with
  -- taxes:write and transactions:write. p_user_id keeps the signature of the
  -- reconciliation RPCs; the action audits the user.
  select * into v_doc
    from public.tax_documents td
   where td.id = p_tax_document_id
     for update;
  if not found then
    raise exception 'El impuesto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  -- The same pair again: already done.
  if v_doc.status = 'pagado' and v_doc.payment_transaction_id = p_transaction_id then
    return p_transaction_id;
  end if;
  if v_doc.status not in ('pendiente', 'liquidado') then
    raise exception 'El impuesto ya está pagado o anulado'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_doc.account_id is null then
    raise exception 'Elegí la cuenta contable del impuesto antes de vincular el pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_tx from public.transactions t where t.id = p_transaction_id for update;
  if not found then
    raise exception 'El movimiento no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_tx.kind <> 'expense' or not public.transaction_is_loose(v_tx) then
    raise exception 'Solo se puede vincular un egreso manual de caja o banco (no uno generado por otro documento)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_tx.currency <> 'ARS' then
    raise exception 'Los impuestos se pagan en pesos: el movimiento está en %', v_tx.currency
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select a.type into v_account_type
    from public.accounts a
   where a.id = v_tx.account_id and a.is_active;
  if not found then
    raise exception 'La cuenta del movimiento está inactiva'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_account_type in ('checks', 'echeq') then
    raise exception 'Los movimientos de una cuenta de cheques se manejan desde Cheques'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- A tax payment is fiscal (pay_tax_document books it in the fiscal
  -- channel); moving the movement's channel would break its reconciliation.
  if not exists (
    select 1 from public.invoicing_channels c where c.id = v_tx.channel_id and c.is_fiscal
  ) then
    raise exception 'El movimiento es de un canal no fiscal: un impuesto se paga desde el canal fiscal'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- Re-posting replaces the movement's entry, which a closed period keeps.
  v_period := to_char(v_tx.transaction_date, 'YYYY-MM');
  v_accrual := to_char(v_tx.accrual_month, 'YYYY-MM');
  if exists (
    select 1 from public.accounting_closed_periods cp where cp.period in (v_period, v_accrual)
  ) then
    raise exception 'El período contable % está cerrado: el asiento del movimiento no se puede rehacer. Pedí que lo reabran en Contabilidad.',
        case when exists (select 1 from public.accounting_closed_periods cp where cp.period = v_period)
             then v_period else v_accrual end
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  v_differs := v_doc.amount is not null and v_doc.amount <> v_tx.amount;
  if v_differs and not coalesce(p_allow_difference, false) then
    raise exception 'El movimiento es de $ % y el impuesto de $ %: confirmá la diferencia para vincularlo',
        to_char(v_tx.amount, 'FM999G999G999G990D00'), to_char(v_doc.amount, 'FM999G999G999G990D00')
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The document decides the entry from now on, not the expense account
  -- (kept on the document for an undo).
  if v_tx.expense_account_id is not null then
    update public.transactions set expense_account_id = null where id = v_tx.id;
  end if;

  update public.tax_documents
     set status = 'pagado',
         amount = coalesce(amount, v_tx.amount),
         payment_transaction_id = v_tx.id,
         paid_date = v_tx.transaction_date,
         paid_amount = v_tx.amount,
         payment_origin = 'link',
         payment_previous_expense_account_id = v_tx.expense_account_id,
         payment_previous_amount = v_doc.amount,
         payment_previous_status = v_doc.status,
         notes = case
           when v_differs then public.tax_document_difference_note(notes, amount, v_tx.amount)
           else notes
         end
   where id = v_doc.id;

  -- Posted as a loose expense; now the builder sees the document.
  perform public.repost_journal('transactions', v_tx.id);

  return v_tx.id;
end;
$$;

comment on function public.link_tax_document_payment(uuid, uuid, uuid, boolean) is
  'Paga un impuesto con un egreso manual ya cargado (pesos, canal fiscal, sin documento dueño): el documento queda pagado y el asiento del movimiento pasa a debitar la cuenta del impuesto; la cuenta de gasto que tenía queda en el documento para deshacerlo. Un importe distinto exige p_allow_difference y queda en las notas. Idempotente. Solo service role (la acción exige taxes:write y transactions:write).';

revoke all on function public.link_tax_document_payment(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.link_tax_document_payment(uuid, uuid, uuid, boolean)
  to service_role;

------------------------------------------------------------------------------
-- undo_tax_document_payment restores it
------------------------------------------------------------------------------

-- Same as 20261104050100 plus the restore of the amount and status.
create or replace function public.undo_tax_document_payment(
  p_tax_document_id uuid,
  p_user_id         uuid
)
returns table (
  transaction_id            uuid,
  origin                    text,
  movement_deleted          boolean,
  expense_account_restored  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc      public.tax_documents;
  v_tx       public.transactions;
  v_period   text;
  v_accrual  text;
  v_restore  uuid;
begin
  -- No role check: granted to service_role only; the action gates with
  -- taxes:write and transactions:write and audits p_user_id.
  select * into v_doc
    from public.tax_documents td
   where td.id = p_tax_document_id
     for update;
  if not found then
    raise exception 'El impuesto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  -- Not paid (never, or already undone): nothing to do.
  if v_doc.status <> 'pagado' then
    return;
  end if;

  select * into v_tx
    from public.transactions t
   where t.id = v_doc.payment_transaction_id
     for update;
  if not found then
    raise exception 'El movimiento del pago no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  -- Both paths rewrite the movement's entry, which a closed period keeps.
  v_period := to_char(v_tx.transaction_date, 'YYYY-MM');
  v_accrual := to_char(v_tx.accrual_month, 'YYYY-MM');
  if exists (
    select 1 from public.accounting_closed_periods cp where cp.period in (v_period, v_accrual)
  ) then
    raise exception 'El período contable % está cerrado: el pago no se puede deshacer. Pedí que lo reabran en Contabilidad.',
        case when exists (select 1 from public.accounting_closed_periods cp where cp.period = v_period)
             then v_period else v_accrual end
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if v_doc.payment_origin = 'pay' and exists (
    select 1 from public.bank_statement_matches m where m.transaction_id = v_tx.id
  ) then
    raise exception 'El pago está conciliado con el extracto bancario: desconciliá la línea antes de deshacerlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  update public.tax_documents
     set status = case
           when payment_previous_status is not null then payment_previous_status
           -- Paid before 20261104092200: the state is not on the row.
           when amount is not null and not amount_is_estimate then 'liquidado'
           else 'pendiente'
         end,
         amount = case
           when payment_previous_status is not null then payment_previous_amount
           else amount
         end,
         payment_previous_amount = null,
         payment_previous_status = null,
         payment_transaction_id = null,
         paid_date = null,
         paid_amount = null,
         payment_origin = null,
         payment_previous_expense_account_id = null,
         notes = left(concat_ws(E'\n', nullif(btrim(notes), ''),
           format('Pago del %s por $ %s deshecho.',
             to_char(v_doc.paid_date, 'DD/MM/YYYY'),
             to_char(v_doc.paid_amount, 'FM999G999G999G990D00'))), 1000)
   where id = v_doc.id;

  if v_doc.payment_origin = 'pay' then
    -- No longer owned: the owned-movement guard lets it go.
    delete from public.transactions where id = v_tx.id;
    return query select v_tx.id, 'pay'::text, true, false;
    return;
  end if;

  -- 'link': loose again, with the expense account it had while still valid.
  if v_doc.payment_previous_expense_account_id is not null
     and public.is_postable_expense_account(v_doc.payment_previous_expense_account_id) then
    v_restore := v_doc.payment_previous_expense_account_id;
    update public.transactions set expense_account_id = v_restore where id = v_tx.id;
  end if;

  -- The builder no longer sees the document: debit the expense account (or
  -- gastos) again.
  perform public.repost_journal('transactions', v_tx.id);

  return query select v_tx.id, 'link'::text, false, v_restore is not null;
end;
$$;

comment on function public.undo_tax_document_payment(uuid, uuid) is
  'Deshace el pago de un impuesto: el documento vuelve al estado e importe que tenía antes del pago (liquidado o pendiente); el egreso que creó "Pagar" se borra y el vinculado queda suelto con su cuenta de gasto anterior y el asiento rehecho. Rechaza un período cerrado y un pago creado conciliado con el extracto. Sin pago, no hace nada. Solo service role (la acción exige taxes:write y transactions:write).';

revoke all on function public.undo_tax_document_payment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.undo_tax_document_payment(uuid, uuid)
  to service_role;
