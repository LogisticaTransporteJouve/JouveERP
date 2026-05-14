-- K.1 — suppliers catalog (mirror of clients).
--
-- Decision: separate table from `clients` even though en Argentina el mismo
-- CUIT puede ser cliente y proveedor. La razón: el listado, aging,
-- cuenta corriente y reportes son distintos para cada lado, y un
-- contribuyente puede tener tipos de IVA o condiciones de pago que
-- difieren cuando actúa como proveedor.
--
-- Hard delete bloqueado por RLS (igual que clients). Service role en
-- `deleteSupplierAction` solo cuando no hay refs.

set row_security = off;

------------------------------------------------------------------------------
-- 1. suppliers table
------------------------------------------------------------------------------
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  cuit            text not null unique,
  legal_name      text not null,
  display_name    text,
  iva_condition   text not null check (iva_condition in (
    'responsable_inscripto',
    'monotributo',
    'exento',
    'consumidor_final',
    'no_categorizado'
  )),
  email           text,
  phone           text,
  address         text,
  real_address    text,
  notes           text,
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.suppliers is
  'Supplier master catalog. One row per CUIT.';
comment on column public.suppliers.address is
  'Domicilio fiscal según AFIP padrón A4. Locked in form — only "Verificar AFIP" updates.';
comment on column public.suppliers.real_address is
  'Domicilio real / operativo. Free-form, optional.';

alter table public.suppliers
  add constraint suppliers_cuit_format check (cuit ~ '^[0-9]{11}$');

create index suppliers_legal_name_idx on public.suppliers (legal_name);
create index suppliers_is_active_idx  on public.suppliers (is_active);

create index suppliers_legal_name_trgm_idx
  on public.suppliers using gin (lower(legal_name) gin_trgm_ops);
create index suppliers_display_name_trgm_idx
  on public.suppliers using gin (lower(coalesce(display_name, '')) gin_trgm_ops);

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.suppliers enable row level security;

create policy "Authenticated users can view suppliers"
  on public.suppliers for select
  to authenticated
  using (true);

create policy "Owners, admins and finance can insert suppliers"
  on public.suppliers for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can update suppliers"
  on public.suppliers for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

-- No delete policy: hard delete via service role en la action solo cuando
-- no hay refs. Soft-delete (is_active=false) en el resto de los casos.

------------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------------
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 4. search_suppliers RPC
------------------------------------------------------------------------------
create or replace function public.search_suppliers(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int default 0,
  p_limit        int default 50
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

comment on function public.search_suppliers(text, boolean, int, int) is
  'Fuzzy supplier search with offset/limit pagination. Honours RLS via security invoker.';

set row_security = on;
