SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Facturar un remito interno (docs/otras-ventas.md §4): a fiscal factura can
-- come from one remito interno of Otras ventas. Once the factura has its CAE,
-- the issue workflow credits the remito with a nota de crédito interna, so the
-- sale exists once, on the fiscal side.

alter table public.invoices add column source_remito_id uuid;

alter table public.invoices
  add constraint invoices_source_remito_id_fkey
  foreign key (source_remito_id) references public.invoices (id)
  on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.invoices validate constraint invoices_source_remito_id_fkey;

comment on column public.invoices.source_remito_id is
  'Fiscal factura billed from this remito interno; the remito is credited by an internal NC once the factura is emitted.';

-- A remito is billed once: a live factura (not failed or cancelled) per remito.
-- squawk-ignore require-concurrent-index-creation
create unique index invoices_source_remito_live_key
  on public.invoices (source_remito_id)
  where source_remito_id is not null and status not in ('failed', 'cancelled');

-- Plain lookup by remito (the FK's delete check and the frozen-remito guard).
-- squawk-ignore require-concurrent-index-creation
create index invoices_source_remito_idx
  on public.invoices (source_remito_id)
  where source_remito_id is not null;

create or replace function public.guard_invoice_source_remito()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel_fiscal boolean;
  v_remito         record;
begin
  if new.source_remito_id is null then
    return new;
  end if;

  select c.is_fiscal into v_channel_fiscal
  from public.invoicing_channels c
  where c.id = new.channel_id;

  if new.kind <> 'factura' or not coalesce(v_channel_fiscal, false) then
    raise exception 'Solo una factura de Ventas puede facturar un remito interno.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select i.kind, i.status, ch.is_fiscal
    into v_remito
  from public.invoices i
  join public.invoicing_channels ch on ch.id = i.channel_id
  where i.id = new.source_remito_id;

  if v_remito is null
     or v_remito.kind <> 'factura'
     or v_remito.is_fiscal
     or v_remito.status <> 'emitted' then
    raise exception 'El origen tiene que ser un remito interno emitido.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoice_source_remito() from public, anon, authenticated;

create trigger invoices_source_remito_guard
  before insert or update of source_remito_id on public.invoices
  for each row execute function public.guard_invoice_source_remito();
