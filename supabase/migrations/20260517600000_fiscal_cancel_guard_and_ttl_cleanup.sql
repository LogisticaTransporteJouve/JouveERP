-- Fiscal cancel guard + TTL cleanup.
--
-- 1. Trigger BEFORE UPDATE en invoices que bloquea emitted → cancelled
--    cuando channel.is_fiscal=true. Razón contable: una factura fiscal
--    con CAE no se "anula", se compensa con NC (que aporta otro CAE).
--    Marcarla cancelled localmente desalinea libro IVA local vs el de
--    AFIP. Para internas (is_fiscal=false) sí se permite, dispara el
--    reversal del asiento L.2c.
--
--    Transiciones permitidas:
--      draft / emitting / failed → cancelled (cualquier canal): OK
--        — no hay CAE todavía, es descarte de borrador.
--      emitted → cancelled (internal): OK
--        — sin AFIP, no hay desalineación posible.
--      emitted → cancelled (fiscal): BLOQUEAR
--        — forzar uso de NC para mantener trazabilidad con AFIP.
--
-- 2. RPCs cleanup_rate_limit_buckets() y cleanup_padron_cache() que
--    borran rows expirados. Llamados por cron Inngest diario
--    (lib/inngest/functions/ttl-cleanup.ts). afip_ta_cache NO necesita
--    cleanup — su PK es service text, así que cada llamada hace upsert
--    sobre la misma row (1-3 rows totales para siempre).

set row_security = off;

------------------------------------------------------------------------------
-- 1. Guard de cancelación fiscal
------------------------------------------------------------------------------
create or replace function public.check_fiscal_cancel_requires_nc()
returns trigger
language plpgsql
as $$
declare
  v_is_fiscal boolean;
begin
  -- Solo nos interesa la transición emitted → cancelled.
  if old.status <> 'emitted' or new.status <> 'cancelled' then
    return new;
  end if;

  select c.is_fiscal into v_is_fiscal
    from public.invoicing_channels c
   where c.id = new.channel_id;

  if v_is_fiscal is true then
    raise exception
      'Comprobante fiscal % no se puede anular: emití una NC para compensar (AFIP no soporta cancel post-CAE)',
      old.id
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.check_fiscal_cancel_requires_nc() is
  'Bloquea emitted → cancelled cuando el canal es fiscal (CAE post-emisión obliga a usar NC). Internos se permiten para que L.2c emita reversal.';

create trigger invoices_fiscal_cancel_guard
  before update of status on public.invoices
  for each row execute function public.check_fiscal_cancel_requires_nc();

------------------------------------------------------------------------------
-- 2. cleanup_rate_limit_buckets
------------------------------------------------------------------------------
-- rate_limit_buckets acumula 1 row por (user, bucket, window_start).
-- Windows típicas son horarias (rate-limit padrón = 60/h por user). Sin
-- cleanup, ~24 rows/user/día → crece sin límite. Borramos cualquier row
-- con window_start > 7 días para mantener bajo el footprint, sin
-- comprometer ningún rate-limit activo (ventana actual ≤ 1h).

create or replace function public.cleanup_rate_limit_buckets(
  p_older_than interval default interval '7 days'
)
returns int
language sql
security definer
set search_path = public
as $$
  with del as (
    delete from public.rate_limit_buckets
     where window_start < now() - p_older_than
    returning 1
  )
  select count(*)::int from del;
$$;

comment on function public.cleanup_rate_limit_buckets is
  'Borra rate_limit_buckets con window_start > p_older_than. Default 7 días — las ventanas activas son horarias.';

revoke all on function public.cleanup_rate_limit_buckets(interval) from public;
grant execute on function public.cleanup_rate_limit_buckets(interval) to service_role;

------------------------------------------------------------------------------
-- 3. cleanup_padron_cache
------------------------------------------------------------------------------
-- padron_cache acumula 1 row por CUIT consultado. TTL semántico = 24h
-- (el action layer respeta esto). Sin cleanup, ~5k rows/mes en un
-- proyecto activo. Borramos cualquier row con cached_at > 30 días: ya
-- pasó el TTL hace tiempo y la próxima consulta a ese CUIT re-fetchea.

create or replace function public.cleanup_padron_cache(
  p_older_than interval default interval '30 days'
)
returns int
language sql
security definer
set search_path = public
as $$
  with del as (
    delete from public.padron_cache
     where cached_at < now() - p_older_than
    returning 1
  )
  select count(*)::int from del;
$$;

comment on function public.cleanup_padron_cache is
  'Borra padron_cache con cached_at > p_older_than. Default 30 días — TTL semántico es 24h.';

revoke all on function public.cleanup_padron_cache(interval) from public;
grant execute on function public.cleanup_padron_cache(interval) to service_role;

set row_security = on;
