SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 1.1 + 1.2 + 1.8: a cost is loaded once with its expense account
-- (rubro) and its cost center.
--
--   1. is_postable_expense_account(id): an active result-negative leaf of the
--      chart (expense_leaf_accounts). guard_expense_account checks it on
--      purchase_invoices.account_id (until now only the create action did) and
--      on the new suppliers.default_expense_account_id. The purchase guard
--      fires before purchase_invoices_nc_nd_inherit_account (trigger names
--      sort), so an account an NC/ND inherits from its origin is not checked
--      again.
--   2. suppliers.default_expense_account_id / default_cost_center_id: the
--      purchase form starts a new factura with them.
--   3. transactions.expense_account_id: a manual expense debits that account
--      instead of the 'gastos' role (build_transaction_journal_lines); NULL
--      posts exactly as before. guard_transaction_expense_account allows it
--      only on a loose expense (no document owns it) and only on a postable
--      expense account. Editing it re-posts (transactions_repost_journal).
--      v_transactions_tagged exposes it and cost_center_id.
--   4. search_purchase_invoices returns account_id and cost_center_id.
--   5. get_management_pnl returns the cost center of each row (the entry's,
--      the internal document's, or the movement's) and reads a manual
--      expense's account in percibido too. Same parameters; older code sums
--      the extra rows as before.
--
-- Existing rows are not touched: every new column starts NULL and the guards
-- only check writes that set or change the account.

-- 1. Postable expense accounts ---------------------------------------------------

create function public.is_postable_expense_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.expense_leaf_accounts where id = p_account_id);
$$;

comment on function public.is_postable_expense_account(uuid) is
  'Cuenta de gasto imputable: activa, de resultado negativo y sin subcuentas activas (expense_leaf_accounts).';

revoke all on function public.is_postable_expense_account(uuid) from public, anon, authenticated;

-- The column to check is the trigger's first argument.
create function public.guard_expense_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_old uuid := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> tg_argv[0])::uuid end;
begin
  if v_new is not null
     and v_new is distinct from v_old
     and not public.is_postable_expense_account(v_new) then
    raise exception 'La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_expense_account() from public, anon, authenticated;

create trigger purchase_invoices_guard_expense_account
  before insert or update of account_id on public.purchase_invoices
  for each row execute function public.guard_expense_account('account_id');

-- 2. Supplier defaults -------------------------------------------------------------

alter table public.suppliers
  -- squawk-ignore adding-foreign-key-constraint
  add column default_expense_account_id uuid references public.chart_of_accounts (id) on delete set null,
  -- squawk-ignore adding-foreign-key-constraint
  add column default_cost_center_id uuid references public.cost_centers (id) on delete set null;

comment on column public.suppliers.default_expense_account_id is
  'Cuenta de gasto con la que el formulario de compras empieza una factura de este proveedor (opcional).';
comment on column public.suppliers.default_cost_center_id is
  'Centro de costo con el que el formulario de compras empieza una factura de este proveedor (opcional).';

-- squawk-ignore require-concurrent-index-creation
create index suppliers_default_expense_account_idx
  on public.suppliers (default_expense_account_id) where default_expense_account_id is not null;
-- squawk-ignore require-concurrent-index-creation
create index suppliers_default_cost_center_idx
  on public.suppliers (default_cost_center_id) where default_cost_center_id is not null;

create trigger suppliers_guard_expense_account
  before insert or update of default_expense_account_id on public.suppliers
  for each row execute function public.guard_expense_account('default_expense_account_id');

-- 3. Expense account of a manual expense -------------------------------------------

alter table public.transactions
  -- squawk-ignore adding-foreign-key-constraint
  add column expense_account_id uuid references public.chart_of_accounts (id) on delete restrict;

comment on column public.transactions.expense_account_id is
  'Cuenta de gasto de un egreso manual: el asiento la debita en vez del rol gastos. NULL = gastos.';

-- squawk-ignore require-concurrent-index-creation
create index transactions_expense_account_idx
  on public.transactions (expense_account_id) where expense_account_id is not null;

create function public.guard_transaction_expense_account()
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
     or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = new.id) then
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

create trigger transactions_guard_expense_account
  before insert or update of expense_account_id, kind on public.transactions
  for each row execute function public.guard_transaction_expense_account();

-- Same as 20261102240000 except the expense line: the movement's
-- expense_account_id when it has one, else the role.
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

  if p_transaction.kind = 'income' then
    -- A check a client handed over without a receipt pays on account: it
    -- credits clientes, like a receipt with no allocation.
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null
             then 'clientes' else 'ajustes_caja' end,
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
    elsif p_transaction.expense_account_id is not null then
      return jsonb_build_array(
        jsonb_build_object('account_id', p_transaction.expense_account_id, 'debit', v_amount, 'description', p_description),
        jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description)
      );
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

-- Changing the account re-posts, like the other columns the entry reads.
drop trigger transactions_repost_journal on public.transactions;
create constraint trigger transactions_repost_journal
  after update of amount, transaction_date, accrual_month, account_id, channel_id, kind,
                  cost_center_id, expense_account_id
  on public.transactions
  deferrable initially deferred
  for each row execute function public.repost_journal_trigger();

-- Same as 20261102220000 plus the two cost columns at the end.
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
      when t.is_payroll
        or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
        then 'payroll'
      when exists (select 1 from public.loan_installments li where li.transaction_id = t.id)
        then 'loan_installment'
      when exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
        then 'check_movement'
      when exists (select 1 from public.account_opening_balances aob where aob.adjustment_transaction_id = t.id)
        then 'account_opening_balance'
    end as source_document,
    t.cost_center_id,
    t.expense_account_id
  from public.transactions t
  join public.invoicing_channels c on c.id = t.channel_id
  join public.accounts a on a.id = t.account_id;

-- 4. Purchase search with account and cost center ---------------------------------

-- squawk-ignore ban-drop-function
drop function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid, boolean);

create function public.search_purchase_invoices(
  p_query        text default '',
  p_supplier_id  uuid default null,
  p_channel_id   text default null,
  p_status       text default null,
  p_fecha_from   date default null,
  p_fecha_to     date default null,
  p_offset       int  default 0,
  p_limit        int  default 50,
  p_kind         text default null,
  p_exclude_id   uuid default null,
  p_is_fiscal    boolean default null
)
returns table (
  id                  uuid,
  channel_id          text,
  supplier_id         uuid,
  supplier_legal_name text,
  supplier_cuit       text,
  kind                text,
  letter              char(1),
  punto_venta         int,
  numero              int,
  fecha               date,
  fch_vto_pago        date,
  imp_neto            numeric,
  imp_iva             numeric,
  imp_trib            numeric,
  imp_total           numeric,
  moneda              text,
  cotizacion          numeric,
  cae_proveedor       text,
  cae_vto_proveedor   date,
  status              text,
  invoice_origin_id   uuid,
  motivo_nc_nd        text,
  notes               text,
  created_by          uuid,
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  created_at          timestamptz,
  updated_at          timestamptz,
  account_id          uuid,
  cost_center_id      uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select
    pi.id,
    pi.channel_id,
    pi.supplier_id,
    s.legal_name as supplier_legal_name,
    s.cuit as supplier_cuit,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    pi.fecha,
    pi.fch_vto_pago,
    pi.imp_neto,
    pi.imp_iva,
    pi.imp_trib,
    pi.imp_total,
    pi.moneda,
    pi.cotizacion,
    pi.cae_proveedor,
    pi.cae_vto_proveedor,
    pi.status,
    pi.invoice_origin_id,
    pi.motivo_nc_nd,
    pi.notes,
    pi.created_by,
    pi.cancelled_at,
    pi.cancelled_by,
    pi.created_at,
    pi.updated_at,
    pi.account_id,
    pi.cost_center_id
  from public.purchase_invoices pi
  join public.suppliers s on s.id = pi.supplier_id
  join public.invoicing_channels ch on ch.id = pi.channel_id
  cross join q
  where
    (p_supplier_id is null or pi.supplier_id = p_supplier_id)
    and (p_channel_id is null or pi.channel_id = p_channel_id)
    and (p_status is null or pi.status = p_status)
    and (p_kind is null or pi.kind = p_kind)
    and (p_exclude_id is null or pi.id <> p_exclude_id)
    and (p_is_fiscal is null or ch.is_fiscal = p_is_fiscal)
    and (p_fecha_from is null or pi.fecha >= p_fecha_from)
    and (p_fecha_to is null or pi.fecha <= p_fecha_to)
    and (
      q.needle = ''
      or lower(s.legal_name) like '%' || q.needle || '%'
      or s.cuit like q.needle || '%'
      or cast(pi.numero as text) like '%' || q.needle || '%'
    )
  order by pi.fecha desc, pi.created_at desc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid, boolean) is
  'Buscador paginado de compras (con cuenta de gasto y centro de costo). p_is_fiscal=true solo fiscales; false solo internos; null ambos.';

revoke all on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid, boolean) from public, anon;
grant execute on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid, boolean) to authenticated, service_role;

-- 5. Management P&L by cost center ------------------------------------------------

-- squawk-ignore ban-drop-function
drop function public.get_management_pnl(date, date, text, boolean);

-- Same as 20261102260000 plus cost_center_id on every row, and the manual
-- expense's own account in percibido.
create function public.get_management_pnl(
  p_from      date,
  p_to        date,
  p_basis     text default 'accrual',
  p_inflation boolean default false
)
returns table (
  month            text,
  bucket           text,
  subbucket        text,
  channel_side     text,
  chart_account_id uuid,
  amount_ars       numeric,
  pending_usd      numeric,
  cost_center_id   uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', p_from)::date;
  v_to   date := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para ver el resultado de gestión'
      using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('accrual', 'cash') then
    raise exception 'Base inválida: %', p_basis
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Período inválido'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_basis = 'accrual' then
    return query
    with raw as (
      -- Fiscal: the journal as posted (reversals included).
      select je.accrual_period as month, 'fiscal'::text as side,
             je.source_table, je.source_id, je.cost_center_id,
             l.chart_of_accounts_id as account_id,
             l.credit - l.debit as amount
        from public.journal_entries je
        join public.journal_entry_lines l on l.journal_entry_id = je.id
       where je.accrual_period between to_char(v_from, 'YYYY-MM') and to_char(v_to, 'YYYY-MM')
      union all
      -- Internal: the entry each live document would post.
      select d.e ->> 'accrual_period', 'internal', x.src, x.id,
             (d.e ->> 'cost_center_id')::uuid,
             coalesce((ln ->> 'account_id')::uuid,
                      public.find_account_by_role((ln ->> 'system_role')::public.coa_system_role)),
             coalesce((ln ->> 'credit')::numeric, 0) - coalesce((ln ->> 'debit')::numeric, 0)
        from (
          select 'invoices'::text as src, i.id
            from public.invoices i
            join public.invoicing_channels c on c.id = i.channel_id
           where not c.is_fiscal and i.status = 'emitted' and i.fecha between v_from and v_to
          union all
          select 'purchase_invoices', p.id
            from public.purchase_invoices p
            join public.invoicing_channels c on c.id = p.channel_id
           where not c.is_fiscal and p.status = 'received' and p.fecha between v_from and v_to
          union all
          select 'transactions', t.id
            from public.transactions t
            join public.invoicing_channels c on c.id = t.channel_id
           where not c.is_fiscal and t.accrual_month between v_from and v_to
        ) x
        cross join lateral (select public.journal_document_entry(x.src, x.id) as e) d
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(d.e -> 'lines') = 'array' then d.e -> 'lines' else '[]'::jsonb end) ln
       where d.e is not null
    ),
    classified as (
      select r.month, r.side, r.cost_center_id, r.account_id, r.amount,
             case
               -- A loan installment is posted to an expense: in gestión it
               -- is principal paid, below the operating margin.
               when r.source_table = 'transactions'
                    and coa.account_type in ('resultado_positivo', 'resultado_negativo')
                    and exists (select 1 from public.loan_installments li where li.transaction_id = r.source_id)
                 then 'loan_principal'
               when mb.bucket is not null then mb.bucket
               when coa.account_type in ('resultado_positivo', 'resultado_negativo') then 'unclassified'
             end as bucket,
             mb.subbucket,
             case when r.source_table = 'invoices' and coa.system_role = 'ventas'
                  then public.management_invoice_asset_share(r.source_id) else 0 end as asset_share
        from raw r
        left join public.chart_of_accounts coa on coa.id = r.account_id
        left join public.management_buckets mb on mb.chart_of_accounts_id = r.account_id
    ),
    split as (
      select c.month, c.side, c.cost_center_id, c.account_id, c.subbucket,
             case when s.is_asset then 'asset_sale' else c.bucket end as bucket,
             s.part as amount
        from classified c
        cross join lateral (values
          (false, c.amount - round(c.amount * c.asset_share, 2)),
          (true,  round(c.amount * c.asset_share, 2))
        ) as s (is_asset, part)
       where c.bucket is not null and c.bucket <> 'neutral'
         and (s.part <> 0 or (not s.is_asset and c.asset_share = 0))
    ),
    pending as (
      select to_char(t.accrual_month, 'YYYY-MM') as month,
             case when c.is_fiscal then 'fiscal' else 'internal' end as side,
             t.cost_center_id,
             sum(case when t.kind = 'income' then t.amount else -t.amount end) as usd
        from public.transactions t
        join public.invoicing_channels c on c.id = t.channel_id
       where t.currency = 'USD'
         and t.kind in ('income', 'expense')
         and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
         and t.issued_check_id is null
         and t.accrual_month between v_from and v_to
         and public.get_exchange_rate('USD', t.transaction_date) is null
       group by 1, 2, 3
    )
    select s.month, s.bucket,
           case when s.subbucket = 'sueldos' and s.side = 'internal' then 'sueldos_internos'
                else s.subbucket end,
           s.side, s.account_id,
           round(sum(s.amount) * case when p_inflation then coalesce(max(ia.coefficient), 1) else 1 end, 2),
           0::numeric,
           s.cost_center_id
      from split s
      left join public.inflation_adjustments ia on ia.period = s.month
     group by s.month, s.bucket, s.subbucket, s.side, s.account_id, s.cost_center_id
    union all
    select p.month, 'pending_usd', null, p.side, null, 0::numeric, p.usd, p.cost_center_id
      from pending p;
    return;
  end if;

  -- Cash: every movement of every account and channel, by its source.
  return query
  with moves as (
    select to_char(t.transaction_date, 'YYYY-MM') as month,
           case when c.is_fiscal then 'fiscal' else 'internal' end as side,
           t.cost_center_id,
           t.currency, t.transaction_date,
           case when t.kind = 'income' then t.amount else -t.amount end as signed,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then 'service_revenue'
             when t.payment_order_id is not null or t.issued_check_id is not null then 'operating_cost'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then 'operating_cost'
             when exists (select 1 from public.loan_installments li where li.transaction_id = t.id)
               then 'loan_principal'
             when t.rejected_check_id is not null
                  or exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
                  or exists (select 1 from public.account_opening_balances aob
                              where aob.adjustment_transaction_id = t.id)
               then 'neutral'
             -- A loose movement goes where its journal counter-account goes.
             else coalesce(mb.bucket, 'unclassified')
           end as bucket,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then null
             when t.payment_order_id is not null or t.issued_check_id is not null then 'proveedores'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then case when c.is_fiscal then 'sueldos' else 'sueldos_internos' end
             else mb.subbucket
           end as subbucket,
           case when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.payment_order_id is null and t.issued_check_id is null and not t.is_payroll
                then cp.id end as account_id
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
      left join public.chart_of_accounts cp
        on cp.id = coalesce(
             case when t.kind = 'expense' then t.expense_account_id end,
             public.find_account_by_role(
               case when t.kind = 'income' then 'ajustes_caja' else 'gastos' end::public.coa_system_role))
      left join public.management_buckets mb on mb.chart_of_accounts_id = cp.id
     where t.kind in ('income', 'expense')
       and t.transaction_date between v_from and v_to
  ),
  rated as (
    select m.*,
           case when m.currency = 'USD' then public.get_exchange_rate('USD', m.transaction_date) else 1 end as rate
      from moves m
     where m.bucket <> 'neutral'
  )
  select r.month, r.bucket, r.subbucket, r.side, r.account_id,
         round(coalesce(sum(r.signed * r.rate) filter (where r.rate is not null), 0)
               * case when p_inflation then coalesce(max(ia.coefficient), 1) else 1 end, 2),
         coalesce(sum(r.signed) filter (where r.rate is null), 0),
         r.cost_center_id
    from rated r
    left join public.inflation_adjustments ia on ia.period = r.month
   group by r.month, r.bucket, r.subbucket, r.side, r.account_id, r.cost_center_id;
end;
$$;

revoke all on function public.get_management_pnl(date, date, text, boolean) from public, anon, authenticated;
grant execute on function public.get_management_pnl(date, date, text, boolean) to service_role;
