-- Fase H.1 — Masters de depósito (negocio 3PL de Logística Jouve): depósitos
-- propios (warehouses), productos de cliente almacenados (products) y pallets
-- físicos (pallets). Tarifas + facturación de almacenaje llegan en H.2/H.3/H.5
-- (dependen del modelo de precio del cliente). docs/roadmap.md Fase H.
--
-- RLS: warehouses/pallets gestionados por owner/admin/warehouse; products los
-- escribe owner/admin (catálogo) y los lee también warehouse.

set row_security = off;

------------------------------------------------------------------------------
-- 1. warehouses (depósitos propios)
------------------------------------------------------------------------------
create table public.warehouses (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  address          text,
  capacity_pallets integer check (capacity_pallets is null or capacity_pallets >= 0),
  is_active        boolean not null default true,
  notes            text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.warehouses is
  'Depósitos propios donde Logística Jouve almacena mercadería de clientes (3PL).';

create index warehouses_active_idx on public.warehouses (is_active, name);

create trigger warehouses_set_updated_at
  before update on public.warehouses
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. products (productos de cliente almacenados)
------------------------------------------------------------------------------
create table public.products (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete restrict,
  name       text not null,
  sku        text,
  unit       text,
  is_active  boolean not null default true,
  notes      text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.products is
  'Catálogo de productos de cliente que se almacenan. Pertenecen a un cliente (3PL).';

create index products_client_idx on public.products (client_id, name);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 3. pallets (unidades físicas almacenadas)
------------------------------------------------------------------------------
create table public.pallets (
  id           uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  client_id    uuid not null references public.clients (id) on delete restrict,
  product_id   uuid references public.products (id) on delete set null,
  code         text not null,
  quantity     numeric(12, 2) check (quantity is null or quantity >= 0),
  status       text not null default 'en_deposito'
                 check (status in ('en_deposito', 'despachado')),
  entry_date   date not null,
  exit_date    date,
  notes        text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint pallets_exit_after_entry
    check (exit_date is null or exit_date >= entry_date)
);

comment on table public.pallets is
  'Pallets físicos almacenados por cliente en un depósito. status en_deposito/despachado; entry/exit para facturación de almacenaje (H.3).';

create index pallets_warehouse_idx on public.pallets (warehouse_id, status);
create index pallets_client_idx on public.pallets (client_id);
create index pallets_status_idx on public.pallets (status, entry_date);

create trigger pallets_set_updated_at
  before update on public.pallets
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 4. RLS
------------------------------------------------------------------------------
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.pallets enable row level security;

-- warehouses: owner/admin/warehouse
create policy "warehouses select"
  on public.warehouses for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'warehouse']));
create policy "warehouses insert"
  on public.warehouses for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'warehouse']));
create policy "warehouses update"
  on public.warehouses for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'warehouse']))
  with check (public.user_has_role(array['owner', 'admin', 'warehouse']));
create policy "warehouses delete"
  on public.warehouses for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'warehouse']));

-- pallets: owner/admin/warehouse
create policy "pallets select"
  on public.pallets for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'warehouse']));
create policy "pallets insert"
  on public.pallets for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'warehouse']));
create policy "pallets update"
  on public.pallets for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'warehouse']))
  with check (public.user_has_role(array['owner', 'admin', 'warehouse']));
create policy "pallets delete"
  on public.pallets for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'warehouse']));

-- products: lectura owner/admin/warehouse; escritura owner/admin (catálogo)
create policy "products select"
  on public.products for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'warehouse']));
create policy "products insert"
  on public.products for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin']));
create policy "products update"
  on public.products for update to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));
create policy "products delete"
  on public.products for delete to authenticated
  using (public.user_has_role(array['owner', 'admin']));
