SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Impuestos como documento (roadmap 6.6). Expand-only: one table, one
-- nullable column on file_attachments, one RPC and replacements that keep
-- every signature and every existing source.
--
-- 1. tax_documents: one tax obligation (IVA posición mensual, IIBB,
--    anticipo de Ganancias, SICORE, F931, monotributo or another one named
--    by its title) per period, with its due date, amount (manual or an
--    estimate from the libro IVA) and status:
--      pendiente → liquidado → pagado, or anulado (from pendiente/liquidado).
--    taxes:read: owner, admin, finance, fiscal_reader; taxes:write: owner,
--    admin, finance (lib/auth/permissions.ts). guard_tax_document keeps a
--    paid document frozen (notes aside), an annulled one untouched, and the
--    paid state reachable only through pay_tax_document.
-- 2. file_attachments.tax_document_id: the VEP, DDJJ or payment receipt, as
--    any other attachable entity (files-patterns.md §11).
-- 3. pay_tax_document: the payment is a treasury movement owned by the
--    document, like a loan installment's: an expense in the fiscal channel,
--    posted by build_transaction_journal_lines as Debe the document's
--    account / Haber the cash or bank account. A payment dated in a closed
--    period is refused. transaction_is_loose, the owned-movement and
--    expense-account guards and v_transactions_tagged ('tax_document') learn
--    the new owner.
-- 4. Tareas: sync_automatic_tasks gains the source ('tax_documents',
--    'tax_document'): a pending or liquidated document due within 7 days,
--    closed by the sync once it is paid or annulled. Its row follows the
--    money ceiling (owner/admin/finance) of the tasks policies.

------------------------------------------------------------------------------
-- 1. tax_documents
------------------------------------------------------------------------------

create table public.tax_documents (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in (
                           'iva', 'iibb', 'ganancias_anticipo', 'sicore',
                           'cargas_sociales', 'monotributo', 'otro')),
  -- What the document is when the kind does not say it ("Bienes
  -- personales", "Tasa municipal"); optional detail otherwise.
  title                  text check (title is null or char_length(btrim(title)) between 1 and 120),
  -- IIBB: the province or "Convenio Multilateral".
  jurisdiction           text check (jurisdiction is null or char_length(btrim(jurisdiction)) between 1 and 60),
  period                 text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  due_date               date not null,
  amount                 numeric(18, 2) check (amount is null or amount > 0),
  -- The amount came from the libro IVA estimate and nobody typed it.
  amount_is_estimate     boolean not null default false,
  status                 text not null default 'pendiente'
                           check (status in ('pendiente', 'liquidado', 'pagado', 'anulado')),
  -- The account the payment debits (a tax liability or expense).
  account_id             uuid references public.chart_of_accounts (id) on delete restrict,
  payment_transaction_id uuid unique references public.transactions (id) on delete restrict,
  paid_date              date,
  paid_amount            numeric(18, 2) check (paid_amount is null or paid_amount > 0),
  notes                  text check (notes is null or char_length(notes) <= 1000),
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint tax_documents_other_has_title check (kind <> 'otro' or title is not null),
  constraint tax_documents_paid_has_payment check (
    (status = 'pagado')
      = (payment_transaction_id is not null and paid_date is not null and paid_amount is not null)
  ),
  constraint tax_documents_settled_has_amount check (
    status not in ('liquidado', 'pagado') or amount is not null
  ),
  constraint tax_documents_estimate_has_amount check (not amount_is_estimate or amount is not null)
);

comment on table public.tax_documents is
  'Obligaciones impositivas como documento (IVA, IIBB, Ganancias, SICORE, F931, monotributo, otras): período, vencimiento, importe y estado pendiente → liquidado → pagado / anulado. El pago lo registra pay_tax_document (egreso en caja + asiento).';

-- One live document per obligation and period.
create unique index tax_documents_obligation_unique
  on public.tax_documents (kind, period, coalesce(jurisdiction, ''), coalesce(title, ''))
  where status <> 'anulado';
create index tax_documents_status_due_idx on public.tax_documents (status, due_date);
create index tax_documents_account_idx on public.tax_documents (account_id);
create index tax_documents_created_by_idx on public.tax_documents (created_by);

create trigger tax_documents_set_updated_at
  before update on public.tax_documents
  for each row execute function public.set_updated_at();

-- taxes:read roles: owner, admin, finance, fiscal_reader (every tax document
-- is fiscal). taxes:write roles: owner, admin, finance. No delete policy: a
-- document is annulled, not deleted.
alter table public.tax_documents enable row level security;

create policy "Tax roles view tax documents" on public.tax_documents
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance', 'fiscal_reader'])) );

create policy "Tax writers create tax documents" on public.tax_documents
  for insert to authenticated
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance']))
    and created_by = (select auth.uid())
  );

create policy "Tax writers edit tax documents" on public.tax_documents
  for update to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance'])) )
  with check ( (select public.user_has_role(array['owner', 'admin', 'finance'])) );

revoke all on table public.tax_documents from public, anon;

-- The name a task, a movement and a screen give the document.
create function public.tax_document_label(p_kind text, p_title text, p_jurisdiction text)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' ',
    coalesce(
      case when p_kind = 'otro' then p_title end,
      case p_kind
        when 'iva' then 'IVA'
        when 'iibb' then 'IIBB'
        when 'ganancias_anticipo' then 'anticipo de Ganancias'
        when 'sicore' then 'SICORE'
        when 'cargas_sociales' then 'cargas sociales (F931)'
        when 'monotributo' then 'monotributo'
        else p_kind
      end),
    case when p_jurisdiction is not null then '(' || p_jurisdiction || ')' end);
$$;

revoke all on function public.tax_document_label(text, text, text) from public, anon, authenticated;

-- Insert: pendiente or liquidado, never paid. Update: an annulled document
-- is final; a paid one only takes notes; the paid state and its payment
-- columns are written by pay_tax_document alone; liquidado needs the
-- amount. The account must be an active leaf that can carry the debit.
create function public.guard_tax_document()
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
    if v_stack !~ 'function (public\.)?pay_tax_document\('
       and (new.status = 'pagado'
         or new.payment_transaction_id is not null
         or new.paid_date is not null
         or new.paid_amount is not null) then
      raise exception 'El pago de un impuesto se registra con "Pagar", que genera el egreso en caja y su asiento'
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

create trigger tax_documents_guard
  before insert or update on public.tax_documents
  for each row execute function public.guard_tax_document();

------------------------------------------------------------------------------
-- 2. file_attachments.tax_document_id
------------------------------------------------------------------------------

-- New, all-NULL column: the FK check has nothing to scan.
alter table public.file_attachments
  -- squawk-ignore adding-foreign-key-constraint
  add column tax_document_id uuid references public.tax_documents (id) on delete cascade;

-- The column is all NULL, so the partial index starts empty.
-- squawk-ignore require-concurrent-index-creation
create index file_attachments_tax_document_idx
  on public.file_attachments (tax_document_id)
  where tax_document_id is not null;

-- Every existing row has tax_document_id NULL, so it passes the new sum as
-- it passed the old one. Replaced right below.
alter table public.file_attachments
  -- squawk-ignore ban-drop-constraint
  drop constraint file_attachments_exactly_one_target;

alter table public.file_attachments
  add constraint file_attachments_exactly_one_target
  check (
    (purchase_invoice_id is not null)::int
    + (invoice_id is not null)::int
    + (receipt_id is not null)::int
    + (payment_order_id is not null)::int
    + (check_id is not null)::int
    + (issued_check_id is not null)::int
    + (client_id is not null)::int
    + (supplier_id is not null)::int
    + (transaction_id is not null)::int
    + (ai_chat_message_id is not null)::int
    + (fuel_load_id is not null)::int
    + (tax_document_id is not null)::int
    = 1
  ) not valid;

-- Same as 20261103020000 plus 'tax_document'.
create or replace view public.v_files_hub
with (security_invoker = on) as
  select
    fa.id                  as link_id,
    case
      when fa.purchase_invoice_id is not null then 'purchase_invoice'
      when fa.invoice_id          is not null then 'invoice'
      when fa.receipt_id          is not null then 'receipt'
      when fa.payment_order_id    is not null then 'payment_order'
      when fa.check_id            is not null then 'check'
      when fa.issued_check_id     is not null then 'issued_check'
      when fa.client_id           is not null then 'client'
      when fa.supplier_id         is not null then 'supplier'
      when fa.transaction_id      is not null then 'transaction'
      when fa.ai_chat_message_id  is not null then 'ai_chat_message'
      when fa.fuel_load_id        is not null then 'fuel_load'
      when fa.tax_document_id     is not null then 'tax_document'
    end                    as entity_type,
    coalesce(
      fa.purchase_invoice_id, fa.invoice_id, fa.receipt_id, fa.payment_order_id,
      fa.check_id, fa.issued_check_id, fa.client_id, fa.supplier_id,
      fa.transaction_id, fa.ai_chat_message_id, fa.fuel_load_id,
      fa.tax_document_id
    )                      as entity_id,
    m.session_id           as parent_id,
    s.user_id              as owner_id,
    fa.kind,
    fa.created_at          as linked_at,
    f.id                   as file_id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at           as uploaded_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as uploader_name
  from public.file_attachments fa
  join public.files f on f.id = fa.file_id
  left join public.ai_chat_messages m on m.id = fa.ai_chat_message_id
  left join public.ai_chat_sessions s on s.id = m.session_id
  left join public.user_profiles p on p.user_id = f.uploaded_by
  union all
  select
    e.id,
    'ai_document',
    e.id,
    null::uuid,
    e.created_by,
    coalesce(e.detected_type, 'other'),
    e.created_at,
    f.id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.ai_document_extractions e
  join public.files f on f.id = e.file_id
  left join public.user_profiles p on p.user_id = f.uploaded_by
  union all
  select
    d.id,
    'employee_document',
    d.id,
    d.employee_id,
    null::uuid,
    d.kind::text,
    d.created_at,
    f.id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.employee_documents d
  join public.files f on f.id = d.attachment_file_id
  left join public.user_profiles p on p.user_id = f.uploaded_by
  union all
  select
    d.id,
    'fleet_document',
    d.id,
    coalesce(d.vehicle_id, d.driver_id),
    null::uuid,
    d.kind,
    d.created_at,
    f.id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.fleet_documents d
  join public.files f on f.id = d.attachment_file_id
  left join public.user_profiles p on p.user_id = f.uploaded_by;

comment on view public.v_files_hub is
  'Una fila por (archivo, entidad dueña): adjuntos (incluidos los tickets de combustible y los VEP o DDJJ de impuestos), documentos de IA, de empleados y de flota. SECURITY INVOKER: aplica la RLS de cada tabla.';

revoke all on table public.v_files_hub from public, anon, authenticated;
grant select on table public.v_files_hub to authenticated;

------------------------------------------------------------------------------
-- 3. Paying: the movement the tax document owns
------------------------------------------------------------------------------

-- Same as 20261103060100 plus the tax document payment.
create or replace function public.build_transaction_journal_lines(
  p_transaction public.transactions,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role         public.coa_system_role;
  v_expense_role public.coa_system_role := 'gastos';
  v_pair         public.transactions;
  v_pair_role    public.coa_system_role;
  v_rate         numeric := 1;
  v_amount       numeric;
  v_inst         public.loan_installments;
  v_interest     numeric;
  v_iva          numeric;
  v_perception   numeric;
  v_capital      numeric;
  v_lines        jsonb;
  v_employee     boolean;
  v_tax_account  uuid;
begin
  if p_transaction.invoice_id is not null
     or p_transaction.receipt_id is not null
     or p_transaction.payment_order_id is not null
     or p_transaction.issued_check_id is not null
     or p_transaction.kind not in ('income', 'expense', 'transfer_in') then
    return null;
  end if;

  -- The journal is in pesos. No rate on or before the date: no entry, listed
  -- by journal_missing_entries as 'sin_cotizacion' (never posted at 1).
  if p_transaction.currency = 'USD' then
    v_rate := public.get_exchange_rate('USD', p_transaction.transaction_date);
    if v_rate is null then
      return null;
    end if;
  end if;
  v_amount := round(p_transaction.amount * v_rate, 2);

  v_role := public.coa_role_for_account(p_transaction.account_id);
  if v_role is null then
    raise warning 'build_transaction_journal_lines: account % sin mapping COA, asiento omitido', p_transaction.account_id;
    return null;
  end if;

  v_employee := exists (
      select 1 from public.employee_account_movements m where m.transaction_id = p_transaction.id
    ) and exists (
      select 1 from public.chart_of_accounts where system_role = 'anticipos_personal' and is_active
    );

  if p_transaction.kind = 'income' then
    -- A check a client handed over without a receipt pays on account: it
    -- credits clientes, like a receipt with no allocation. A loan
    -- disbursement is a liability; an employee's payment settles what they owe.
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case
          when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null then 'clientes'
          when exists (select 1 from public.loans l where l.disbursement_transaction_id = p_transaction.id)
            then 'prestamos'
          when v_employee then 'anticipos_personal'
          else 'ajustes_caja'
        end,
        'credit', v_amount, 'description', p_description)
    );
  elsif p_transaction.kind = 'expense' then
    if p_transaction.rejected_check_id is not null then
      v_expense_role := 'cheques_rechazados';
    elsif p_transaction.is_payroll and exists (
      select 1 from public.chart_of_accounts
       where system_role = 'sueldos' and is_active
    ) then
      v_expense_role := 'sueldos';
    elsif v_employee then
      v_expense_role := 'anticipos_personal';
    else
      -- A tax payment debits the tax document's account (the liability or
      -- the expense it settles).
      select td.account_id into v_tax_account
        from public.tax_documents td
       where td.payment_transaction_id = p_transaction.id;
      if v_tax_account is not null then
        return jsonb_build_array(
          jsonb_build_object('account_id', v_tax_account, 'debit', v_amount, 'description', p_description),
          jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description)
        );
      end if;

      select * into v_inst from public.loan_installments li
       where li.transaction_id = p_transaction.id;
      -- A split cuota paid for its amount: each component converted and
      -- rounded once, the capital takes the rounding so the entry balances.
      if v_inst.id is not null
         and v_inst.capital_amount is not null
         and v_inst.amount = p_transaction.amount then
        v_interest := round((v_inst.interest_amount + v_inst.other_charges_amount) * v_rate, 2);
        v_iva := round(v_inst.iva_amount * v_rate, 2);
        v_perception := round(v_inst.perception_amount * v_rate, 2);
        v_capital := v_amount - v_interest - v_iva - v_perception;
        if v_capital < 0 then
          v_interest := v_interest + v_capital;
          v_capital := 0;
        end if;
        v_lines := '[]'::jsonb;
        if v_capital > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'prestamos', 'debit', v_capital,
            'description', p_description || ' — capital');
        end if;
        if v_interest > 0 then
          v_lines := v_lines || jsonb_build_object(
            'system_role',
            case when exists (select 1 from public.chart_of_accounts
                               where system_role = 'intereses_pagados' and is_active)
                 then 'intereses_pagados' else 'gastos' end,
            'debit', v_interest, 'description', p_description || ' — intereses y cargos');
        end if;
        if v_iva > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'iva_credito', 'debit', v_iva,
            'description', p_description || ' — IVA');
        end if;
        if v_perception > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'percepciones_iibb_pagadas', 'debit', v_perception,
            'description', p_description || ' — percepción');
        end if;
        return v_lines || jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description);
      end if;

      if p_transaction.expense_account_id is not null then
        return jsonb_build_array(
          jsonb_build_object('account_id', p_transaction.expense_account_id, 'debit', v_amount, 'description', p_description),
          jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description)
        );
      end if;
    end if;
    return jsonb_build_array(
      jsonb_build_object('system_role', v_expense_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description)
    );
  end if;

  select * into v_pair from public.transactions where id = p_transaction.transfer_pair_id;
  if v_pair.id is null then
    raise warning 'build_transaction_journal_lines: transfer_in % sin par, asiento omitido', p_transaction.id;
    return null;
  end if;
  v_pair_role := public.coa_role_for_account(v_pair.account_id);
  if v_pair_role is null then
    raise warning 'build_transaction_journal_lines: par % sin mapping COA, asiento omitido', v_pair.account_id;
    return null;
  end if;
  return jsonb_build_array(
    jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description || ' (entrada)'),
    jsonb_build_object('system_role', v_pair_role::text, 'credit', v_amount, 'description', p_description || ' (salida)')
  );
end;
$$;

revoke all on function public.build_transaction_journal_lines(public.transactions, text) from public, anon, authenticated;

-- Same as 20261103100200 plus the tax document payment.
create or replace function public.transaction_is_loose(p_tx public.transactions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tx.invoice_id is null
     and p_tx.receipt_id is null
     and p_tx.payment_order_id is null
     and p_tx.issued_check_id is null
     and p_tx.rejected_check_id is null
     and p_tx.manual_check_id is null
     and p_tx.check_sale_id is null
     and p_tx.transfer_pair_id is null
     and not p_tx.is_payroll
     and not exists (select 1 from public.payroll_payments where transaction_id = p_tx.id)
     and not exists (select 1 from public.loan_installments where transaction_id = p_tx.id)
     and not exists (select 1 from public.loans where disbursement_transaction_id = p_tx.id)
     and not exists (select 1 from public.check_movements where transaction_id = p_tx.id)
     and not exists (select 1 from public.account_opening_balances where adjustment_transaction_id = p_tx.id)
     and not exists (select 1 from public.employee_account_movements where transaction_id = p_tx.id)
     and not exists (select 1 from public.tax_documents where payment_transaction_id = p_tx.id);
$$;
revoke all on function public.transaction_is_loose(public.transactions) from public, anon, authenticated;

-- Same as 20261103140100 plus the tax document payment.
create or replace function public.guard_transaction_owned_by_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
  v_owner text;
begin
  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(update_receipt|update_payment_order|apply_account_opening_balance|clear_account_opening_balance|undo_import_run)\(' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if (old.rejected_check_id is not null
        or old.manual_check_id is not null
        or old.check_sale_id is not null
        or exists (select 1 from public.payroll_payments where transaction_id = old.id)
        or exists (select 1 from public.loan_installments where transaction_id = old.id)
        or exists (select 1 from public.loans where disbursement_transaction_id = old.id)
        or exists (select 1 from public.check_movements where transaction_id = old.id)
        or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
        or exists (select 1 from public.employee_account_movements where transaction_id = old.id)
        or exists (select 1 from public.tax_documents where payment_transaction_id = old.id))
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id
         or new.check_sale_id    is distinct from old.check_sale_id) then
      raise exception
        'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un documento (sueldo, préstamo, cheque, saldo inicial, impuesto o cuenta corriente de un empleado): editá el documento de origen'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  v_owner := case
    when old.receipt_id is not null then 'un recibo'
    when old.payment_order_id is not null then 'una orden de pago'
    when old.invoice_id is not null then 'un comprobante'
    when old.issued_check_id is not null then 'el cobro de un cheque propio'
    when old.rejected_check_id is not null then 'un cheque rechazado'
    when old.manual_check_id is not null then 'un cheque cargado a mano'
    when old.check_sale_id is not null then 'una venta de cheques'
    when exists (select 1 from public.loan_installments where transaction_id = old.id)
      then 'una cuota de préstamo'
    when exists (select 1 from public.loans where disbursement_transaction_id = old.id)
      then 'el desembolso de un préstamo'
    when exists (select 1 from public.payroll_payments where transaction_id = old.id)
      then 'un pago de sueldo'
    when exists (select 1 from public.check_movements where transaction_id = old.id)
      then 'un movimiento de cheque'
    when exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
      then 'un saldo inicial de cuenta'
    when exists (select 1 from public.employee_account_movements where transaction_id = old.id)
      then 'la cuenta corriente de un empleado'
    when exists (select 1 from public.tax_documents where payment_transaction_id = old.id)
      then 'el pago de un impuesto'
  end;
  if v_owner is not null then
    raise exception
      'No se puede borrar un movimiento generado por %: anulá o editá el documento de origen', v_owner
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_transaction_owned_by_document() from public, anon, authenticated;

-- Same as 20261103060100 plus the tax document payment.
create or replace function public.guard_transaction_expense_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.expense_account_id is null then
    return new;
  end if;
  if new.kind <> 'expense'
     or new.invoice_id is not null
     or new.receipt_id is not null
     or new.payment_order_id is not null
     or new.issued_check_id is not null
     or new.rejected_check_id is not null
     or new.manual_check_id is not null
     or new.transfer_pair_id is not null
     or new.is_payroll
     or exists (select 1 from public.payroll_payments where transaction_id = new.id)
     or exists (select 1 from public.loan_installments where transaction_id = new.id)
     or exists (select 1 from public.check_movements where transaction_id = new.id)
     or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = new.id)
     or exists (select 1 from public.employee_account_movements where transaction_id = new.id)
     or exists (select 1 from public.tax_documents where payment_transaction_id = new.id) then
    raise exception 'Solo un egreso manual lleva cuenta de gasto: el de un documento se imputa desde el documento'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if (tg_op = 'INSERT' or new.expense_account_id is distinct from old.expense_account_id)
     and not public.is_postable_expense_account(new.expense_account_id) then
    raise exception 'La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_transaction_expense_account() from public, anon, authenticated;

-- Same as 20261103100200 plus 'tax_document'.
create or replace view public.v_transactions_tagged with (security_invoker = on) as
  select
    t.id,
    t.account_id,
    t.channel_id,
    t.kind,
    t.amount,
    t.currency,
    t.transaction_date,
    t.accrual_month,
    t.description,
    t.invoice_id,
    t.counterparty_client_id,
    t.transfer_pair_id,
    t.created_by,
    t.created_at,
    t.updated_at,
    c.is_fiscal as channel_is_fiscal,
    c.name as channel_name,
    a.name as account_name,
    a.type as account_type,
    t.receipt_id,
    t.payment_order_id,
    t.rejected_check_id,
    t.issued_check_id,
    t.is_payroll,
    case
      when t.receipt_id is not null then 'receipt'
      when t.payment_order_id is not null then 'payment_order'
      when t.invoice_id is not null then 'invoice'
      when t.issued_check_id is not null then 'issued_check'
      when t.rejected_check_id is not null then 'rejected_check'
      when t.manual_check_id is not null then 'manual_check'
      when t.check_sale_id is not null then 'check_sale'
      when t.is_payroll
        or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
        then 'payroll'
      when exists (select 1 from public.loan_installments li where li.transaction_id = t.id)
        then 'loan_installment'
      when exists (select 1 from public.loans l where l.disbursement_transaction_id = t.id)
        then 'loan_disbursement'
      when exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
        then 'check_movement'
      when exists (select 1 from public.account_opening_balances aob where aob.adjustment_transaction_id = t.id)
        then 'account_opening_balance'
      when exists (select 1 from public.employee_account_movements eam where eam.transaction_id = t.id)
        then 'employee_account'
      when exists (select 1 from public.tax_documents td where td.payment_transaction_id = t.id)
        then 'tax_document'
    end as source_document,
    t.cost_center_id,
    t.expense_account_id
  from public.transactions t
  join public.invoicing_channels c on c.id = t.channel_id
  join public.accounts a on a.id = t.account_id;

-- Pays a pending or liquidated tax document from a cash or bank account in
-- pesos: books the outflow in the fiscal channel, links it to the document
-- (status pagado) and re-posts it so the entry debits the document's account.
create function public.pay_tax_document(
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
         paid_amount = p_amount
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

------------------------------------------------------------------------------
-- 4. Tareas: tax due dates
------------------------------------------------------------------------------

-- Every row the old check accepted passes the new, wider one, so it needs no
-- validation scan. Replaced right below. The tasks policies already put
-- 'tax_documents' under the money ceiling (owner/admin/finance).
alter table public.tasks
  -- squawk-ignore ban-drop-constraint
  drop constraint tasks_source_known;

alter table public.tasks
  add constraint tasks_source_known check (
    source_table is null
    or (source_table, kind) in (
      ('purchase_invoices', 'supplier_payment'),
      ('invoices', 'collection'),
      ('loan_installments', 'loan_installment'),
      ('issued_checks', 'issued_check'),
      ('fleet_documents', 'fleet_document'),
      ('employee_documents', 'employee_document'),
      ('vehicle_km_readings', 'vehicle_km'),
      ('tax_documents', 'tax_document')
    )
  ) not valid;

-- The documents that need action as of p_today (the Argentine day):
--   supplier_payment   a purchase factura/ND with a balance, due within 7 days;
--   collection         a sales factura/ND with a balance, past its due date;
--   loan_installment   a pending installment of an active loan, due within 7 days;
--   issued_check       an own check still emitted, due within 7 days;
--   fleet_document     a document of an active vehicle/driver expiring within
--                      30 days with no later one of its kind past that window;
--   employee_document  the same for an active employee;
--   vehicle_km         the month of p_today while an active motor vehicle
--                      has no km reading for it, due on day 5;
--   tax_document       a pending or liquidated tax document due within 7 days.
-- Each one is upserted on (source_table, source_id, kind): a new one is
-- created; an existing one gets the document's title and due date (unless a
-- user moved it) and, if the sync had closed it, opens again. An open
-- automatic task whose document left the list is closed (auto_closed). A task
-- a user closed stays closed. Returns every task it touched with the change.

create or replace function public.sync_automatic_tasks(p_today date)
returns table (task_id uuid, kind text, change text)
language sql
volatile
security invoker
set search_path = ''
as $$
  with desired as (
    select
      'purchase_invoices'::text as source_table,
      d.purchase_invoice_id as source_id,
      'supplier_payment'::text as kind,
      format('Pagar a %s: %s', s.legal_name, concat_ws(' ',
        case d.kind when 'nd' then 'ND' else 'Factura' end,
        d.letter,
        lpad(d.punto_venta::text, 4, '0') || '-' || lpad(d.numero::text, 8, '0'))) as title,
      coalesce(d.fch_vto_pago, d.fecha) as due_date
    from public.v_supplier_aging_documents d
    join public.suppliers s on s.id = d.supplier_id
    where coalesce(d.fch_vto_pago, d.fecha) <= p_today + 7

    union all

    select
      'invoices',
      d.invoice_id,
      'collection',
      format('Cobrar a %s: %s', c.legal_name, concat_ws(' ',
        case d.kind when 'nd' then 'ND' else 'Factura' end,
        d.letter,
        lpad(d.punto_venta::text, 4, '0') || '-' || coalesce(lpad(d.numero::text, 8, '0'), 's/n'))),
      coalesce(d.fch_vto_pago, d.fecha)
    from public.v_aging_documents d
    join public.clients c on c.id = d.client_id
    where d.document_type = 'invoice'
      and coalesce(d.fch_vto_pago, d.fecha) < p_today

    union all

    select
      'loan_installments',
      li.id,
      'loan_installment',
      format('Pagar cuota %s de %s', li.number, l.description),
      li.due_date
    from public.loan_installments li
    join public.loans l on l.id = li.loan_id
    where li.status = 'pendiente'
      and l.status = 'active'
      and li.due_date <= p_today + 7

    union all

    select
      'issued_checks',
      ic.id,
      'issued_check',
      format('Cubrir cheque propio N° %s (%s)', ic.check_number, ic.bank_name),
      ic.due_date
    from public.issued_checks ic
    where ic.status = 'emitted'
      and ic.due_date <= p_today + 7

    union all

    select
      'fleet_documents',
      fd.id,
      'fleet_document',
      format('Renovar %s de %s', replace(fd.kind, '_', ' '), coalesce(v.patente, dr.full_name)),
      fd.expires_at
    from public.fleet_documents fd
    left join public.vehicles v on v.id = fd.vehicle_id
    left join public.drivers dr on dr.id = fd.driver_id
    where fd.expires_at <= p_today + 30
      and coalesce(v.is_active, dr.is_active, false)
      and not exists (
        select 1 from public.fleet_documents n
         where n.id <> fd.id
           and n.kind = fd.kind
           and n.vehicle_id is not distinct from fd.vehicle_id
           and n.driver_id is not distinct from fd.driver_id
           and n.expires_at > p_today + 30
      )

    union all

    select
      'employee_documents',
      ed.id,
      'employee_document',
      format('Renovar %s de %s', replace(ed.kind::text, '_', ' '), e.legal_name),
      ed.expires_at
    from public.employee_documents ed
    join public.employees e on e.id = ed.employee_id
    where ed.expires_at <= p_today + 30
      and e.is_active
      and not exists (
        select 1 from public.employee_documents n
         where n.id <> ed.id
           and n.employee_id = ed.employee_id
           and n.kind = ed.kind
           and n.expires_at > p_today + 30
      )

    union all

    select
      'vehicle_km_readings',
      md5('vehicle_km:' || m.period)::uuid,
      'vehicle_km',
      format('Cargar km de %s %s',
        (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])
          [extract(month from p_today)::int],
        extract(year from p_today)::int),
      make_date(extract(year from p_today)::int, extract(month from p_today)::int, 5)
    from (select to_char(p_today, 'YYYY-MM') as period) m
    where exists (
      select 1 from public.vehicles v
       where v.is_active
         and v.vehicle_type not in ('acoplado', 'semi')
         and not exists (
           select 1 from public.vehicle_km_readings r
            where r.vehicle_id = v.id
              and r.period = m.period
         )
    )

    union all

    select
      'tax_documents',
      td.id,
      'tax_document',
      format('Pagar %s del período %s',
        public.tax_document_label(td.kind, td.title, td.jurisdiction),
        to_char(to_date(td.period, 'YYYY-MM'), 'MM/YYYY')),
      td.due_date
    from public.tax_documents td
    where td.status in ('pendiente', 'liquidado')
      and td.due_date <= p_today + 7
  ),
  upserted as (
    insert into public.tasks as t (title, due_date, origin, kind, source_table, source_id)
    select d.title, d.due_date, 'automatic', d.kind, d.source_table, d.source_id
      from desired d
    on conflict (source_table, source_id, kind) do update
      set title = excluded.title,
          due_date = case when t.due_date_locked then t.due_date else excluded.due_date end,
          notified_stage = case
            when t.due_date_locked or t.due_date = excluded.due_date then t.notified_stage
          end,
          status = case when t.auto_closed then 'open' else t.status end,
          completed_at = case when t.auto_closed then null else t.completed_at end,
          auto_closed = false
      where t.title is distinct from excluded.title
         or (not t.due_date_locked and t.due_date is distinct from excluded.due_date)
         or t.auto_closed
    returning t.id, t.kind, (t.xmax = 0) as inserted
  ),
  closed as (
    update public.tasks t
       set status = 'done',
           completed_at = now(),
           completed_by = null,
           auto_closed = true
     where t.origin = 'automatic'
       and t.status = 'open'
       and not exists (
         select 1 from desired d
          where d.source_table = t.source_table
            and d.source_id = t.source_id
            and d.kind = t.kind
       )
    returning t.id, t.kind
  )
  select u.id, u.kind, case when u.inserted then 'created' else 'updated' end
    from upserted u
  union all
  select c.id, c.kind, 'closed'
    from closed c;
$$;

comment on function public.sync_automatic_tasks(date) is
  'Crea, actualiza y cierra las tareas automáticas según los documentos pendientes al día p_today (cron tasks-daily). Idempotente.';

revoke all on function public.sync_automatic_tasks(date) from public, anon, authenticated;
grant execute on function public.sync_automatic_tasks(date) to service_role;

