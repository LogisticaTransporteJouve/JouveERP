SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Cuentas por cobrar y pagar (follow-up of #261, #264 and #265):
--
--   1. Account statements carry the currency of every movement, so the app
--      keeps one running balance per currency (pesos and dollars never sum).
--   2. A rejected check of an issued receipt is client debt: it enters the
--      client aging as its own document (document_type 'rejected_check').
--   3. A receipt can settle a rejected check (receipt_rejected_check_allocations):
--      that portion credits cheques_rechazados instead of clientes.
--   4. Supplier aging counts days from fch_vto_pago (fallback fecha).
--   5. v_transactions_tagged tells which document owns a movement.
--   6. A standalone own check (no payment order) leaves the bank when it is
--      cashed: the cashed transition writes the outflow, as the journal
--      already credits the bank then.
--
-- The two statement views and v_transactions_tagged are dropped and created
-- (not replaced), without channel_division: they follow
-- 20261031201743_drop_channel_division and never read
-- invoicing_channels.division.

-- 1. Settlement of a rejected check by a receipt ------------------------------

create table public.receipt_rejected_check_allocations (
  id             uuid primary key default gen_random_uuid(),
  receipt_id     uuid not null references public.receipts (id) on delete cascade,
  check_id       uuid not null references public.checks (id) on delete restrict,
  amount_applied numeric(18,2) not null check (amount_applied > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (receipt_id, check_id)
);

comment on table public.receipt_rejected_check_allocations is
  'Imputación de un recibo a un cheque rechazado del cliente (deuda por cheque rechazado). Ese tramo del recibo acredita Deudores por cheques rechazados, no Clientes.';

create index receipt_rejected_check_allocations_check_idx
  on public.receipt_rejected_check_allocations (check_id);

alter table public.receipt_rejected_check_allocations enable row level security;

create policy "Owner, admin and finance view rejected check allocations"
  on public.receipt_rejected_check_allocations for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "Owner, admin and finance insert rejected check allocations"
  on public.receipt_rejected_check_allocations for insert to authenticated
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "Owner, admin and finance update rejected check allocations"
  on public.receipt_rejected_check_allocations for update to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "Owner, admin and finance delete rejected check allocations"
  on public.receipt_rejected_check_allocations for delete to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.receipt_rejected_check_allocations from public, anon;
grant select, insert, update, delete on table public.receipt_rejected_check_allocations to authenticated;
grant all on table public.receipt_rejected_check_allocations to service_role;

create trigger receipt_rejected_check_allocations_set_updated_at
  before update on public.receipt_rejected_check_allocations
  for each row execute function public.set_updated_at();

-- A receipt settles a rejected check of its own client, channel and currency
-- that came from another issued receipt, and never past what is still open
-- (check amount − what other issued receipts settled). The check row is
-- locked, so two receipts can't both take the last peso.
create or replace function public.guard_receipt_rejected_check_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check     public.checks%rowtype;
  v_source    public.receipts%rowtype;
  v_receipt   public.receipts%rowtype;
  v_settled   numeric;
begin
  select * into v_check from public.checks where id = new.check_id for update;
  if v_check.id is null then
    raise exception 'El cheque % no existe', new.check_id
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_check.status <> 'rechazado' then
    raise exception 'Solo se puede imputar un recibo a un cheque rechazado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_source from public.receipts where id = v_check.source_receipt_id;
  if v_source.id is null or v_source.status <> 'issued' then
    raise exception 'El cheque rechazado no viene de un recibo emitido: no es deuda del cliente'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_source.id = new.receipt_id then
    raise exception 'Un recibo no puede cancelar el cheque rechazado que él mismo recibió'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_receipt from public.receipts where id = new.receipt_id;
  if v_receipt.client_id is distinct from v_source.client_id then
    raise exception 'El cheque rechazado no es del cliente del recibo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_receipt.channel_id is distinct from v_source.channel_id then
    raise exception 'El cheque rechazado es de otro canal que el recibo: un recibo solo cancela deuda de su mismo canal'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_receipt.currency is distinct from v_check.currency then
    raise exception 'El cheque rechazado está en otra moneda que el recibo: un recibo solo cancela deuda de su misma moneda'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select coalesce(sum(a.amount_applied), 0) into v_settled
    from public.receipt_rejected_check_allocations a
    join public.receipts r on r.id = a.receipt_id
   where a.check_id = new.check_id
     and a.id <> new.id
     and r.status <> 'canceled';

  if v_settled + new.amount_applied > v_check.amount + 0.01 then
    raise exception 'La imputación excede lo que queda del cheque rechazado (% + % > %)',
      v_settled, new.amount_applied, v_check.amount
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_receipt_rejected_check_allocation() from public, anon, authenticated;

create trigger guard_receipt_rejected_check_allocation
  before insert or update of receipt_id, check_id, amount_applied
  on public.receipt_rejected_check_allocations
  for each row execute function public.guard_receipt_rejected_check_allocation();

-- What each rejected check of an issued receipt still owes. Dated on the
-- rejection (the bank's constancia), numbered with the receipt that brought it.
create view public.v_rejected_check_open with (security_invoker = on) as
  select
    k.id                                  as check_id,
    r.client_id,
    r.channel_id,
    k.currency,
    k.check_number,
    r.id                                  as source_receipt_id,
    r.punto_venta,
    r.numero,
    coalesce(rej.event_date, k.updated_at::date) as rejected_on,
    k.amount,
    coalesce(settled.applied, 0)          as amount_settled,
    k.amount - coalesce(settled.applied, 0) as open_amount
  from public.checks k
  join public.receipts r on r.id = k.source_receipt_id
  left join lateral (
    select m.event_date
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  left join (
    select a.check_id, sum(a.amount_applied) as applied
      from public.receipt_rejected_check_allocations a
      join public.receipts rr on rr.id = a.receipt_id
     where rr.status = 'issued'
     group by a.check_id
  ) settled on settled.check_id = k.id
  where k.status = 'rechazado'
    and r.status = 'issued';

comment on view public.v_rejected_check_open is
  'Cheques rechazados de recibos emitidos: importe, cancelado por otros recibos y saldo abierto. Permiso: receipts:read.';

revoke all on table public.v_rejected_check_open from public, anon;
grant select on table public.v_rejected_check_open to authenticated;
grant all on table public.v_rejected_check_open to service_role;

-- 2. Client aging: rejected checks as their own document ----------------------

-- Same columns in the same order; document_type, document_id and
-- check_number are appended. A rejected check has no invoice_id: its id is
-- document_id. Its due date is the rejection, so it ages from that day.
create or replace view public.v_aging_documents with (security_invoker = on) as
  SELECT c.id AS invoice_id,
    c.client_id,
    c.fecha,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    c.imp_total,
    COALESCE(alloc.applied, 0::numeric) + COALESCE(opening.applied, 0::numeric) AS amount_applied,
    c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric) AS open_amount,
    CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha) AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    c.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    c.fch_vto_pago AS fch_vto_pago,
    c.moneda AS moneda,
    COALESCE(nc.credited, 0::numeric) AS amount_credited_by_nc,
    'invoice'::text AS document_type,
    c.id AS document_id,
    NULL::text AS check_number
   FROM invoices c
     JOIN invoicing_channels ch ON ch.id = c.channel_id
     LEFT JOIN ( SELECT ra.invoice_id,
            sum(ra.amount_applied) AS applied
           FROM receipt_allocations ra
             JOIN receipts r ON r.id = ra.receipt_id
          WHERE r.status = 'issued'::text
          GROUP BY ra.invoice_id) alloc ON alloc.invoice_id = c.id
     LEFT JOIN ( SELECT client_opening_balance_allocations.invoice_id,
            client_opening_balance_allocations.amount_applied AS applied
           FROM client_opening_balance_allocations) opening ON opening.invoice_id = c.id
     LEFT JOIN ( SELECT n.invoice_origin_id,
            sum(n.imp_total) AS credited
           FROM invoices n
          WHERE n.kind = 'nc'::text AND n.status = 'emitted'::text AND n.invoice_origin_id IS NOT NULL
          GROUP BY n.invoice_origin_id) nc ON nc.invoice_origin_id = c.id
  WHERE c.status = 'emitted'::text AND (c.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND (c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric)) > 0::numeric
  UNION ALL
  SELECT NULL::uuid AS invoice_id,
    o.client_id,
    o.rejected_on AS fecha,
    'rejected_check'::text AS kind,
    NULL::character(1) AS letter,
    o.punto_venta,
    o.numero,
    o.amount::numeric(15,2) AS imp_total,
    o.amount_settled AS amount_applied,
    o.open_amount,
    CURRENT_DATE - o.rejected_on AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - o.rejected_on) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    o.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    o.rejected_on AS fch_vto_pago,
    CASE WHEN o.currency = 'USD' THEN 'DOL'::text ELSE 'PES'::text END AS moneda,
    0::numeric AS amount_credited_by_nc,
    'rejected_check'::text AS document_type,
    o.check_id AS document_id,
    o.check_number
   FROM v_rejected_check_open o
     JOIN invoicing_channels ch ON ch.id = o.channel_id
  WHERE o.open_amount > 0::numeric;

-- Aging totals already include the rejected checks (they are documents of
-- v_aging_documents). The appended columns say how much of each currency's
-- total is rejected-check debt, for the label.
create or replace view public.v_client_aging with (security_invoker = on) as
  select
    d.client_id as client_id,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_rejected_checks_open,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_rejected_checks_open
  from public.v_aging_documents d
  group by d.client_id;

create or replace view public.v_client_aging_by_scope with (security_invoker = on) as
  select
    d.client_id as client_id,
    d.channel_is_fiscal as channel_is_fiscal,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_rejected_checks_open,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_rejected_checks_open
  from public.v_aging_documents d
  group by d.client_id, d.channel_is_fiscal;

-- With the UNION, PostgREST no longer traces client_id back to
-- invoices.client_id, so the clients!inner embed of the aging views (the
-- aging page, the weekly summary, the insights) lost its relationship. These
-- computed relationships restore it; security invoker, so clients' RLS
-- still applies.
create function public.clients(public.v_client_aging)
returns setof public.clients
rows 1
language sql
stable
set search_path = ''
as $$
  select c.* from public.clients c where c.id = $1.client_id
$$;

create function public.clients(public.v_client_aging_by_scope)
returns setof public.clients
rows 1
language sql
stable
set search_path = ''
as $$
  select c.* from public.clients c where c.id = $1.client_id
$$;

revoke all on function public.clients(public.v_client_aging) from public, anon;
revoke all on function public.clients(public.v_client_aging_by_scope) from public, anon;
grant execute on function public.clients(public.v_client_aging) to authenticated, service_role;
grant execute on function public.clients(public.v_client_aging_by_scope) to authenticated, service_role;

-- 3. Account statements with currency -----------------------------------------

-- No app object depends on the view; dropped and created so the column list
-- matches 20261031204717_drop_channel_division in either apply order.
-- squawk-ignore ban-drop-view
drop view public.v_client_account_movements;

create view public.v_client_account_movements with (security_invoker = on) as
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
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    c.status,
    case when coalesce(c.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency
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
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    r.status,
    r.currency
  from public.receipts r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.status = 'issued'
  union all
  -- The opening balance has no currency column: it is in pesos.
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
    null::boolean                        as channel_is_fiscal,
    null::text                           as channel_name,
    'issued'::text                       as status,
    'ARS'::text                          as currency
  from public.client_opening_balances ob
  union all
  -- A check of an issued receipt that bounced: the client owes it again. The
  -- receipt's allocations stay (the invoice reads paid); this row puts the
  -- debt back in the running balance. A receipt that settles it credits the
  -- balance like any receipt.
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
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency
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

revoke all on table public.v_client_account_movements from public, anon, authenticated;
grant select on table public.v_client_account_movements to authenticated;
grant all on table public.v_client_account_movements to service_role;

-- No app object depends on the view; dropped and created so the column list
-- matches 20261031204717_drop_channel_division in either apply order.
-- squawk-ignore ban-drop-view
drop view public.v_supplier_account_movements;

create view public.v_supplier_account_movements with (security_invoker = on) as
  select
    'purchase_invoice'::text as source_type,
    pi.id as source_id,
    pi.supplier_id,
    pi.fecha as movement_date,
    pi.created_at,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    case when pi.kind = 'nc' then -1::numeric * pi.imp_total else pi.imp_total end as signed_amount,
    pi.imp_total as gross_amount,
    pi.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    pi.status,
    case when coalesce(pi.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'
  union all
  select
    'payment_order'::text as source_type,
    po.id as source_id,
    po.supplier_id,
    po.payment_date as movement_date,
    po.created_at,
    'payment_order'::text as kind,
    null::text as letter,
    po.punto_venta,
    po.numero,
    -1::numeric * po.total_amount as signed_amount,
    po.total_amount as gross_amount,
    po.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    po.status,
    po.currency
  from public.payment_orders po
  join public.invoicing_channels ch on ch.id = po.channel_id
  where po.status = 'issued'
  union all
  -- The opening balance has no currency column: it is in pesos.
  select
    'opening_balance'::text as source_type,
    null::uuid as source_id,
    ob.supplier_id,
    ob.opening_date as movement_date,
    ob.created_at,
    'opening_balance'::text as kind,
    null::text as letter,
    null::integer as punto_venta,
    null::integer as numero,
    ob.target_balance as signed_amount,
    ob.target_balance as gross_amount,
    null::text as channel_id,
    null::boolean as channel_is_fiscal,
    null::text as channel_name,
    'issued'::text as status,
    'ARS'::text as currency
  from public.supplier_opening_balances ob;

revoke all on table public.v_supplier_account_movements from public, anon, authenticated;
grant select on table public.v_supplier_account_movements to authenticated;
grant all on table public.v_supplier_account_movements to service_role;

-- 4. Supplier aging from the due date -----------------------------------------

create or replace view public.v_supplier_aging_documents
with (security_invoker = on) as
select
  pi.id as purchase_invoice_id,
  pi.supplier_id,
  pi.fecha,
  pi.kind,
  pi.letter,
  pi.punto_venta,
  pi.numero,
  pi.imp_total,
  o.amount_paid + o.amount_opening_applied as amount_applied,
  o.amount_credited_by_nc,
  o.open_amount,
  current_date - coalesce(pi.fch_vto_pago, pi.fecha) as days_overdue,
  case
    when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 30 then '0_30'
    when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 60 then '30_60'
    when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 90 then '60_90'
    else '90_plus'
  end as bucket,
  pi.channel_id,
  ch.name as channel_name,
  ch.is_fiscal as channel_is_fiscal,
  pi.fch_vto_pago,
  pi.moneda
from public.purchase_invoices pi
join public.v_purchase_invoice_open o on o.purchase_invoice_id = pi.id
join public.invoicing_channels ch on ch.id = pi.channel_id
where pi.status = 'received'
  and pi.kind in ('factura', 'nd')
  and o.open_amount > 0;

-- 6a. Outflow of a cashed own check (schema) -----------------------------------

alter table public.transactions
  -- squawk-ignore adding-foreign-key-constraint
  add column issued_check_id uuid references public.issued_checks (id) on delete restrict;

comment on column public.transactions.issued_check_id is
  'Cheque propio sin orden de pago cuyo cobro es este egreso (lo escribe issued_check_cashed_outflow). No asienta: el asiento del cobro lo emite el cheque.';

-- The column is new and all NULL: nothing to index, so the lock is momentary.
-- CONCURRENTLY cannot run in this migration's transaction.
-- squawk-ignore require-concurrent-index-creation
create unique index transactions_issued_check_unique
  on public.transactions (issued_check_id) where issued_check_id is not null;

-- 5. Treasury: which document owns a movement ----------------------------------

-- Appended: the links and source_document, the owner the delete guard
-- (guard_transaction_owned_by_document) names; NULL for a manual movement.
-- No app object depends on the view; dropped and created so the column list
-- matches 20261031204717_drop_channel_division in either apply order.
-- squawk-ignore ban-drop-view
drop view public.v_transactions_tagged;

create view public.v_transactions_tagged with (security_invoker = on) as
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
      when t.is_payroll
        or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
        then 'payroll'
      when exists (select 1 from public.loan_installments li where li.transaction_id = t.id)
        then 'loan_installment'
      when exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
        then 'check_movement'
      when exists (select 1 from public.account_opening_balances aob where aob.adjustment_transaction_id = t.id)
        then 'account_opening_balance'
    end as source_document
  from public.transactions t
  join public.invoicing_channels c on c.id = t.channel_id
  join public.accounts a on a.id = t.account_id;

revoke all on table public.v_transactions_tagged from public, anon, authenticated;
grant select on table public.v_transactions_tagged to authenticated;
grant all on table public.v_transactions_tagged to service_role;

-- 6b. Outflow of a cashed own check (behaviour) --------------------------------

-- The movement posts nothing: emit_journal_for_issued_check_transition already
-- posts the cashing (debit cheques_diferidos_emitidos / credit banco).
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
begin
  if p_transaction.invoice_id is not null
     or p_transaction.receipt_id is not null
     or p_transaction.payment_order_id is not null
     or p_transaction.issued_check_id is not null
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
    if p_transaction.rejected_check_id is not null then
      v_expense_role := 'cheques_rechazados';
    elsif p_transaction.is_payroll and exists (
      select 1 from public.chart_of_accounts
       where system_role = 'sueldos' and is_active
    ) then
      v_expense_role := 'sueldos';
    end if;
    return jsonb_build_array(
      jsonb_build_object('system_role', v_expense_role::text, 'debit', p_transaction.amount, 'description', p_description),
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

-- emitted → cashed of a check with no payment order: the bank outflow, in the
-- same statement as the transition. A check from a payment order already left
-- the bank with the OP's own movement, at the OP's date.
create or replace function public.issued_check_cashed_outflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
begin
  if old.status <> 'emitted' or new.status <> 'cashed' or new.payment_order_id is not null then
    return new;
  end if;
  if new.channel_id is null then
    raise exception 'El cheque no tiene canal: asignale uno antes de marcarlo cobrado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_date := coalesce(new.cashed_at, current_date);
  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, counterparty_supplier_id, issued_check_id, created_by
  ) values (
    new.bank_account_id, new.channel_id, 'expense', new.amount, new.currency,
    v_date, date_trunc('month', v_date)::date,
    'Cobro cheque propio #' || new.check_number || ' ' || new.bank_name,
    new.supplier_id, new.id, auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.issued_check_cashed_outflow() from public, anon, authenticated;

create trigger issued_checks_cashed_outflow
  after update of status on public.issued_checks
  for each row
  when (old.status is distinct from new.status)
  execute function public.issued_check_cashed_outflow();

create or replace function public.guard_transaction_immutable_when_linked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.receipt_id is not null
      or old.payment_order_id is not null
      or old.transfer_pair_id is not null
      or old.invoice_id is not null
      or old.issued_check_id is not null)
     and (new.amount           is distinct from old.amount
       or new.transaction_date is distinct from old.transaction_date
       or new.accrual_month    is distinct from old.accrual_month
       or new.account_id       is distinct from old.account_id
       or new.kind             is distinct from old.kind
       or new.channel_id       is distinct from old.channel_id) then
    raise exception
      'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un recibo, orden de pago, transferencia, comprobante o cheque propio'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_transaction_immutable_when_linked() from public, anon, authenticated;

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
     or v_stack ~ 'function (public\.)?(update_receipt|update_payment_order|apply_account_opening_balance|clear_account_opening_balance)\(' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if exists (select 1 from public.payroll_payments where transaction_id = old.id)
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id) then
      raise exception
        'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un pago de sueldo: editá el pago desde Sueldos'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  v_owner := case
    when old.receipt_id is not null then 'un recibo'
    when old.payment_order_id is not null then 'una orden de pago'
    when old.invoice_id is not null then 'un comprobante'
    when old.issued_check_id is not null then 'el cobro de un cheque propio'
    when exists (select 1 from public.loan_installments where transaction_id = old.id)
      then 'una cuota de préstamo'
    when exists (select 1 from public.payroll_payments where transaction_id = old.id)
      then 'un pago de sueldo'
    when exists (select 1 from public.check_movements where transaction_id = old.id)
      then 'un movimiento de cheque'
    when exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
      then 'un saldo inicial de cuenta'
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

-- 3b. Receipts: settle rejected checks -----------------------------------------

-- Bodies of 20261031203102_receipts_payment_orders_cotizacion plus the
-- settlement: what the receipt settles of rejected checks (converted at the
-- receipt's rate, rounded once) credits cheques_rechazados, the rest of the
-- client line clientes. In create_receipt / update_receipt an allocation item
-- with rejected_check_id goes to receipt_rejected_check_allocations; one with
-- invoice_id to receipt_allocations, as before. Same signatures.
create or replace function public.build_receipt_journal_lines(p_receipt public.receipts, p_description text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines   jsonb := '[]'::jsonb;
  v_line    record;
  v_role    public.coa_system_role;
  v_rate    numeric := case
    when p_receipt.currency = 'USD' then coalesce(
      nullif(p_receipt.cotizacion, 0),
      public.get_exchange_rate('USD', p_receipt.receipt_date),
      1
    )
    else 1
  end;
  v_amount  numeric;
  v_client  numeric := 0;
  v_rej     numeric;
begin
  for v_line in
    select rpl.account_id, rpl.amount, a.name as account_name
      from public.receipt_payment_lines rpl
      join public.accounts a on a.id = rpl.account_id
     where rpl.receipt_id = p_receipt.id
     order by rpl.created_at, rpl.id
  loop
    v_role := public.coa_role_for_account(v_line.account_id);
    if v_role is null then
      raise exception 'La cuenta "%" no tiene una cuenta contable asociada: no se puede asentar el recibo', v_line.account_name
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_amount := round(v_line.amount * v_rate, 2);
    v_client := v_client + v_amount;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      'debit', v_amount,
      'description', p_description || ' — ' || v_line.account_name
    );
  end loop;

  for v_line in
    select rr.kind, rr.tax_type, rr.amount
      from public.receipt_retentions rr
     where rr.receipt_id = p_receipt.id
     order by rr.created_at, rr.id
  loop
    v_amount := round(v_line.amount * v_rate, 2);
    v_client := v_client + v_amount;
    v_lines := v_lines || jsonb_build_object(
      'system_role',
        case when v_line.kind = 'percepcion' and v_line.tax_type = 'iibb'
             then 'percepciones_iibb_pagadas' else 'retenciones_pagadas' end,
      'debit', v_amount,
      'description', p_description || ' — ' ||
        case when v_line.kind = 'percepcion' then 'percepción ' else 'retención ' end ||
        v_line.tax_type
    );
  end loop;

  -- Capped at the client line: converted once, the settlement can round a
  -- cent past the sum of the rounded debits, and the entry must balance.
  select least(round(coalesce(sum(a.amount_applied), 0) * v_rate, 2), v_client)
    into v_rej
    from public.receipt_rejected_check_allocations a
   where a.receipt_id = p_receipt.id;
  if v_rej > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'cheques_rechazados',
      'credit', v_rej,
      'description', p_description || ' — cheque rechazado'
    );
  end if;
  if v_client - v_rej > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'clientes',
      'credit', v_client - v_rej,
      'description', p_description || ' — cliente'
    );
  end if;
  return v_lines;
end;
$$;

revoke all on function public.build_receipt_journal_lines(public.receipts, text) from public, anon, authenticated;

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

    -- Auto-create check when applicable: account.type ∈ {checks, echeq}
    -- and the payload includes check metadata.
    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;

    v_check := v_line->'check';
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
    v_check := v_line->'check';
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

