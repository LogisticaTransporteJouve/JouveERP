SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Tray of the vouchers ARCA lists under Mis Comprobantes → Recibidos. A
-- person accepts each one into purchases (picking account, cost center and
-- the tribute split) or discards it; nothing reaches purchase_invoices
-- without that accept. A voucher already loaded as a purchase is linked to it
-- (on ingest, and later by the trigger when the purchase is loaded by hand).
--
-- Writes go through the service role from actions gated by
-- purchase_invoices:write; the select policy mirrors the roles that hold it.

create table public.arca_received_vouchers (
  id                    uuid primary key default gen_random_uuid(),
  origin                text not null check (origin in ('upload', 'sync')),
  run_id                uuid,
  issuer_cuit           text not null check (issuer_cuit ~ '^\d{11}$'),
  issuer_name           text not null check (char_length(issuer_name) <= 300),
  cbte_tipo             bigint not null check (cbte_tipo > 0),
  kind                  text check (kind in ('factura', 'nc', 'nd')),
  letter                text check (letter in ('A', 'B', 'C')),
  punto_venta           bigint not null check (punto_venta > 0),
  numero                bigint not null check (numero > 0),
  fecha                 date not null,
  cae                   text check (cae is null or char_length(cae) <= 20),
  moneda                text not null default 'PES' check (moneda in ('PES', 'DOL')),
  cotizacion            numeric(15, 6) check (cotizacion is null or cotizacion > 0),
  imp_neto_gravado      numeric(15, 2) not null default 0 check (imp_neto_gravado >= 0),
  imp_no_gravado        numeric(15, 2) not null default 0 check (imp_no_gravado >= 0),
  imp_op_exentas        numeric(15, 2) not null default 0 check (imp_op_exentas >= 0),
  imp_iva               numeric(15, 2) not null default 0 check (imp_iva >= 0),
  imp_trib              numeric(15, 2) not null default 0 check (imp_trib >= 0),
  imp_total             numeric(15, 2) not null check (imp_total >= 0),
  -- Keys perc_iva, perc_iibb, municipales, internos: only when the export
  -- carries those columns. ARCA's file usually has only "Otros Tributos".
  trib_breakdown        jsonb not null default '{}'::jsonb check (jsonb_typeof(trib_breakdown) = 'object'),
  -- [{ "iva_rate_id": 5, "neto": 100, "iva": 21 }, …] when the export has
  -- per-rate columns.
  iva_breakdown         jsonb not null default '[]'::jsonb check (jsonb_typeof(iva_breakdown) = 'array'),
  status                text not null default 'pending_review'
                          check (status in ('pending_review', 'confirmed', 'discarded', 'unsupported')),
  purchase_invoice_id   uuid references public.purchase_invoices (id) on delete set null,
  claimed_at            timestamptz,
  discard_reason        text check (discard_reason is null or char_length(discard_reason) <= 200),
  reviewed_by           uuid references auth.users (id) on delete set null,
  reviewed_at           timestamptz,
  first_seen_at         timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint arca_received_vouchers_kind_letter check ((kind is null) = (letter is null)),
  constraint arca_received_vouchers_unsupported check ((status = 'unsupported') = (kind is null)),
  constraint arca_received_vouchers_key unique (issuer_cuit, cbte_tipo, punto_venta, numero)
);

comment on table public.arca_received_vouchers is
  'Bandeja de Mis Comprobantes → Recibidos (ARCA): cada comprobante se acepta como compra o se descarta.';

create index arca_received_vouchers_status_fecha_idx
  on public.arca_received_vouchers (status, fecha desc, id desc);
create index arca_received_vouchers_open_key_idx
  on public.arca_received_vouchers (issuer_cuit, kind, punto_venta, numero)
  where status in ('pending_review', 'discarded');
create index arca_received_vouchers_purchase_idx
  on public.arca_received_vouchers (purchase_invoice_id);
create index arca_received_vouchers_reviewed_by_idx
  on public.arca_received_vouchers (reviewed_by);

create trigger arca_received_vouchers_set_updated_at
  before update on public.arca_received_vouchers
  for each row execute function public.set_updated_at();

alter table public.arca_received_vouchers enable row level security;

-- Same roles as purchase_invoices:write (lib/auth/permissions.ts).
create policy "Purchase writers view received vouchers" on public.arca_received_vouchers
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance'])) );

revoke all on table public.arca_received_vouchers from public, anon, authenticated;
grant select on table public.arca_received_vouchers to authenticated;
grant all on table public.arca_received_vouchers to service_role;

------------------------------------------------------------------------------
-- Link to a purchase already loaded
------------------------------------------------------------------------------

-- Links each pending or discarded voucher in p_ids to a received purchase on a
-- fiscal channel with the same supplier CUIT, kind, punto de venta and número:
-- same letter first, else a purchase loaded without letter. Returns how many
-- were linked.
create or replace function public.link_received_vouchers(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with matches as (
    select v.id as voucher_id,
           coalesce(
             (select p.id
                from public.purchase_invoices p
                join public.suppliers s on s.id = p.supplier_id
                join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
               where s.cuit = v.issuer_cuit and p.kind = v.kind
                 and p.punto_venta = v.punto_venta and p.numero = v.numero
                 and p.status = 'received' and p.letter = v.letter
               limit 1),
             (select p.id
                from public.purchase_invoices p
                join public.suppliers s on s.id = p.supplier_id
                join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
               where s.cuit = v.issuer_cuit and p.kind = v.kind
                 and p.punto_venta = v.punto_venta and p.numero = v.numero
                 and p.status = 'received' and p.letter is null
               limit 1)
           ) as purchase_id
      from public.arca_received_vouchers v
     where v.id = any (p_ids)
       and v.status in ('pending_review', 'discarded')
  )
  update public.arca_received_vouchers v
     set status = 'confirmed',
         purchase_invoice_id = m.purchase_id,
         reviewed_at = now(),
         claimed_at = null
    from matches m
   where v.id = m.voucher_id
     and m.purchase_id is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.link_received_vouchers(uuid[]) from public, anon, authenticated;
grant execute on function public.link_received_vouchers(uuid[]) to service_role;

-- A purchase loaded by hand (or edited into the same key) after the voucher
-- reached the tray links it.
create or replace function public.purchase_invoices_link_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(v.id) into v_ids
    from public.arca_received_vouchers v
    join public.suppliers s on s.cuit = v.issuer_cuit
   where s.id = new.supplier_id
     and v.kind = new.kind
     and v.punto_venta = new.punto_venta
     and v.numero = new.numero
     and v.status in ('pending_review', 'discarded');
  if v_ids is not null then
    perform public.link_received_vouchers(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function public.purchase_invoices_link_received() from public, anon, authenticated;

create trigger purchase_invoices_link_received
  after insert or update of supplier_id, kind, letter, punto_venta, numero, status, channel_id
  on public.purchase_invoices
  for each row
  when (new.status = 'received')
  execute function public.purchase_invoices_link_received();
