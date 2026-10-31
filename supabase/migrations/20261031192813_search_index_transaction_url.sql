SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Global search sent transaction hits to /transactions/<id>, a route that
-- does not exist. Point them at the caja list filtered by the movement's
-- account and date instead. A materialized view cannot be altered in place:
-- it is dropped and recreated with the same rows, indexes and grants; only
-- the transaction url changes. search_global and refresh_search_index read
-- it by name, so they keep working.

drop materialized view public.search_index;

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
         t.channel_id,
         '/transactions?account=' || t.account_id::text
           || '&from=' || t.transaction_date::text
           || '&to=' || t.transaction_date::text,
         setweight(to_tsvector('simple', t.kind || ' ' || t.amount::text), 'B') ||
           setweight(to_tsvector('spanish', coalesce(t.description, '')), 'C')
  from public.transactions t
;

-- Unique index requerido para REFRESH CONCURRENTLY
create unique index search_index_unique_idx on public.search_index (entity_type, entity_id);
create index search_index_tsv_idx on public.search_index using gin (tsv);

comment on materialized view public.search_index is
  'M.3 FTS global. Refresh on demand vía refresh_search_index() o por trigger en source tables.';


revoke all on public.search_index from anon, authenticated;
