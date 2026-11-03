SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Impuestos: pagar con un movimiento que ya está en los libros. Expand-only:
-- two new RPCs and guard_tax_document learning the first one. No table or
-- column changes.
--
-- 1. link_tax_document_payment: a tax is usually paid by a bank transfer that
--    is already loaded (by hand or from the bank statement) as a loose
--    expense. The document adopts it instead of booking a second outflow,
--    like adopt_loan_installment_payment and record_loan_disbursement do for
--    loans: the expense account the movement had is cleared, the document
--    takes the movement as its payment (pagado, paid on the movement's date
--    for its amount) and repost_journal rebuilds the entry, which
--    build_transaction_journal_lines now posts as Debe the document's account
--    / Haber the cash or bank account. No money field of the movement moves,
--    so a movement already reconciled with the bank statement can be adopted
--    (guard_transaction_reconciled locks amount, date, accrual month,
--    account, kind, currency, channel and pair, not expense_account_id), and
--    the entry is replaced only when it differs. Refused: a movement owned by
--    another document, not an expense, not in pesos, from an inactive or
--    checks account, outside the fiscal channel, or dated (or accrued) in a
--    closed period; a document already paid with another movement, annulled,
--    or without its account. An amount other than the document's needs
--    p_allow_difference and leaves the difference in the notes. Linking the
--    same pair again returns the movement and changes nothing.
-- 2. create_bank_statement_line_tax_payment: the reconciliation's "create
--    the movement from a statement line", as a tax payment. A debit line
--    pays the document through pay_tax_document (dated on the line, from the
--    line's account, for the line's amount) and the line is matched with the
--    new movement in the same transaction. Same amount rule as above.
--    create_bank_statement_line_transaction keeps its signature.
--
-- Undo: neither pay_tax_document nor these RPCs have an undo yet (follow-up
-- in docs/pendientes.md).
--
-- Rollback: older code never calls the new RPCs; a document they paid reads
-- as any paid document, its movement as any tax payment.

------------------------------------------------------------------------------
-- 1. guard_tax_document: the paid state is also reached by linking
------------------------------------------------------------------------------

-- Same as 20261103170000 plus link_tax_document_payment in the stack check.
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
       or new.paid_amount is not null then
      raise exception 'Un impuesto se carga pendiente o liquidado: el pago se registra con "Pagar"'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  else
    if old.status = 'anulado' then
      raise exception 'El impuesto está anulado: no se puede editar'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if old.status = 'pagado' then
      if to_jsonb(new) - 'notes' - 'updated_at' is distinct from to_jsonb(old) - 'notes' - 'updated_at' then
        raise exception 'El impuesto ya está pagado: solo se editan las notas'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
      return new;
    end if;
    if v_stack !~ 'function (public\.)?(pay_tax_document|link_tax_document_payment)\('
       and (new.status = 'pagado'
         or new.payment_transaction_id is not null
         or new.paid_date is not null
         or new.paid_amount is not null) then
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
-- 2. link_tax_document_payment
------------------------------------------------------------------------------

-- The note a payment for another amount leaves on the document. Stable, not
-- immutable: to_char follows lc_numeric.
create function public.tax_document_difference_note(
  p_notes           text,
  p_document_amount numeric,
  p_paid_amount     numeric
)
returns text
language sql
stable
set search_path = ''
as $$
  select left(concat_ws(E'\n', nullif(btrim(p_notes), ''),
    format('Pagado por $ %s; el impuesto era de $ %s (diferencia $ %s).',
      to_char(p_paid_amount, 'FM999G999G999G990D00'),
      to_char(p_document_amount, 'FM999G999G999G990D00'),
      to_char(p_paid_amount - p_document_amount, 'FM999G999G999G990D00'))), 1000);
$$;

revoke all on function public.tax_document_difference_note(text, numeric, numeric)
  from public, anon, authenticated;

create function public.link_tax_document_payment(
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

  -- The document decides the entry from now on, not the expense account.
  if v_tx.expense_account_id is not null then
    update public.transactions set expense_account_id = null where id = v_tx.id;
  end if;

  update public.tax_documents
     set status = 'pagado',
         amount = coalesce(amount, v_tx.amount),
         payment_transaction_id = v_tx.id,
         paid_date = v_tx.transaction_date,
         paid_amount = v_tx.amount,
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
  'Paga un impuesto con un egreso manual ya cargado (pesos, canal fiscal, sin documento dueño): el documento queda pagado y el asiento del movimiento pasa a debitar la cuenta del impuesto. Un importe distinto exige p_allow_difference y queda en las notas. Idempotente. Solo service role (la acción exige taxes:write y transactions:write).';

revoke all on function public.link_tax_document_payment(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.link_tax_document_payment(uuid, uuid, uuid, boolean)
  to service_role;

------------------------------------------------------------------------------
-- 3. create_bank_statement_line_tax_payment
------------------------------------------------------------------------------

create function public.create_bank_statement_line_tax_payment(
  p_line_id          uuid,
  p_tax_document_id  uuid,
  p_user_id          uuid,
  p_allow_difference boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line   public.bank_statement_lines%rowtype;
  v_doc    public.tax_documents;
  v_amount numeric(18, 2);
  v_tx     uuid;
begin
  -- No role check: granted to service_role only; the action gates with
  -- transactions:write and taxes:write.
  select * into v_line from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'La línea del extracto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_line.status <> 'open' then
    raise exception 'La línea ya está conciliada o marcada como que no corresponde'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_line.amount >= 0 then
    raise exception 'Solo un débito del extracto puede ser el pago de un impuesto'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  v_amount := abs(v_line.amount);

  select * into v_doc
    from public.tax_documents td
   where td.id = p_tax_document_id
     for update;
  if not found then
    raise exception 'El impuesto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_doc.amount is not null and v_doc.amount <> v_amount
     and not coalesce(p_allow_difference, false) then
    raise exception 'La línea es de $ % y el impuesto de $ %: confirmá la diferencia para registrar el pago',
        to_char(v_amount, 'FM999G999G999G990D00'), to_char(v_doc.amount, 'FM999G999G999G990D00')
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The payment itself: status, closed period, account, currency and
  -- channel checks, the owned movement and its entry.
  v_tx := public.pay_tax_document(p_tax_document_id, v_line.line_date, v_line.account_id, v_amount);

  -- pay_tax_document stamps auth.uid(), which the service role lacks.
  update public.transactions set created_by = p_user_id where id = v_tx;

  if v_doc.amount is not null and v_doc.amount <> v_amount then
    update public.tax_documents
       set notes = public.tax_document_difference_note(notes, v_doc.amount, v_amount)
     where id = p_tax_document_id;
  end if;

  insert into public.bank_statement_matches (line_id, transaction_id, matched_by)
  values (p_line_id, v_tx, p_user_id);

  update public.bank_statement_lines
     set status = 'matched', status_changed_by = p_user_id, status_changed_at = now()
   where id = p_line_id;

  return v_tx;
end;
$$;

comment on function public.create_bank_statement_line_tax_payment(uuid, uuid, uuid, boolean) is
  'Registra el pago de un impuesto desde un débito pendiente del extracto (pay_tax_document con la fecha, la cuenta y el importe de la línea) y lo concilia con la línea. Un importe distinto exige p_allow_difference y queda en las notas. Solo service role (la acción exige transactions:write y taxes:write).';

revoke all on function public.create_bank_statement_line_tax_payment(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.create_bank_statement_line_tax_payment(uuid, uuid, uuid, boolean)
  to service_role;
