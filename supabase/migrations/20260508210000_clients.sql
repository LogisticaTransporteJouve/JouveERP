-- C.1 — clients catalog.
--
-- One row per CUIT, shared across the entire organization. Clients are
-- intentionally NOT scoped to a business_unit or division: the same CUIT can
-- receive comprobantes from DZ Instalaciones and Logística Jouve, and the
-- division is decided at invoice time via the channel. Hard delete is
-- forbidden because historical comprobantes will reference clients.id;
-- instead, set is_active = false to retire a client.

set row_security = off;

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
  notes           text,
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.clients is 'Customer master catalog. One row per CUIT, shared across all divisions.';

alter table public.clients
  add constraint clients_cuit_format check (cuit ~ '^[0-9]{11}$');

create index clients_legal_name_idx on public.clients (legal_name);
create index clients_is_active_idx  on public.clients (is_active);

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

-- Deliberately no delete policy: retire clients via is_active = false so the
-- historical link from comprobantes/recibos to clients.id is preserved.

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

set row_security = on;
