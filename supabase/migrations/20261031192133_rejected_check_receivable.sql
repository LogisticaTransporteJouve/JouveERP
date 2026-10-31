SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- D11: a rejected check is not an expense. With the bank's constancia the
-- check is a título ejecutivo against the drawer and endorsers (Ley 24.452),
-- so the amount becomes a receivable, "Deudores por cheques rechazados",
-- against the account the check was in:
--   * depositado: the bank account of the deposit (debit cheques_rechazados /
--     credit banco), with an outflow from that account;
--   * en_cartera: the check's cartera account (debit cheques_rechazados /
--     credit cheques_cartera), with an outflow from that account;
--   * endosado: the supplier debt comes back (debit cheques_rechazados /
--     credit proveedores); the check had already left the cartera.
-- Fiscal channel only, as every journal. Writing the receivable off is a
-- separate, explicit action.

-- 1. Account ------------------------------------------------------------------

-- Next free code under 1.1.2 (Créditos por ventas). A chart without 1.1.2 gets
-- no row: the posting then warns and is skipped, like any missing role.
insert into public.chart_of_accounts (parent_id, code, name, level, account_type, system_role)
select p.id,
       '1.1.2.' || (
         select coalesce(max(substring(c.code from '^1\.1\.2\.([0-9]+)$')::int), 0) + 1
           from public.chart_of_accounts c
          where c.code ~ '^1\.1\.2\.[0-9]+$'
       ),
       'Deudores por cheques rechazados', 4, 'activo', 'cheques_rechazados'
  from public.chart_of_accounts p
 where p.code = '1.1.2'
   and not exists (
     select 1 from public.chart_of_accounts
      where system_role = 'cheques_rechazados' and is_active
   );

-- 2. Rejection outflow --------------------------------------------------------

-- The outflow a rejection writes on the account the check was in. The builder
-- reads it to post the receivable instead of an expense. A rejected check
-- cannot be deleted (guard_check_delete_in_lifecycle), so RESTRICT never fires
-- on a live flow.
alter table public.transactions
  -- squawk-ignore adding-foreign-key-constraint
  add column rejected_check_id uuid references public.checks (id) on delete restrict;

comment on column public.transactions.rejected_check_id is
  'Cheque rechazado cuyo egreso es este movimiento (lo escribe reject_check). Asienta Deudores por cheques rechazados, no gastos.';

-- The column is new and all NULL: nothing to index, so the lock is momentary.
-- CONCURRENTLY cannot run in this migration's transaction.
-- squawk-ignore require-concurrent-index-creation
create unique index transactions_rejected_check_unique
  on public.transactions (rejected_check_id) where rejected_check_id is not null;

-- 3. Transaction builder ------------------------------------------------------

-- NULL when the movement posts nothing: tied to an invoice, receipt or payment
-- order (their own entry covers it), the transfer_out half of a transfer (the
-- transfer_in posts both sides), or an account without a COA role.
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
  v_role      public.coa_system_role;
  v_pair      public.transactions;
  v_pair_role public.coa_system_role;
begin
  if p_transaction.invoice_id is not null
     or p_transaction.receipt_id is not null
     or p_transaction.payment_order_id is not null
     or p_transaction.kind not in ('income', 'expense', 'transfer_in') then
    return null;
  end if;

  v_role := public.coa_role_for_account(p_transaction.account_id);
  if v_role is null then
    raise warning 'build_transaction_journal_lines: account % sin mapping COA, asiento omitido', p_transaction.account_id;
    return null;
  end if;

  if p_transaction.kind = 'income' then
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', p_transaction.amount, 'description', p_description),
      jsonb_build_object('system_role', 'ajustes_caja', 'credit', p_transaction.amount, 'description', p_description)
    );
  elsif p_transaction.kind = 'expense' then
    return jsonb_build_array(
      jsonb_build_object(
        'system_role', case when p_transaction.rejected_check_id is not null
                            then 'cheques_rechazados' else 'gastos' end,
        'debit', p_transaction.amount, 'description', p_description),
      jsonb_build_object('system_role', v_role::text, 'credit', p_transaction.amount, 'description', p_description)
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
    jsonb_build_object('system_role', v_role::text, 'debit', p_transaction.amount, 'description', p_description || ' (entrada)'),
    jsonb_build_object('system_role', v_pair_role::text, 'credit', p_transaction.amount, 'description', p_description || ' (salida)')
  );
end;
$$;

revoke all on function public.build_transaction_journal_lines(public.transactions, text) from public, anon, authenticated;

-- 4. reject_check -------------------------------------------------------------

-- The outflow goes on the account the check is in: the deposit's bank account
-- (p_account_id may only repeat it; it is used only for a deposit with no
-- recorded account) or the cartera account. An endorsed check has already left
-- the cartera: no outflow, emit_journal_for_endorsed_check_rejected posts the
-- supplier debt back.
create or replace function public.reject_check(
  p_check_id   uuid,
  p_account_id uuid,
  p_event_date date,
  p_channel_id text,
  p_notes      text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_channel      text;
  v_account_id   uuid;
  v_tx_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  -- Role guard (cheques:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para rechazar cheques'
      using errcode = '42501';
  end if;

  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status not in ('depositado', 'en_cartera', 'endosado') then
    raise exception 'check % está en estado % — solo se puede rechazar desde depositado, en_cartera o endosado',
      p_check_id, v_check.status;
  end if;

  if v_check.channel_id is not null then
    if p_channel_id is not null and p_channel_id <> v_check.channel_id then
      raise exception 'El cheque ya tiene canal: el rechazo va en el canal del cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_channel := v_check.channel_id;
  elsif p_channel_id is null then
    raise exception 'El cheque no tiene canal: elegí el canal del rechazo'
      using errcode = '23514', hint = 'jouve_guard';
  else
    v_channel := p_channel_id;
  end if;

  if v_check.status = 'depositado' then
    select m.destination_account_id into v_account_id
      from public.check_movements m
     where m.check_id = p_check_id and m.event = 'deposited'
     order by m.created_at desc, m.id desc
     limit 1;
    if v_account_id is null then
      v_account_id := p_account_id;
    elsif p_account_id is not null and p_account_id <> v_account_id then
      raise exception 'El rechazo sale de la cuenta donde se depositó el cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_account_id is null then
      raise exception 'El cheque no tiene cuenta de depósito: elegí la cuenta del rechazo'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  elsif v_check.status = 'en_cartera' then
    v_account_id := v_check.cartera_account_id;
  end if;

  if v_account_id is not null then
    v_accrual := date_trunc('month', p_event_date)::date;
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, rejected_check_id, created_by
    ) values (
      v_account_id, v_channel, 'expense',
      v_check.amount, v_check.currency, p_event_date, v_accrual,
      'Cheque rechazado ' || v_check.check_number, p_check_id, auth.uid()
    )
    returning id into v_tx_id;
  end if;

  update public.checks
     set status = 'rechazado',
         channel_id = v_channel
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, transaction_id, notes, created_by
  ) values (
    p_check_id, 'rejected', p_event_date, v_account_id, v_tx_id,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.reject_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.reject_check(uuid, uuid, date, text, text) to authenticated, service_role;

-- 5. Endorsed check bounced ---------------------------------------------------

create or replace function public.emit_journal_for_endorsed_check_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id      uuid;
  v_po_channel text;
  v_amount     numeric;
  v_desc       text;
begin
  if old.status <> 'endosado' or new.status <> 'rechazado' then
    return new;
  end if;

  select pl.payment_order_id, po.channel_id, pl.amount
    into v_po_id, v_po_channel, v_amount
    from public.payment_order_payment_lines pl
    join public.payment_orders po on po.id = pl.payment_order_id
   where pl.endorsed_check_id = new.id
     and po.status <> 'canceled'
   order by po.created_at desc, po.id desc
   limit 1;

  if v_po_id is null then
    raise warning 'Cheque endosado % rechazado sin OP asociada — no se emite reversal', new.id;
    return new;
  end if;

  if not public.is_channel_fiscal(v_po_channel) then
    return new;
  end if;

  v_desc := 'Rechazo cheque endosado #' || new.check_number || ' ' || new.bank_name;

  begin
    perform public.create_journal_entry(
      p_entry_date     := current_date,
      p_accrual_period := to_char(current_date, 'YYYY-MM'),
      p_description    := v_desc,
      p_lines          := jsonb_build_array(
        jsonb_build_object('system_role', 'cheques_rechazados', 'debit',  v_amount, 'description', v_desc || ' — deudor por cheque rechazado'),
        jsonb_build_object('system_role', 'proveedores',        'credit', v_amount, 'description', v_desc || ' — deuda vuelve')
      ),
      p_source_table   := 'checks',
      p_source_id      := new.id,
      p_channel_id     := v_po_channel
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_endorsed_check_rejected: % (check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

revoke all on function public.emit_journal_for_endorsed_check_rejected() from public, anon, authenticated;
grant execute on function public.emit_journal_for_endorsed_check_rejected() to service_role;

-- 6. Client account statement -------------------------------------------------

-- A check of an issued receipt that bounced: the client owes it again. The
-- receipt's allocations stay (the invoice reads paid); this row puts the debt
-- back in the running balance. Dated on the rejection, shown with the
-- receipt's number.
create or replace view public.v_client_account_movements with (security_invoker = on) as
  select
    'invoice'::text                      as source_type,
    c.id                                 as source_id,
    c.client_id,
    c.fecha                              as movement_date,
    c.created_at,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    case when c.kind = 'nc' then -1::numeric * c.imp_total else c.imp_total end as signed_amount,
    c.imp_total                          as gross_amount,
    c.channel_id,
    ch.division                          as channel_division,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    c.status
  from public.invoices c
  join public.invoicing_channels ch on ch.id = c.channel_id
  where c.status = 'emitted'
  union all
  select
    'receipt'::text                      as source_type,
    r.id                                 as source_id,
    r.client_id,
    r.receipt_date                       as movement_date,
    r.created_at,
    'receipt'::text                      as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    -1::numeric * r.total_amount         as signed_amount,
    r.total_amount                       as gross_amount,
    r.channel_id,
    ch.division                          as channel_division,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    r.status
  from public.receipts r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.status = 'issued'
  union all
  select
    'opening_balance'::text              as source_type,
    null::uuid                           as source_id,
    ob.client_id,
    ob.opening_date                      as movement_date,
    ob.created_at,
    'opening_balance'::text              as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    ob.target_balance                    as signed_amount,
    ob.target_balance                    as gross_amount,
    null::text                           as channel_id,
    null::text                           as channel_division,
    null::boolean                        as channel_is_fiscal,
    null::text                           as channel_name,
    'issued'::text                       as status
  from public.client_opening_balances ob
  union all
  select
    'rejected_check'::text               as source_type,
    k.id                                 as source_id,
    r.client_id,
    coalesce(rej.event_date, k.updated_at::date) as movement_date,
    coalesce(rej.created_at, k.updated_at)       as created_at,
    'rejected_check'::text               as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    k.amount                             as signed_amount,
    k.amount                             as gross_amount,
    r.channel_id,
    ch.division                          as channel_division,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status
  from public.checks k
  join public.receipts r on r.id = k.source_receipt_id
  join public.invoicing_channels ch on ch.id = r.channel_id
  left join lateral (
    select m.event_date, m.created_at
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  where k.status = 'rechazado'
    and r.status = 'issued';
