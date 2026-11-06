SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Confirming a liquidación de fletes reprices its cargas from their current
-- flete or tariff (confirm_freight_settlement_document). An assistant
-- proposal shows the total before the user accepts it; a flete or tariff
-- edited in between would confirm (and number a Remito R for) a total the
-- user never saw.
--
-- confirm_freight_settlement_document(uuid, uuid, numeric) is the confirm,
-- unchanged, that refuses when the repriced total is not p_expected_total.
-- It runs the two-argument confirm and then compares, in the same
-- transaction, so a refusal rolls back the repricing and the remito number.
-- A liquidación already confirmed returns as before, whatever its total.
--
-- The two-argument confirm keeps its signature, body and grants: the app's
-- form and code deployed before this change call it.
--
-- Rollback: older code calls only the two-argument confirm, which this
-- migration does not touch; the new overload can stay.

create function public.confirm_freight_settlement_document(
  p_settlement_id  uuid,
  p_user_id        uuid,
  p_expected_total numeric
)
returns table (
  channel       text,
  numero        bigint,
  remito_pos    integer,
  remito_number bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text;
  v_total  numeric;
begin
  if p_expected_total is null then
    raise exception 'Falta el total que se confirma.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- The same row lock the confirm takes, so the status read here is the one
  -- it confirms from.
  select fs.status
    into v_status
    from public.freight_settlements fs
   where fs.id = p_settlement_id
     for update;

  return query
    select c.channel, c.numero, c.remito_pos, c.remito_number
      from public.confirm_freight_settlement_document(p_settlement_id, p_user_id) c;

  if v_status = 'draft' then
    select fs.total
      into v_total
      from public.freight_settlements fs
     where fs.id = p_settlement_id;
    if v_total <> round(p_expected_total, 2) then
      raise exception 'El total de la liquidación cambió desde la propuesta (se editó el flete o la tarifa de una carga): revisala y volvé a confirmarla.'
        using errcode = '22023', hint = 'jouve_guard';
    end if;
  end if;
end;
$$;

comment on function public.confirm_freight_settlement_document(uuid, uuid, numeric) is
  'Confirma la liquidación como confirm_freight_settlement_document(uuid, uuid) y la rechaza si el total revalorizado no es p_expected_total.';

revoke all on function public.confirm_freight_settlement_document(uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.confirm_freight_settlement_document(uuid, uuid, numeric)
  to service_role;
