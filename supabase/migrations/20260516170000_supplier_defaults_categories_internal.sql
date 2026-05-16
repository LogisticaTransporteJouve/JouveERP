-- K.12 — Supplier defaults + categories + internal expense support.
--
-- Tres piezas cohesivas:
--   (A) suppliers.default_channel_id + default_payment_term_days
--       Pre-fillean canal y fecha de vencimiento en el form de purchase
--       invoice cuando se elige el proveedor (modo create, no edit).
--
--   (B) supplier_categories (nueva tabla) + suppliers.category_id
--       CRUD para clasificar proveedores (combustible, mantenimiento,
--       oficina, servicios, repuestos, otros). Seed con 6 categorías
--       típicas de logística. Habilita filtros, badges en la lista, y
--       pavimenta el camino para que L.2 use la categoría como hint del
--       asiento contable automático.
--
--   (C) RPC next_internal_purchase_numero(p_channel_id, p_supplier_id)
--       Auto-numero para "gastos internos" (canal interno). Symmetry con
--       lo que hace E.7 para comprobantes internos del lado ventas.
--       Devuelve max(numero) + 1 dentro del par (channel, supplier).
--       PV default = 1 (los internos no tienen punto de venta real).

set row_security = off;

------------------------------------------------------------------------------
-- 1. supplier_categories
------------------------------------------------------------------------------
create table public.supplier_categories (
  id            uuid       primary key default gen_random_uuid(),
  name          text       not null,
  slug          text       not null,
  is_active     boolean    not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint supplier_categories_slug_unique unique (slug),
  constraint supplier_categories_name_unique unique (name),
  constraint supplier_categories_slug_format check (slug ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.supplier_categories is
  'Categorías para clasificar proveedores (combustible, mantenimiento, etc.). En L.2 se usan como hint para sugerir la cuenta contable del asiento auto.';

create trigger supplier_categories_set_updated_at
  before update on public.supplier_categories
  for each row execute function public.set_updated_at();

-- Seed con 6 categorías típicas de logística. Sort_order vía orden alfabético
-- por name (no agregamos una columna sort_order — se reordenan en la UI).
insert into public.supplier_categories (name, slug) values
  ('Combustible',     'combustible'),
  ('Mantenimiento',   'mantenimiento'),
  ('Oficina',         'oficina'),
  ('Repuestos',       'repuestos'),
  ('Servicios',       'servicios'),
  ('Otros',           'otros');

------------------------------------------------------------------------------
-- 2. New columns on suppliers (3 nullable adds)
------------------------------------------------------------------------------
alter table public.suppliers
  add column default_channel_id        text         references public.invoicing_channels (id) on delete set null,
  add column default_payment_term_days int          check (default_payment_term_days is null or (default_payment_term_days between 1 and 365)),
  add column category_id               uuid         references public.supplier_categories (id) on delete set null;

create index suppliers_category_idx          on public.suppliers (category_id);
create index suppliers_default_channel_idx   on public.suppliers (default_channel_id);

comment on column public.suppliers.default_channel_id is
  'Canal pre-seleccionado al cargar una nueva factura para este proveedor (opcional). Útil para proveedores recurrentes (YPF siempre va a jouve_fiscal).';
comment on column public.suppliers.default_payment_term_days is
  'Días que se suman a la fecha de la factura para calcular fch_vto_pago (opcional). User puede sobreescribir siempre.';
comment on column public.suppliers.category_id is
  'Categoría para clasificación de gastos. Usado por filtros + (futuro L.2) como hint del asiento contable.';

------------------------------------------------------------------------------
-- 3. RLS para supplier_categories (mismo patrón que suppliers)
------------------------------------------------------------------------------
alter table public.supplier_categories enable row level security;

create policy "Authenticated users can view supplier categories"
  on public.supplier_categories for select
  to authenticated
  using (true);

create policy "Owners, admins and finance can insert supplier categories"
  on public.supplier_categories for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can update supplier categories"
  on public.supplier_categories for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and admins can delete supplier categories"
  on public.supplier_categories for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

------------------------------------------------------------------------------
-- 4. RPC next_internal_purchase_numero
------------------------------------------------------------------------------
-- Para "gastos internos" (canal con is_fiscal=false), auto-numera por
-- (channel_id, supplier_id). Mismo patrón que el branch interno de E.7 en
-- comprobantes emitidos.
--
-- Por qué filtrar por supplier también: en un canal interno, cada
-- "comprobante" del proveedor X es un gasto que él nos pasó. Numerar
-- 1, 2, 3 dentro del par (canal, proveedor) hace que sean trazables.
-- Si filtráramos solo por canal, dos proveedores compartirían serie y
-- es más confuso.
--
-- Devuelve el próximo número. PV default = 1 (sin punto de venta real).
-- Filtra cancelados para no reusar números de comprobantes anulados.

create or replace function public.next_internal_purchase_numero(
  p_channel_id  text,
  p_supplier_id uuid
)
returns int
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(max(numero), 0) + 1
  from public.purchase_invoices
  where channel_id = p_channel_id
    and supplier_id = p_supplier_id
    and status = 'received';
$$;

comment on function public.next_internal_purchase_numero(text, uuid) is
  'Próximo numero para gastos internos por (canal, proveedor). Symmetry con E.7 lado ventas. Filtra cancelados.';

set row_security = on;
