SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Ventas / Otras ventas and Compras / Otras compras are separate points of
-- sale (docs/otras-ventas.md). Every client and supplier belongs to one side
-- for life: fiscal ones carry CUIT and IVA condition (AFIP), internal ones
-- carry neither. A document or receipt / payment order must be on a channel of
-- its counterparty's side. Existing rows are all fiscal (prod has no internal
-- documents yet).

-- 1. The side column ----------------------------------------------------------

alter table public.clients add column is_fiscal boolean not null default true;
alter table public.suppliers add column is_fiscal boolean not null default true;

-- CUIT stays UNIQUE (internal rows hold NULL, and NULLs never collide), so the
-- ARCA sync's upsert on conflict (cuit) keeps working.
-- squawk-ignore ban-drop-not-null
alter table public.clients alter column cuit drop not null;
-- squawk-ignore ban-drop-not-null
alter table public.clients alter column iva_condition drop not null;
-- squawk-ignore ban-drop-not-null
alter table public.suppliers alter column cuit drop not null;
-- squawk-ignore ban-drop-not-null
alter table public.suppliers alter column iva_condition drop not null;

-- squawk-ignore constraint-missing-not-valid
alter table public.clients add constraint clients_side_identity check (
  (is_fiscal and cuit is not null and iva_condition is not null)
  or (not is_fiscal and cuit is null and iva_condition is null)
) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.clients validate constraint clients_side_identity;

-- squawk-ignore constraint-missing-not-valid
alter table public.suppliers add constraint suppliers_side_identity check (
  (is_fiscal and cuit is not null and iva_condition is not null)
  or (not is_fiscal and cuit is null and iva_condition is null)
) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.suppliers validate constraint suppliers_side_identity;

-- squawk-ignore require-concurrent-index-creation
create index clients_is_fiscal_idx on public.clients (is_fiscal);
-- squawk-ignore require-concurrent-index-creation
create index suppliers_is_fiscal_idx on public.suppliers (is_fiscal);

-- 2. The side never changes -----------------------------------------------------

create or replace function public.guard_counterparty_side_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_fiscal is distinct from old.is_fiscal then
    raise exception 'Un cliente o proveedor no puede pasar de Ventas a Otras ventas ni al revés.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_counterparty_side_immutable() from public, anon, authenticated;

create trigger clients_side_immutable
  before update of is_fiscal on public.clients
  for each row execute function public.guard_counterparty_side_immutable();

create trigger suppliers_side_immutable
  before update of is_fiscal on public.suppliers
  for each row execute function public.guard_counterparty_side_immutable();

-- 3. Documents stay on their counterparty's side ---------------------------------

-- Invoices and receipts point at a client, purchases and payment orders at a
-- supplier. The channel's side must match. DEFINER so the check sees the
-- counterparty whatever the writer's RLS lets it read.
create or replace function public.guard_document_side()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel_fiscal boolean;
  v_party_fiscal   boolean;
begin
  select c.is_fiscal into v_channel_fiscal
  from public.invoicing_channels c
  where c.id = new.channel_id;

  if tg_table_name in ('invoices', 'receipts') then
    select c.is_fiscal into v_party_fiscal
    from public.clients c
    where c.id = new.client_id;
  else
    select s.is_fiscal into v_party_fiscal
    from public.suppliers s
    where s.id = new.supplier_id;
  end if;

  if v_channel_fiscal is distinct from v_party_fiscal then
    if tg_table_name in ('invoices', 'receipts') then
      raise exception '%', case when v_channel_fiscal
        then 'Un comprobante de Ventas necesita un cliente de Ventas.'
        else 'Un comprobante de Otras ventas necesita un cliente de Otras ventas.'
      end using errcode = '23514', hint = 'jouve_guard';
    else
      raise exception '%', case when v_channel_fiscal
        then 'Un comprobante de Compras necesita un proveedor de Compras.'
        else 'Un comprobante de Otras compras necesita un proveedor de Otras compras.'
      end using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_document_side() from public, anon, authenticated;

create trigger invoices_side_guard
  before insert or update of client_id, channel_id on public.invoices
  for each row execute function public.guard_document_side();

create trigger receipts_side_guard
  before insert or update of client_id, channel_id on public.receipts
  for each row execute function public.guard_document_side();

create trigger purchase_invoices_side_guard
  before insert or update of supplier_id, channel_id on public.purchase_invoices
  for each row execute function public.guard_document_side();

create trigger payment_orders_side_guard
  before insert or update of supplier_id, channel_id on public.payment_orders
  for each row execute function public.guard_document_side();

-- 4. fiscal_reader sees only fiscal counterparties -------------------------------

drop policy "fiscal_reader select" on public.clients;
create policy "fiscal_reader select" on public.clients
  for select to authenticated
  using ((select public.user_has_role(array['fiscal_reader'])) and is_fiscal);

drop policy "fiscal_reader select" on public.suppliers;
create policy "fiscal_reader select" on public.suppliers
  for select to authenticated
  using ((select public.user_has_role(array['fiscal_reader'])) and is_fiscal);

-- 5. Searches filter by side -----------------------------------------------------

-- The pickers and lists page in SQL, so the side filter goes in the RPC.
-- p_is_fiscal null keeps both sides (callers from before this column).
-- squawk-ignore ban-drop-function
drop function public.search_clients(text, boolean, int, int);

create function public.search_clients(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int     default 0,
  p_limit        int     default 50,
  p_is_fiscal    boolean default null
)
returns setof public.clients
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select c.*
  from public.clients c, q
  where (not p_only_active or c.is_active)
    and (p_is_fiscal is null or c.is_fiscal = p_is_fiscal)
    and (
      q.needle = ''
      or lower(c.legal_name) like '%' || q.needle || '%'
      or lower(coalesce(c.display_name, '')) like '%' || q.needle || '%'
      or c.cuit like q.needle || '%'
      or lower(c.legal_name) % q.needle
      or lower(coalesce(c.display_name, '')) % q.needle
    )
  order by
    case when q.needle = '' then 0
         else greatest(
           similarity(lower(c.legal_name), q.needle),
           similarity(lower(coalesce(c.display_name, '')), q.needle)
         )
    end desc nulls last,
    c.legal_name asc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_clients(text, boolean, int, int, boolean) from public, anon;
grant execute on function public.search_clients(text, boolean, int, int, boolean) to authenticated, service_role;

-- squawk-ignore ban-drop-function
drop function public.search_suppliers(text, boolean, int, int, uuid);

create function public.search_suppliers(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int     default 0,
  p_limit        int     default 50,
  p_category_id  uuid    default null,
  p_is_fiscal    boolean default null
)
returns setof public.suppliers
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select s.*
  from public.suppliers s, q
  where (not p_only_active or s.is_active)
    and (p_category_id is null or s.category_id = p_category_id)
    and (p_is_fiscal is null or s.is_fiscal = p_is_fiscal)
    and (
      q.needle = ''
      or lower(s.legal_name) like '%' || q.needle || '%'
      or lower(coalesce(s.display_name, '')) like '%' || q.needle || '%'
      or s.cuit like q.needle || '%'
      or lower(s.legal_name) % q.needle
      or lower(coalesce(s.display_name, '')) % q.needle
    )
  order by
    case when q.needle = '' then 0
         else greatest(
           similarity(lower(s.legal_name), q.needle),
           similarity(lower(coalesce(s.display_name, '')), q.needle)
         )
    end desc nulls last,
    s.legal_name asc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_suppliers(text, boolean, int, int, uuid, boolean) from public, anon;
grant execute on function public.search_suppliers(text, boolean, int, int, uuid, boolean) to authenticated, service_role;
