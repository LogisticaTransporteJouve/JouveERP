-- M closure — M.3 (FTS global) + M.4 (adjuntos extendidos a 8 entidades).
--
-- M.4 — Extiende file_attachments con FKs a 8 entidades. K.10 ya
-- tenía solo purchase_invoice_id; M.4 suma invoice_id, receipt_id,
-- payment_order_id, check_id, issued_check_id, client_id,
-- supplier_id, transaction_id. Re-build del check polimórfico para
-- garantizar exactly-one target. Update de la vista resolved con
-- UNION ALL por cada FK nueva.
--
-- M.3 — Materialized view search_index que une 7 entidades atómicas
-- en una tabla buscable con tsvector. RPC search_global lo consulta
-- con websearch_to_tsquery para el ⌘K. Refresh con triggers AFTER
-- INSERT/UPDATE/DELETE en las source tables (refresh concurrently
-- para que las queries activas no se bloqueen).

set row_security = off;

------------------------------------------------------------------------------
-- 1. M.4 — file_attachments: agregar 8 columnas FK
------------------------------------------------------------------------------
alter table public.file_attachments
  add column invoice_id        uuid references public.invoices (id)        on delete cascade,
  add column receipt_id        uuid references public.receipts (id)        on delete cascade,
  add column payment_order_id  uuid references public.payment_orders (id)  on delete cascade,
  add column check_id          uuid references public.checks (id)          on delete cascade,
  add column issued_check_id   uuid references public.issued_checks (id)   on delete cascade,
  add column client_id         uuid references public.clients (id)         on delete cascade,
  add column supplier_id       uuid references public.suppliers (id)       on delete cascade,
  add column transaction_id    uuid references public.transactions (id)    on delete cascade;

-- Indexes por cada FK (sparse — solo donde no es null)
create index file_attachments_invoice_idx       on public.file_attachments (invoice_id)       where invoice_id is not null;
create index file_attachments_receipt_idx       on public.file_attachments (receipt_id)       where receipt_id is not null;
create index file_attachments_payment_order_idx on public.file_attachments (payment_order_id) where payment_order_id is not null;
create index file_attachments_check_idx         on public.file_attachments (check_id)         where check_id is not null;
create index file_attachments_issued_check_idx  on public.file_attachments (issued_check_id)  where issued_check_id is not null;
create index file_attachments_client_idx        on public.file_attachments (client_id)        where client_id is not null;
create index file_attachments_supplier_idx      on public.file_attachments (supplier_id)      where supplier_id is not null;
create index file_attachments_transaction_idx   on public.file_attachments (transaction_id)   where transaction_id is not null;

-- Re-build del check polimórfico: exactly one target.
alter table public.file_attachments
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
    = 1
  );

-- Recrear vista resolved con UNION ALL por cada FK.
drop view if exists public.v_file_attachments_resolved;

create or replace view public.v_file_attachments_resolved as
  select fa.id as attachment_id, fa.kind, fa.created_at as attached_at, fa.created_by,
         f.id as file_id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.purchase_invoice_id as target_id, 'purchase_invoice' as target_type
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.purchase_invoice_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.invoice_id, 'invoice'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.invoice_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.receipt_id, 'receipt'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.receipt_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.payment_order_id, 'payment_order'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.payment_order_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.check_id, 'check'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.check_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.issued_check_id, 'issued_check'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.issued_check_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.client_id, 'client'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.client_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.supplier_id, 'supplier'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.supplier_id is not null
  union all
  select fa.id, fa.kind, fa.created_at, fa.created_by,
         f.id, f.original_filename, f.mime_type, f.file_size, f.bucket, f.bucket_path, f.quick_ocr,
         fa.transaction_id, 'transaction'
    from public.file_attachments fa join public.files f on f.id = fa.file_id
   where fa.transaction_id is not null;

------------------------------------------------------------------------------
-- 2. M.3 — Materialized view search_index
------------------------------------------------------------------------------
-- Una fila por (entity_type, entity_id) con texto buscable + tsv en
-- español. tsv concatena title (peso A) + subtitle (B) + body (C) para
-- ranking. URL tipo /clients/<uuid> para que el front navegue directo.
--
-- Concurrently refresh requiere unique index; lo agregamos al final.

create materialized view public.search_index as
  -- Clientes
  select
    'client'::text                                    as entity_type,
    c.id::text                                        as entity_id,
    c.legal_name                                      as title,
    coalesce(c.cuit, '')                              as subtitle,
    coalesce(c.email, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.address, '') as body,
    null::text                                        as channel_id,
    '/clients/' || c.id::text                         as url,
    setweight(to_tsvector('spanish', coalesce(c.legal_name, '')), 'A') ||
      setweight(to_tsvector('spanish', coalesce(c.cuit, '')), 'B') ||
      setweight(to_tsvector('spanish', coalesce(c.email, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.address, '')), 'C') as tsv
  from public.clients c
  where c.is_active = true
  union all
  -- Proveedores
  select 'supplier', s.id::text, s.legal_name, coalesce(s.cuit, ''),
         coalesce(s.email, '') || ' ' || coalesce(s.phone, '') || ' ' || coalesce(s.address, ''),
         null, '/suppliers/' || s.id::text,
         setweight(to_tsvector('spanish', coalesce(s.legal_name, '')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(s.cuit, '')), 'B') ||
           setweight(to_tsvector('spanish', coalesce(s.email, '') || ' ' || coalesce(s.phone, '') || ' ' || coalesce(s.address, '')), 'C')
  from public.suppliers s
  where s.is_active = true
  union all
  -- Comprobantes emitidos
  select 'invoice', i.id::text,
         coalesce(i.letter::text, '') || lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0'),
         coalesce(cl.legal_name, ''),
         coalesce(i.cae, '') || ' ' || coalesce(i.doc_nro, ''),
         i.channel_id, '/invoices/' || i.id::text,
         setweight(to_tsvector('simple', coalesce(i.letter::text, '') || lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(cl.legal_name, '')), 'B') ||
           setweight(to_tsvector('simple', coalesce(i.cae, '') || ' ' || coalesce(i.doc_nro, '')), 'C')
  from public.invoices i
  left join public.clients cl on cl.id = i.client_id
  where i.status = 'emitted'
  union all
  -- Facturas de compra
  select 'purchase_invoice', p.id::text,
         coalesce(p.letter::text, '') || lpad(p.punto_venta::text, 4, '0') || '-' || lpad(p.numero::text, 8, '0'),
         coalesce(sup.legal_name, ''),
         coalesce(p.cae_proveedor, '') || ' ' || coalesce(sup.cuit, ''),
         p.channel_id, '/purchases/' || p.id::text,
         setweight(to_tsvector('simple', coalesce(p.letter::text, '') || lpad(p.punto_venta::text, 4, '0') || '-' || lpad(p.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(sup.legal_name, '')), 'B') ||
           setweight(to_tsvector('simple', coalesce(p.cae_proveedor, '') || ' ' || coalesce(sup.cuit, '')), 'C')
  from public.purchase_invoices p
  left join public.suppliers sup on sup.id = p.supplier_id
  where p.status = 'received'
  union all
  -- Recibos
  select 'receipt', r.id::text,
         'R' || lpad(r.punto_venta::text, 4, '0') || '-' || lpad(r.numero::text, 8, '0'),
         coalesce(cl.legal_name, ''),
         coalesce(r.notes, ''),
         r.channel_id, '/receipts/' || r.id::text,
         setweight(to_tsvector('simple', 'R' || lpad(r.punto_venta::text, 4, '0') || '-' || lpad(r.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(cl.legal_name, '')), 'B') ||
           setweight(to_tsvector('spanish', coalesce(r.notes, '')), 'C')
  from public.receipts r
  left join public.clients cl on cl.id = r.client_id
  where r.status = 'issued'
  union all
  -- Órdenes de pago
  select 'payment_order', po.id::text,
         'OP' || lpad(po.punto_venta::text, 4, '0') || '-' || lpad(po.numero::text, 8, '0'),
         coalesce(sup.legal_name, ''),
         coalesce(po.notes, ''),
         po.channel_id, '/payment-orders/' || po.id::text,
         setweight(to_tsvector('simple', 'OP' || lpad(po.punto_venta::text, 4, '0') || '-' || lpad(po.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(sup.legal_name, '')), 'B') ||
           setweight(to_tsvector('spanish', coalesce(po.notes, '')), 'C')
  from public.payment_orders po
  left join public.suppliers sup on sup.id = po.supplier_id
  where po.status = 'issued'
  union all
  -- Transactions (caja)
  select 'transaction', t.id::text,
         t.kind || ' ' || t.amount::text || ' ' || t.currency,
         coalesce(t.description, ''),
         '',
         t.channel_id, '/transactions/' || t.id::text,
         setweight(to_tsvector('simple', t.kind || ' ' || t.amount::text), 'B') ||
           setweight(to_tsvector('spanish', coalesce(t.description, '')), 'C')
  from public.transactions t
;

-- Unique index requerido para REFRESH CONCURRENTLY
create unique index search_index_unique_idx on public.search_index (entity_type, entity_id);
create index search_index_tsv_idx on public.search_index using gin (tsv);

comment on materialized view public.search_index is
  'M.3 FTS global. Refresh on demand vía refresh_search_index() o por trigger en source tables.';

------------------------------------------------------------------------------
-- 3. RPC refresh + search_global
------------------------------------------------------------------------------
create or replace function public.refresh_search_index()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.search_index;
$$;

comment on function public.refresh_search_index is
  'Refresca el FTS global. Idempotente. Llamado por triggers en source tables y disponible para refresh manual.';

revoke all on function public.refresh_search_index from public;
grant execute on function public.refresh_search_index to authenticated;

create or replace function public.search_global(
  p_query text,
  p_limit int default 20
)
returns table (
  entity_type text,
  entity_id   text,
  title       text,
  subtitle    text,
  url         text,
  rank        real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('spanish', p_query) as tsq
  )
  select
    s.entity_type, s.entity_id, s.title, s.subtitle, s.url,
    ts_rank(s.tsv, q.tsq) as rank
  from public.search_index s, q
  where s.tsv @@ q.tsq
  order by rank desc, s.title asc
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.search_global is
  'M.3 búsqueda global. websearch_to_tsquery soporta operadores naturales (\"foo bar\" → AND, foo -bar → NOT). Max 50 hits.';

revoke all on function public.search_global from public;
grant execute on function public.search_global(text, int) to authenticated;

------------------------------------------------------------------------------
-- 4. Triggers de refresh
------------------------------------------------------------------------------
-- AFTER INSERT/UPDATE/DELETE en cada source table → refresca el index.
-- Statement-level para no disparar N veces por bulk. Async ideal sería
-- pg_notify + worker, pero el dataset es chico (~10K filas total) y
-- el refresh tarda < 1s, así que va inline.

create or replace function public.search_index_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_search_index();
  return null;
end;
$$;

create trigger clients_search_refresh
  after insert or update or delete on public.clients
  for each statement execute function public.search_index_refresh_trigger();

create trigger suppliers_search_refresh
  after insert or update or delete on public.suppliers
  for each statement execute function public.search_index_refresh_trigger();

create trigger invoices_search_refresh
  after insert or update or delete on public.invoices
  for each statement execute function public.search_index_refresh_trigger();

create trigger purchase_invoices_search_refresh
  after insert or update or delete on public.purchase_invoices
  for each statement execute function public.search_index_refresh_trigger();

create trigger receipts_search_refresh
  after insert or update or delete on public.receipts
  for each statement execute function public.search_index_refresh_trigger();

create trigger payment_orders_search_refresh
  after insert or update or delete on public.payment_orders
  for each statement execute function public.search_index_refresh_trigger();

create trigger transactions_search_refresh
  after insert or update or delete on public.transactions
  for each statement execute function public.search_index_refresh_trigger();

set row_security = on;
