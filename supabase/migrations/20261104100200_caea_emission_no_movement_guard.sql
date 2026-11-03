SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- No CAEA voucher under a CAEA already declared "sin movimiento" for its punto
-- de venta (audit w1-s5 F16).
--
-- issue-invoice picks the CAEA whose vigencia covers the voucher date, so a
-- draft dated in a past fortnight can be emitted under that fortnight's CAEA
-- after it ended. caea-inform declares an ended CAEA "sin movimiento" for each
-- contingency punto de venta that issued nothing under it; a voucher emitted
-- there afterwards is rejected by AFIP on every inform and never informed.
-- Now emit_caea_invoice refuses it (the voucher fails with the message and is
-- issued again with a current date). caea-inform also skips the declaration while a pending draft of
-- that punto de venta is dated inside the vigencia, which closes the window
-- between its AFIP filing and its no_movement_pvs write.
--
-- Starts from the latest body (20261016100000, with search_path = '' from
-- 20261031204719); every other case is unchanged. Same signature and grants.

create or replace function public.emit_caea_invoice(
  p_invoice_id uuid,
  p_afip_last int,
  p_caea text,
  p_cae_vencimiento date
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pv       int;
  v_tipo     int;
  v_status   text;
  v_existing int;
  v_next     int;
begin
  select punto_venta, cbte_tipo_afip into v_pv, v_tipo
    from public.invoices
   where id = p_invoice_id;
  if not found or v_tipo is null then
    raise exception 'invoice % is not a fiscal voucher', p_invoice_id
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('caea|' || v_pv::text || '|' || v_tipo::text, 0)
  );

  select numero, status into v_existing, v_status
    from public.invoices
   where id = p_invoice_id
     for update;
  if v_existing is not null then
    return v_existing;
  end if;
  if v_status not in ('draft', 'emitting') then
    raise exception 'invoice % is %, not pending emission', p_invoice_id, v_status
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.caea_codes c
     where c.caea = p_caea
       and c.no_movement_pvs @> to_jsonb(v_pv)
  ) then
    raise exception 'El CAEA % ya se informó a AFIP sin movimiento para el punto de venta %: emití el comprobante de nuevo con una fecha de la quincena vigente.',
      p_caea, v_pv
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select greatest(coalesce(max(numero), 0), coalesce(p_afip_last, 0)) + 1
    into v_next
    from public.invoices
   where punto_venta = v_pv
     and cbte_tipo_afip = v_tipo;

  update public.invoices
     set numero          = v_next,
         cae             = p_caea,
         cae_vencimiento = p_cae_vencimiento,
         emission_type   = 'caea',
         cbte_fch_hs_gen = now(),
         status          = 'emitted',
         emitted_at      = now()
   where id = p_invoice_id;

  return v_next;
end;
$$;

comment on function public.emit_caea_invoice(uuid, int, text, date) is
  'Numbers a CAEA voucher (greatest(local max, AFIP last) + 1 under an advisory lock) and marks it emitted with the CAEA in one transaction. Returns the existing number on a retry. Refuses a CAEA already declared without movement for the punto de venta.';

revoke all on function public.emit_caea_invoice(uuid, int, text, date) from public, anon, authenticated;
grant execute on function public.emit_caea_invoice(uuid, int, text, date) to service_role;
