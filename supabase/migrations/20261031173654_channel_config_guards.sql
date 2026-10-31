SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Channel and POS configuration cannot rewrite history
-- (docs/plan-separacion-fiscal-interno.md, PR F, 5.1):
--   * invoicing_channels: is_fiscal and division are fixed once the channel has
--     documents. Renaming and (de)activating stay allowed.
--   * sales_points: a POS cannot leave a channel that already numbered
--     invoices, receipts or payment orders with it, and a POS synced with AFIP
--     cannot move to a non-fiscal channel.

create or replace function public.guard_invoicing_channel_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoices where channel_id = old.id)
     or exists (select 1 from public.purchase_invoices where channel_id = old.id)
     or exists (select 1 from public.receipts where channel_id = old.id)
     or exists (select 1 from public.payment_orders where channel_id = old.id)
     or exists (select 1 from public.transactions where channel_id = old.id)
     or exists (select 1 from public.loans where channel_id = old.id)
     or exists (select 1 from public.payroll_payments where channel_id = old.id)
     or exists (select 1 from public.journal_entries where channel_id = old.id)
     or exists (select 1 from public.shipments where channel_id = old.id)
     or exists (select 1 from public.trips where channel_id = old.id) then
    raise exception 'El canal % ya tiene documentos: no se puede cambiar si es fiscal ni su división', old.name
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoicing_channel_config() from public, anon, authenticated;

drop trigger if exists guard_invoicing_channel_config on public.invoicing_channels;
create trigger guard_invoicing_channel_config
  before update of is_fiscal, division on public.invoicing_channels
  for each row
  when (new.is_fiscal is distinct from old.is_fiscal or new.division is distinct from old.division)
  execute function public.guard_invoicing_channel_config();

create or replace function public.guard_sales_point_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fiscal boolean;
begin
  if old.channel_id is not null
     and (exists (select 1 from public.invoices
                   where channel_id = old.channel_id and punto_venta = old.numero)
          or exists (select 1 from public.receipts
                      where channel_id = old.channel_id and punto_venta = old.numero)
          or exists (select 1 from public.payment_orders
                      where channel_id = old.channel_id and punto_venta = old.numero)) then
    raise exception 'El POS % ya numeró comprobantes en su canal: no se lo puede cambiar de canal', old.numero
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if new.last_synced_at is not null and new.channel_id is not null then
    select is_fiscal into v_fiscal from public.invoicing_channels where id = new.channel_id;
    if not coalesce(v_fiscal, false) then
      raise exception 'El POS % está sincronizado con AFIP: solo puede ir a un canal fiscal', new.numero
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sales_point_channel() from public, anon, authenticated;

drop trigger if exists guard_sales_point_channel on public.sales_points;
create trigger guard_sales_point_channel
  before update of channel_id on public.sales_points
  for each row
  when (new.channel_id is distinct from old.channel_id)
  execute function public.guard_sales_point_channel();
