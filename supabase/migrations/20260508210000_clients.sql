-- C.1 / C.3 — clients catalog (consolidated).
--
-- One row per CUIT, shared across the entire organization. Clients are
-- intentionally NOT scoped to a business_unit or division: the same CUIT can
-- receive comprobantes from DZ Instalaciones and Logística Jouve, and the
-- division is decided at invoice time via the channel. Hard delete is
-- blocked at the RLS level so historical comprobantes that will reference
-- clients.id keep their link; the action layer uses the service role to
-- delete only when there are zero references (see deleteClientAction).
--
-- Adds pg_trgm + GIN trigram indexes and the `search_clients` RPC for fuzzy
-- search on legal_name / display_name / CUIT prefix.

set row_security = off;

create extension if not exists pg_trgm;

------------------------------------------------------------------------------
-- 1. clients table
------------------------------------------------------------------------------
create table public.clients (
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

comment on table public.clients is
  'Customer master catalog. One row per CUIT, shared across all divisions.';
comment on column public.clients.address is
  'Domicilio fiscal según AFIP padrón A4. Locked in the form — only "Verificar AFIP" updates it.';
comment on column public.clients.real_address is
  'Domicilio real / operativo. Free-form, edited by the user, optional. Leave null when it matches the fiscal address.';

alter table public.clients
  add constraint clients_cuit_format check (cuit ~ '^[0-9]{11}$');

create index clients_legal_name_idx on public.clients (legal_name);
create index clients_is_active_idx  on public.clients (is_active);

create index clients_legal_name_trgm_idx
  on public.clients using gin (lower(legal_name) gin_trgm_ops);
create index clients_display_name_trgm_idx
  on public.clients using gin (lower(coalesce(display_name, '')) gin_trgm_ops);

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.clients enable row level security;

create policy "Authenticated users can view clients"
  on public.clients for select
  to authenticated
  using (true);

create policy "Owners, admins and finance can insert clients"
  on public.clients for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can update clients"
  on public.clients for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

-- Deliberately no delete policy: hard delete is blocked at the RLS layer.
-- The action layer (deleteClientAction) uses the service role to delete only
-- when there are zero referencing rows, falling back to is_active = false
-- otherwise.

------------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------------
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 4. search_clients RPC
------------------------------------------------------------------------------
create or replace function public.search_clients(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int default 0,
  p_limit        int default 50
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

comment on function public.search_clients(text, boolean, int, int) is
  'Fuzzy client search with offset/limit pagination. Honours RLS via security invoker.';

set row_security = on;
