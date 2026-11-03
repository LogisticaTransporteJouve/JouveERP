SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Impuestos: deshacer un pago. Expand-only: two nullable columns, one RPC
-- and replacements that keep every signature.
--
-- 1. tax_documents.payment_origin ('pay' | 'link') says how the payment
--    got there, and payment_previous_expense_account_id keeps the expense
--    account a linked movement had before link_tax_document_payment cleared
--    it. pay_tax_document and link_tax_document_payment write them; nothing
--    else can (guard_tax_document).
--    Backfill of the documents already paid:
--      origin — 'link' when the audit log has the link
--      ('tax_document.payment_linked' for the pair); otherwise 'pay' when it
--      has the payment ('tax_document.paid') or the movement carries the
--      description pay_tax_document writes; otherwise 'link', so an undo
--      releases the movement instead of deleting one a user loaded.
--      previous account — the journal keeps nothing: repost_journal deletes
--      the replaced entry (it is not reversed). The audit log does: the
--      last 'transaction.created' / 'transaction.updated' of the movement
--      before the link that names expense_account_id. Unknown stays NULL
--      and the undo leaves the movement without expense account (a loose
--      expense posts to gastos, as it did before the account was chosen).
-- 2. undo_tax_document_payment(doc, user): the document goes back to
--    liquidado (an amount that is not an estimate) or pendiente, its payment
--    columns cleared and a line in its notes.
--      'pay':  the movement pay_tax_document booked is deleted (its entry
--              goes with it, transactions_after_delete_journal).
--      'link': the movement stays in Caja, loose again: it gets back its
--              previous expense account (while still a postable one) and
--              its entry is re-posted against it.
--    Refused (jouve_guard): the movement dated or accrued in a closed
--    period (both paths rewrite its entry), and a 'pay' movement reconciled
--    with the bank statement (deleting it would break the match; unmatch
--    first). A reconciled 'link' movement is released: expense_account_id is
--    not a locked field (guard_transaction_reconciled). A document that is
--    not paid returns no row and changes nothing (idempotent). Service role
--    only; the action gates with taxes:write and transactions:write and
--    audits.
--
-- Rollback: older code never calls the RPC and never reads the columns;
-- pay and link still work (the functions are the ones in this file).

------------------------------------------------------------------------------
-- 1. Columns and backfill
------------------------------------------------------------------------------

alter table public.tax_documents
  add column payment_origin text;

-- New, all-NULL column: the FK check has nothing to scan.
alter table public.tax_documents
  -- squawk-ignore adding-foreign-key-constraint
  add column payment_previous_expense_account_id uuid references public.chart_of_accounts (id) on delete restrict;

-- The column is all NULL, so the partial index starts empty.
-- squawk-ignore require-concurrent-index-creation
create index tax_documents_previous_expense_account_idx
  on public.tax_documents (payment_previous_expense_account_id)
  where payment_previous_expense_account_id is not null;

comment on column public.tax_documents.payment_origin is
  'Cómo se registró el pago: pay (pay_tax_document creó el egreso) o link (link_tax_document_payment adoptó un egreso existente). NULL sin pago.';
comment on column public.tax_documents.payment_previous_expense_account_id is
  'La cuenta de gasto que tenía el movimiento vinculado antes de link_tax_document_payment; la devuelve undo_tax_document_payment.';

-- The guard freezes a paid document and would refuse the backfill; the
-- updated_at trigger would stamp rows nobody edited.
alter table public.tax_documents disable trigger tax_documents_guard;
alter table public.tax_documents disable trigger tax_documents_set_updated_at;

update public.tax_documents td
   set payment_origin = case
     when exists (
       select 1 from public.audit_events ae
        where ae.event_type = 'tax_document.payment_linked'
          and ae.target_resource_id = td.id::text
          and ae.payload ->> 'transaction_id' = td.payment_transaction_id::text
     ) then 'link'
     when exists (
       select 1 from public.audit_events ae
        where ae.event_type = 'tax_document.paid'
          and ae.target_resource_id = td.id::text
          and ae.payload ->> 'transaction_id' = td.payment_transaction_id::text
     ) or exists (
       select 1 from public.transactions t
        where t.id = td.payment_transaction_id
          and t.description = format('Pago de %s — período %s',
                public.tax_document_label(td.kind, td.title, td.jurisdiction),
                to_char(to_date(td.period, 'YYYY-MM'), 'MM/YYYY'))
     ) then 'pay'
     else 'link'
   end
 where td.payment_transaction_id is not null;

update public.tax_documents td
   set payment_previous_expense_account_id = prev.account_id
  from (
    select d.id,
           (select (ae.payload ->> 'expense_account_id')::uuid
              from public.audit_events ae
             where ae.event_type in ('transaction.created', 'transaction.updated')
               and ae.target_resource_id = d.payment_transaction_id::text
               and ae.payload ? 'expense_account_id'
               and ae.ts < coalesce((
                     select min(l.ts) from public.audit_events l
                      where l.event_type = 'tax_document.payment_linked'
                        and l.target_resource_id = d.id::text
                        and l.payload ->> 'transaction_id' = d.payment_transaction_id::text
                   ), 'infinity'::timestamptz)
             order by ae.ts desc
             limit 1) as account_id
      from public.tax_documents d
     where d.payment_origin = 'link'
  ) prev
 where td.id = prev.id
   and prev.account_id is not null
   and exists (select 1 from public.chart_of_accounts a where a.id = prev.account_id);

alter table public.tax_documents enable trigger tax_documents_set_updated_at;
alter table public.tax_documents enable trigger tax_documents_guard;

-- Every paid row got its origin above, so the existing rows already pass;
-- NOT VALID skips the scan, new and updated rows are checked.
alter table public.tax_documents
  add constraint tax_documents_payment_origin_known check (
    (payment_origin is null or payment_origin in ('pay', 'link'))
    and (payment_origin is null) = (payment_transaction_id is null)
    and (payment_previous_expense_account_id is null or payment_origin = 'link')
  ) not valid;

------------------------------------------------------------------------------
-- 2. guard_tax_document: the payment columns, and the undo
------------------------------------------------------------------------------

-- Same as 20261103190000 plus: the two new payment columns follow the paid
-- state (written only by pay/link), and undo_tax_document_payment may take a
-- paid document back to open.
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
       or new.payment_previous_expense_account_id is not null then
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
         or new.payment_previous_expense_account_id is not null) then
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
-- 3. pay and link record their origin
------------------------------------------------------------------------------

-- Same as 20261103170000 plus payment_origin = 'pay'.
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
         payment_origin = 'pay'
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

-- Same as 20261103190000 plus payment_origin = 'link' and the expense account
-- the movement had.
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
-- 4. undo_tax_document_payment
------------------------------------------------------------------------------

create function public.undo_tax_document_payment(
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
           when amount is not null and not amount_is_estimate then 'liquidado'
           else 'pendiente'
         end,
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
  'Deshace el pago de un impuesto: el documento vuelve a liquidado o pendiente; el egreso que creó "Pagar" se borra y el vinculado queda suelto con su cuenta de gasto anterior y el asiento rehecho. Rechaza un período cerrado y un pago creado conciliado con el extracto. Sin pago, no hace nada. Solo service role (la acción exige taxes:write y transactions:write).';

revoke all on function public.undo_tax_document_payment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.undo_tax_document_payment(uuid, uuid)
  to service_role;
