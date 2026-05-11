-- E.2 — Comprobantes (facturas + notas de crédito + débito).
--
-- One table for fiscal and internal kinds. The discriminator is
-- `invoicing_channels.is_fiscal`; fiscal rows carry letter + cbte_tipo_afip
-- + cae + cae_vencimiento, internal rows leave them null. A trigger enforces
-- "if fiscal then letter and cbte_tipo_afip not null" because CHECK can't
-- read other tables.
--
-- Numbering uniqueness is per (channel_id, punto_venta, kind, letter,
-- numero) via an expression index that COALESCEs letter to '' so internal
-- rows (where letter is null) still collide on the same numero. Without
-- the COALESCE, Postgres's "NULL is distinct" semantics would let two
-- internal rows share the same numero.
--
-- Idempotency: every draft has a server-generated key before the WSFEv1
-- call. If AFIP times out we retry with the same key without re-creating
-- the row.

set row_security = off;

------------------------------------------------------------------------------
-- 1. invoices
------------------------------------------------------------------------------
create table public.invoices (
  id                       uuid primary key default gen_random_uuid(),

  -- Routing
  channel_id               text        not null references public.invoicing_channels (id) on delete restrict,
  client_id                uuid        not null references public.clients (id)            on delete restrict,
  kind                     text        not null check (kind in ('factura', 'nc', 'nd')),
  letter                   char(1)              check (letter in ('A', 'B', 'C')),
  punto_venta              int         not null check (punto_venta between 1 and 99999),
  numero                   int         not null check (numero >= 1),

  -- Dates
  fecha                    date        not null,
  fch_serv_desde           date,
  fch_serv_hasta           date,
  fch_vto_pago             date,

  -- Concepto AFIP: 1 productos, 2 servicios, 3 productos y servicios
  concepto                 int         not null check (concepto in (1, 2, 3)),

  -- Receptor (snapshot of client at issuance time)
  doc_tipo                 int         not null,
  doc_nro                  text        not null,
  iva_condition_receptor   int,

  -- AFIP type code: 1 (FA), 2 (ND A), 3 (NC A), 6 (FB), 7 (ND B), 8 (NC B),
  -- 11 (FC), 12 (ND C), 13 (NC C). Null for internal.
  cbte_tipo_afip           int         check (cbte_tipo_afip is null or cbte_tipo_afip > 0),
  cbte_tipo_origen_afip    int,

  -- Amounts. numeric(15,2) to avoid float rounding; AFIP also expects two
  -- decimals. Internal rows usually have imp_iva = 0 and imp_total = imp_neto.
  imp_neto                 numeric(15,2) not null default 0,
  imp_iva                  numeric(15,2) not null default 0,
  imp_trib                 numeric(15,2) not null default 0,
  imp_tot_conc             numeric(15,2) not null default 0,
  imp_op_ex                numeric(15,2) not null default 0,
  imp_total                numeric(15,2) not null,

  -- Currency
  moneda                   text        not null default 'PES',
  cotizacion               numeric(10,4) not null default 1,

  -- AFIP response
  cae                      text,
  cae_vencimiento          date,
  afip_observaciones       jsonb,

  -- Workflow
  status                   text        not null default 'draft'
                                       check (status in ('draft', 'emitting', 'emitted', 'failed', 'cancelled')),
  invoice_origin_id    uuid        references public.invoices (id) on delete restrict,
  motivo_nc_nd             text,
  pdf_url                  text,
  emitted_at               timestamptz,
  notified_at              timestamptz,

  -- Idempotency: every row carries a key before AFIP is called.
  idempotency_key          text        not null unique,

  -- Audit
  created_by               uuid        references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- NC and ND must reference an origen.
  constraint invoices_nc_nd_requires_origen
    check (kind = 'factura' or invoice_origin_id is not null),

  -- imp_total can never be negative (NC/ND credits live in their own row,
  -- not as a negative invoice).
  constraint invoices_imp_total_non_negative
    check (imp_total >= 0)
);

comment on table public.invoices is
  'Facturas, NC and ND for fiscal and internal channels. is_fiscal lives on the channel.';

-- Numbering uniqueness: COALESCE letter to '' so internal rows (letter null)
-- still conflict on duplicate numero.
create unique index invoices_unique_numbering
  on public.invoices (channel_id, punto_venta, kind, coalesce(letter::text, ''), numero);

create index invoices_channel_fecha_idx
  on public.invoices (channel_id, fecha desc);
create index invoices_client_idx
  on public.invoices (client_id);
create index invoices_status_idx
  on public.invoices (status);
create index invoices_origen_idx
  on public.invoices (invoice_origin_id)
  where invoice_origin_id is not null;

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. invoice_items
------------------------------------------------------------------------------
create table public.invoice_items (
  id                uuid       primary key default gen_random_uuid(),
  invoice_id   uuid       not null references public.invoices (id) on delete cascade,
  sort_order       int        not null default 0,
  description      text       not null,
  quantity         numeric(15,4) not null check (quantity > 0),
  unit_price       numeric(15,4) not null check (unit_price >= 0),
  iva_rate_id      int        check (iva_rate_id in (3, 4, 5, 6, 8, 9)),
  line_neto        numeric(15,2) not null,
  line_iva         numeric(15,2) not null default 0,
  line_total       numeric(15,2) not null,
  created_at       timestamptz not null default now()
);

comment on table public.invoice_items is
  'Line items of a invoice. iva_rate_id maps to AFIP alícuota IDs (3=0%, 4=10.5%, 5=21%, 6=27%, 8=5%, 9=2.5%).';

create index invoice_items_invoice_idx
  on public.invoice_items (invoice_id);

------------------------------------------------------------------------------
-- 3. Fiscal-fields trigger
------------------------------------------------------------------------------
-- A CHECK can't read another table, so this lives as a BEFORE INSERT/UPDATE
-- trigger. Validates that fiscal channels carry letter + cbte_tipo_afip.
create or replace function public.check_invoice_fiscal_fields()
returns trigger
language plpgsql
as $$
declare
  channel_is_fiscal boolean;
begin
  select c.is_fiscal into channel_is_fiscal
    from public.invoicing_channels c
   where c.id = new.channel_id;

  if channel_is_fiscal is null then
    raise exception 'invoicing_channels row not found for channel_id=%', new.channel_id;
  end if;

  if channel_is_fiscal then
    if new.letter is null then
      raise exception 'fiscal channels require letter (A, B or C)';
    end if;
    if new.cbte_tipo_afip is null then
      raise exception 'fiscal channels require cbte_tipo_afip';
    end if;
    if new.iva_condition_receptor is null then
      raise exception 'fiscal channels require iva_condition_receptor (RG 5616)';
    end if;
  end if;

  return new;
end;
$$;

create trigger invoices_fiscal_check
  before insert or update of channel_id, letter, cbte_tipo_afip, iva_condition_receptor
  on public.invoices
  for each row execute function public.check_invoice_fiscal_fields();

------------------------------------------------------------------------------
-- 4. RLS
------------------------------------------------------------------------------
alter table public.invoices enable row level security;

create policy "Authenticated finance can view invoices"
  on public.invoices for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Authenticated finance can insert invoices"
  on public.invoices for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Authenticated finance can update invoices"
  on public.invoices for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

-- No DELETE policy: cancellation goes through status='cancelled' (internal)
-- or NC/ND emission (fiscal). Hard deletes only via service role.

alter table public.invoice_items enable row level security;

create policy "Authenticated finance can view invoice items"
  on public.invoice_items for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Authenticated finance can insert invoice items"
  on public.invoice_items for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Authenticated finance can update invoice items"
  on public.invoice_items for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Authenticated finance can delete invoice items"
  on public.invoice_items for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

set row_security = on;
