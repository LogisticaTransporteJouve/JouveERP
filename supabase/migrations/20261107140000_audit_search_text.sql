SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Admin › Auditoría searches events by what they are about: «Transportes
-- Sur», «22312», «AE463UF». audit_events.search_text holds, normalized
-- (lowercase, no accents), the names and numbers of the records an event
-- names (its target and the ids in its payload) plus its plain payload
-- values. A BEFORE INSERT trigger fills it, a trigram index serves the
-- `like '%…%'` of the search box, and an invoice's number (reserved after
-- the issue event is logged) is written into its events when it arrives.
--
--   audit_search_normalize(text)           the normalization (the app's
--                                          normalizeAuditSearch is its twin)
--   audit_entity_search_text(kind, id)     one record's searchable words
--   audit_events_search_text(type, target, payload)
--   audit_events_set_search_text()         BEFORE INSERT on audit_events
--   audit_events_refresh_invoice_search()  AFTER UPDATE OF numero on invoices
--
-- search_text is derived, never shown: a rename after the event keeps the old
-- name searchable, which is what an audit log wants.

alter table public.audit_events add column search_text text;

comment on column public.audit_events.search_text is
  'Nombres y números de lo que nombra el evento, normalizados (buscador de Admin › Auditoría). Lo llena un trigger.';

create or replace function public.audit_search_normalize(p_text text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select translate(
    lower(coalesce(p_text, '')),
    'áàäâãéèëêíìïîóòöôõúùüûñç',
    'aaaaaeeeeiiiiooooouuuunc'
  );
$$;

create or replace function public.audit_entity_search_text(p_kind text, p_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case p_kind
    when 'invoice' then (
      select concat_ws(' ',
        coalesce(i.letter, upper(i.kind)),
        lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0'),
        i.numero::text, c.legal_name, c.display_name, c.cuit)
        from public.invoices i
        left join public.clients c on c.id = i.client_id
       where i.id = p_id)
    when 'receipt' then (
      select concat_ws(' ', 'recibo',
        lpad(r.punto_venta::text, 4, '0') || '-' || lpad(r.numero::text, 8, '0'),
        r.numero::text, c.legal_name, c.display_name, c.cuit)
        from public.receipts r
        left join public.clients c on c.id = r.client_id
       where r.id = p_id)
    when 'payment_order' then (
      select concat_ws(' ', 'orden de pago',
        lpad(o.punto_venta::text, 4, '0') || '-' || lpad(o.numero::text, 8, '0'),
        o.numero::text, s.legal_name, s.display_name, s.cuit)
        from public.payment_orders o
        left join public.suppliers s on s.id = o.supplier_id
       where o.id = p_id)
    when 'purchase_invoice' then (
      select concat_ws(' ',
        lpad(p.punto_venta::text, 5, '0') || '-' || lpad(p.numero::text, 8, '0'),
        p.numero::text, s.legal_name, s.display_name, s.cuit)
        from public.purchase_invoices p
        left join public.suppliers s on s.id = p.supplier_id
       where p.id = p_id)
    when 'trip' then (
      select concat_ws(' ', v.patente, v.alias, d.full_name, t.origin, t.destination)
        from public.trips t
        left join public.vehicles v on v.id = t.vehicle_id
        left join public.drivers d on d.id = t.driver_id
       where t.id = p_id)
    when 'shipment' then (
      select concat_ws(' ', sh.remito_number, c.legal_name, c.display_name)
        from public.shipments sh
        left join public.clients c on c.id = sh.client_id
       where sh.id = p_id)
    when 'freight_settlement' then (
      select concat_ws(' ', f.numero::text, c.legal_name, c.display_name)
        from public.freight_settlements f
        left join public.clients c on c.id = f.client_id
       where f.id = p_id)
    when 'driver_settlement' then (
      select concat_ws(' ', ds.numero::text, d.full_name)
        from public.driver_settlements ds
        left join public.drivers d on d.id = ds.driver_id
       where ds.id = p_id)
    when 'client' then (
      select concat_ws(' ', c.legal_name, c.display_name, c.cuit)
        from public.clients c where c.id = p_id)
    when 'supplier' then (
      select concat_ws(' ', s.legal_name, s.display_name, s.cuit)
        from public.suppliers s where s.id = p_id)
    when 'vehicle' then (
      select concat_ws(' ', v.patente, v.alias) from public.vehicles v where v.id = p_id)
    when 'driver' then (
      select d.full_name from public.drivers d where d.id = p_id)
    when 'employee' then (
      select e.legal_name from public.employees e where e.id = p_id)
    when 'check' then (
      select concat_ws(' ', ch.check_number, ch.bank_name, ch.drawer_name)
        from public.checks ch where ch.id = p_id)
    when 'issued_check' then (
      select concat_ws(' ', ic.check_number, ic.bank_name, ic.beneficiary_name)
        from public.issued_checks ic where ic.id = p_id)
    when 'task' then (
      select t.title from public.tasks t where t.id = p_id)
    when 'loan' then (
      select concat_ws(' ', l.description, l.lender) from public.loans l where l.id = p_id)
    else null
  end;
$$;

-- What the event's target is, by its event type's first word; the ids in
-- the payload say their own kind by key.
create or replace function public.audit_events_search_text(
  p_event_type text,
  p_target text,
  p_payload jsonb
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select case split_part(p_event_type, '.', 1)
             when 'storage' then 'invoice'
             when 'late_interest' then 'client'
             else split_part(p_event_type, '.', 1)
           end as kind,
           case when p_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then p_target::uuid end as id
  ),
  refs(key, kind) as (
    values ('client_id', 'client'), ('supplier_id', 'supplier'),
           ('employee_id', 'employee'), ('vehicle_id', 'vehicle'),
           ('driver_id', 'driver'), ('invoice_id', 'invoice'),
           ('nd_invoice_id', 'invoice'), ('trip_id', 'trip'),
           ('purchaseInvoiceId', 'purchase_invoice')
  ),
  words as (
    select public.audit_entity_search_text(t.kind, t.id) as w
      from target t
     where t.id is not null
    union all
    select public.audit_entity_search_text(r.kind, (p_payload ->> r.key)::uuid)
      from refs r
     where jsonb_typeof(p_payload) = 'object'
       and (p_payload ->> r.key) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union all
    -- Plain values (numero, patente, legal_name, title…), never ids nor the
    -- keys the screen masks.
    select e.value
      from jsonb_each_text(
             case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end
           ) e
     where jsonb_typeof(p_payload -> e.key) in ('string', 'number')
       and e.key !~ 'Ids?$'
       and lower(e.key) !~ '(^id$|_ids?$|token|secret|password|passwd|credential|signature|key|cert|private|cbu|cvu|cuil)'
       and e.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select nullif(public.audit_search_normalize(string_agg(w, ' ')), '')
    from words
   where w is not null;
$$;

create or replace function public.audit_events_set_search_text()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.search_text := public.audit_events_search_text(
    new.event_type, new.target_resource_id, new.payload);
  return new;
end;
$$;

create trigger audit_events_set_search_text
  before insert on public.audit_events
  for each row execute function public.audit_events_set_search_text();

-- An invoice gets its number after `invoice.issue_requested` is logged (AFIP
-- or the internal sequence reserves it): write it into the invoice's events.
-- DEFINER because whoever updates the invoice has no write on audit_events;
-- it only rewrites the derived search_text of that invoice's own events.
create or replace function public.audit_events_refresh_invoice_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.audit_events a
     set search_text = public.audit_events_search_text(
           a.event_type, a.target_resource_id, a.payload)
   where a.target_resource_id = new.id::text;
  return null;
end;
$$;

create trigger invoices_refresh_audit_search
  after update of numero on public.invoices
  for each row
  when (old.numero is distinct from new.numero)
  execute function public.audit_events_refresh_invoice_search();

revoke all on function public.audit_search_normalize(text) from public, anon, authenticated;
revoke all on function public.audit_entity_search_text(text, uuid) from public, anon, authenticated;
revoke all on function public.audit_events_search_text(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.audit_events_set_search_text() from public, anon, authenticated;
revoke all on function public.audit_events_refresh_invoice_search() from public, anon, authenticated;

-- The events already logged (400 days at most, by retention).
update public.audit_events
   set search_text = public.audit_events_search_text(event_type, target_resource_id, payload);

-- squawk-ignore require-concurrent-index-creation
create index audit_events_search_text_trgm_idx
  on public.audit_events using gin (search_text gin_trgm_ops)
  where search_text is not null;
