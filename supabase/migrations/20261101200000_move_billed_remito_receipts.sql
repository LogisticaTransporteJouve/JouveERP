SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A remito interno already collected and then billed (docs/otras-ventas.md §5):
-- the cobro passes to the fiscal side. Each recibo interno applied to the remito
-- is cancelled (its treasury movements go with it, handle_receipt_cancellation)
-- and a recibo of Ventas is issued to the factura's client with the same
-- payment lines, applied to the factura. The money is counted once, on the
-- fiscal side; the client still owes the IVA.
--
-- Called by the issue workflow (service role) once the factura is emitted,
-- before the remito is credited by its nota de crédito interna. Atomic and
-- idempotent: a retry finds the recibos already cancelled and moves nothing.
-- billRemitoAction only lets through recibos it can move: applied to this
-- remito alone, in pesos, without cheques, retentions or rejected cheques.
create or replace function public.move_billed_remito_receipts(p_factura_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factura record;
  v_receipt record;
  v_pos     int;
  v_numero  int;
  v_lines   jsonb;
  v_moved   int := 0;
begin
  select i.id, i.client_id, i.channel_id, i.source_remito_id, i.status
    into v_factura
  from public.invoices i
  where i.id = p_factura_id;

  if v_factura is null or v_factura.source_remito_id is null then
    return 0;
  end if;
  if v_factura.status <> 'emitted' then
    raise exception 'La factura todavía no está emitida.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select sp.numero into v_pos
  from public.sales_points sp
  where sp.channel_id = v_factura.channel_id and sp.is_enabled
  order by sp.numero
  limit 1;
  if v_pos is null then
    raise exception 'El canal fiscal no tiene un punto de venta habilitado para recibos.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  for v_receipt in
    select r.id, r.receipt_date, r.total_amount, r.currency, r.cotizacion,
           r.punto_venta, r.numero, ra.amount_applied
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where ra.invoice_id = v_factura.source_remito_id
      and r.status = 'issued'
    order by r.receipt_date, r.numero
    for update of r
  loop
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'account_id', l.account_id,
                 'amount', l.amount,
                 'reference', l.reference
               )
               order by l.created_at
             ),
             '[]'::jsonb
           )
      into v_lines
    from public.receipt_payment_lines l
    where l.receipt_id = v_receipt.id;

    update public.receipts
    set status = 'canceled',
        canceled_at = now()
    where id = v_receipt.id;

    perform pg_advisory_xact_lock(
      hashtext('receipt-numero:' || v_factura.channel_id || ':' || v_pos)
    );
    select coalesce(max(r.numero), 0) + 1 into v_numero
    from public.receipts r
    where r.channel_id = v_factura.channel_id and r.punto_venta = v_pos;

    perform public.create_receipt(
      v_factura.channel_id,
      v_pos,
      v_numero,
      v_factura.client_id,
      v_receipt.receipt_date,
      v_receipt.total_amount,
      v_receipt.currency,
      'Cobro pasado del recibo interno R'
        || lpad(v_receipt.punto_venta::text, 4, '0') || '-'
        || lpad(v_receipt.numero::text, 8, '0')
        || ' al facturar el remito.',
      v_lines,
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', v_factura.id,
          'amount_applied', v_receipt.amount_applied
        )
      ),
      '[]'::jsonb,
      v_receipt.cotizacion
    );
    v_moved := v_moved + 1;
  end loop;

  return v_moved;
end;
$$;

revoke all on function public.move_billed_remito_receipts(uuid) from public, anon, authenticated;
grant execute on function public.move_billed_remito_receipts(uuid) to service_role;
