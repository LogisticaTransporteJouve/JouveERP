SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Contract step of the DZ retirement (20261031190209_retire_dz_division):
-- with a single division left, invoicing_channels.division carries no
-- information. The PDFs print the division label from a constant
-- (lib/pdf/emisor.ts) and no code reads the column any more.
--
-- The three views that exposed it as channel_division are redefined with
-- that column removed and every other column in the same order. Removing a
-- view column is a contract change: code older than this migration selects
-- channel_division and breaks, so a rollback must not cross it.

-- Recreated below without channel_division; the code that ships with this
-- migration no longer selects it.
-- squawk-ignore ban-drop-view
drop view public.v_client_account_movements;
-- squawk-ignore ban-drop-view
drop view public.v_supplier_account_movements;
-- squawk-ignore ban-drop-view
drop view public.v_transactions_tagged;

-- The channel-config guard watched division too; it now watches is_fiscal only.
drop trigger guard_invoicing_channel_config on public.invoicing_channels;

-- The CHECK only listed the divisions ('dz', 'jouve'); it goes with the column.
-- squawk-ignore ban-drop-constraint
alter table public.invoicing_channels drop constraint invoicing_channels_division_check;
-- No code reads the column (lib/channels.ts, the PDFs and the account views
-- moved off it in this change); production has no rows that depend on it.
-- squawk-ignore ban-drop-column
alter table public.invoicing_channels drop column division;

create or replace function public.guard_invoicing_channel_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoices where channel_id = old.id)
     or exists (select 1 from public.purchase_invoices where channel_id = old.id)
     or exists (select 1 from public.receipts where channel_id = old.id)
     or exists (select 1 from public.payment_orders where channel_id = old.id)
     or exists (select 1 from public.transactions where channel_id = old.id)
     or exists (select 1 from public.loans where channel_id = old.id)
     or exists (select 1 from public.payroll_payments where channel_id = old.id)
     or exists (select 1 from public.journal_entries where channel_id = old.id)
     or exists (select 1 from public.shipments where channel_id = old.id)
     or exists (select 1 from public.trips where channel_id = old.id) then
    raise exception 'El canal % ya tiene documentos: no se puede cambiar si es fiscal', old.name
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoicing_channel_config() from public, anon, authenticated;

create trigger guard_invoicing_channel_config
  before update of is_fiscal on public.invoicing_channels
  for each row
  when (new.is_fiscal is distinct from old.is_fiscal)
  execute function public.guard_invoicing_channel_config();

create view public.v_client_account_movements with (security_invoker = on) as
 SELECT 'invoice'::text AS source_type,
    c.id AS source_id,
    c.client_id,
    c.fecha AS movement_date,
    c.created_at,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
        CASE
            WHEN c.kind = 'nc'::text THEN (- 1::numeric) * c.imp_total
            ELSE c.imp_total
        END AS signed_amount,
    c.imp_total AS gross_amount,
    c.channel_id,
    ch.is_fiscal AS channel_is_fiscal,
    ch.name AS channel_name,
    c.status
   FROM public.invoices c
     JOIN public.invoicing_channels ch ON ch.id = c.channel_id
  WHERE c.status = 'emitted'::text
UNION ALL
 SELECT 'receipt'::text AS source_type,
    r.id AS source_id,
    r.client_id,
    r.receipt_date AS movement_date,
    r.created_at,
    'receipt'::text AS kind,
    NULL::text AS letter,
    r.punto_venta,
    r.numero,
    (- 1::numeric) * r.total_amount AS signed_amount,
    r.total_amount AS gross_amount,
    r.channel_id,
    ch.is_fiscal AS channel_is_fiscal,
    ch.name AS channel_name,
    r.status
   FROM public.receipts r
     JOIN public.invoicing_channels ch ON ch.id = r.channel_id
  WHERE r.status = 'issued'::text
UNION ALL
 SELECT 'opening_balance'::text AS source_type,
    NULL::uuid AS source_id,
    ob.client_id,
    ob.opening_date AS movement_date,
    ob.created_at,
    'opening_balance'::text AS kind,
    NULL::text AS letter,
    NULL::integer AS punto_venta,
    NULL::integer AS numero,
    ob.target_balance AS signed_amount,
    ob.target_balance AS gross_amount,
    NULL::text AS channel_id,
    NULL::boolean AS channel_is_fiscal,
    NULL::text AS channel_name,
    'issued'::text AS status
   FROM public.client_opening_balances ob
UNION ALL
 SELECT 'rejected_check'::text AS source_type,
    k.id AS source_id,
    r.client_id,
    COALESCE(rej.event_date, k.updated_at::date) AS movement_date,
    COALESCE(rej.created_at, k.updated_at) AS created_at,
    'rejected_check'::text AS kind,
    NULL::text AS letter,
    r.punto_venta,
    r.numero,
    k.amount AS signed_amount,
    k.amount AS gross_amount,
    r.channel_id,
    ch.is_fiscal AS channel_is_fiscal,
    ch.name AS channel_name,
    k.status
   FROM public.checks k
     JOIN public.receipts r ON r.id = k.source_receipt_id
     JOIN public.invoicing_channels ch ON ch.id = r.channel_id
     LEFT JOIN LATERAL ( SELECT m.event_date,
            m.created_at
           FROM public.check_movements m
          WHERE m.check_id = k.id AND m.event = 'rejected'::text
          ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1) rej ON true
  WHERE k.status = 'rechazado'::text AND r.status = 'issued'::text;

comment on view public.v_client_account_movements is
  'Feed cronológico unificado: invoices + receipts + opening_balance. signed_amount > 0 = el cliente debe; < 0 = pago / NC.';

create view public.v_supplier_account_movements with (security_invoker = on) as
 SELECT 'purchase_invoice'::text AS source_type,
    pi.id AS source_id,
    pi.supplier_id,
    pi.fecha AS movement_date,
    pi.created_at,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
        CASE
            WHEN pi.kind = 'nc'::text THEN '-1'::integer::numeric * pi.imp_total
            ELSE pi.imp_total
        END AS signed_amount,
    pi.imp_total AS gross_amount,
    pi.channel_id,
    ch.is_fiscal AS channel_is_fiscal,
    ch.name AS channel_name,
    pi.status
   FROM public.purchase_invoices pi
     JOIN public.invoicing_channels ch ON ch.id = pi.channel_id
  WHERE pi.status = 'received'::text
UNION ALL
 SELECT 'payment_order'::text AS source_type,
    po.id AS source_id,
    po.supplier_id,
    po.payment_date AS movement_date,
    po.created_at,
    'payment_order'::text AS kind,
    NULL::text AS letter,
    po.punto_venta,
    po.numero,
    '-1'::integer::numeric * po.total_amount AS signed_amount,
    po.total_amount AS gross_amount,
    po.channel_id,
    ch.is_fiscal AS channel_is_fiscal,
    ch.name AS channel_name,
    po.status
   FROM public.payment_orders po
     JOIN public.invoicing_channels ch ON ch.id = po.channel_id
  WHERE po.status = 'issued'::text
UNION ALL
 SELECT 'opening_balance'::text AS source_type,
    NULL::uuid AS source_id,
    ob.supplier_id,
    ob.opening_date AS movement_date,
    ob.created_at,
    'opening_balance'::text AS kind,
    NULL::text AS letter,
    NULL::integer AS punto_venta,
    NULL::integer AS numero,
    ob.target_balance AS signed_amount,
    ob.target_balance AS gross_amount,
    NULL::text AS channel_id,
    NULL::boolean AS channel_is_fiscal,
    NULL::text AS channel_name,
    'issued'::text AS status
   FROM public.supplier_opening_balances ob;

comment on view public.v_supplier_account_movements is
  'Feed cronológico de purchase_invoices + payment_orders + opening_balance por proveedor.';

create view public.v_transactions_tagged with (security_invoker = on) as
 SELECT t.id,
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
    c.is_fiscal AS channel_is_fiscal,
    c.name AS channel_name,
    a.name AS account_name,
    a.type AS account_type
   FROM public.transactions t
     JOIN public.invoicing_channels c ON c.id = t.channel_id
     JOIN public.accounts a ON a.id = t.account_id;

comment on view public.v_transactions_tagged is
  'Transactions joined with their channel (is_fiscal, name) and account (name, type) for reporting.';

revoke all on public.v_client_account_movements, public.v_supplier_account_movements,
  public.v_transactions_tagged from public, anon, authenticated;
grant select on public.v_client_account_movements, public.v_supplier_account_movements,
  public.v_transactions_tagged to authenticated;
grant all on public.v_client_account_movements, public.v_supplier_account_movements,
  public.v_transactions_tagged to service_role;
