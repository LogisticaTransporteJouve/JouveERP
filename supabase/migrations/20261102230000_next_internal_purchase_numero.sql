SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.11: the next número for an internal purchase (gasto interno /
-- remito de compra) follows the unique key it must not collide with.
--
-- The old next_internal_purchase_numero(channel, supplier) counted only
-- received rows of the channel and ignored the kind, while the unique key is
-- (supplier_id, kind, letter, punto_venta, numero) and counts cancelled rows
-- too: it could offer a número already taken by a cancelled purchase or by
-- another kind's series. It was also revoked from authenticated (audit T1a)
-- and the form called it from the browser, so it never filled anything.
--
-- The new one takes the kind and punto de venta and reads every status. An
-- internal purchase has no letter, so the series is the letterless one. Only
-- the server action calls it, through the service client.

-- The old signature had no working caller (revoked from authenticated), so
-- code rolled back to it loses nothing.
-- squawk-ignore ban-drop-function
drop function if exists public.next_internal_purchase_numero(text, uuid);

create function public.next_internal_purchase_numero(
  p_supplier_id uuid,
  p_kind text,
  p_punto_venta int default 1
)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(pi.numero), 0) + 1
    from public.purchase_invoices pi
   where pi.supplier_id = p_supplier_id
     and pi.kind = p_kind
     and pi.letter is null
     and pi.punto_venta = p_punto_venta;
$$;

comment on function public.next_internal_purchase_numero(uuid, text, int) is
  'Próximo número de una compra interna (sin letra) por proveedor, tipo y punto de venta; cuenta todos los estados, como la clave única.';

revoke all on function public.next_internal_purchase_numero(uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.next_internal_purchase_numero(uuid, text, int)
  to service_role;
