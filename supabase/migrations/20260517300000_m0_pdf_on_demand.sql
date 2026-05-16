-- M.0 — Comprobantes PDF on-demand (drop invoices-pdf bucket).
--
-- Decisión: el PDF se regenera desde data + items en cada request. El QR
-- AFIP es función pura de los datos (cae + cae_vencimiento + receptor +
-- importes), así que el QR escaneable es siempre el mismo. Guardar bytes
-- en Storage no agrega validez fiscal — solo inmutabilidad visual.
--
-- Para esa parte alcanza con un hash SHA256 del PDF original (calculado
-- y persistido el día de la emisión). Permite probar criptográficamente
-- que el PDF servido hoy es bit-a-bit idéntico al del día de la emisión,
-- sin guardar los bytes.
--
-- Lo que hace esta migration:
--   1. Agrega columna `invoices.pdf_hash` (text, opcional). Lo llena el
--      step Inngest de emisión.
--   2. Trigger BEFORE UPDATE en `invoices` que rechaza cambios a campos
--      fiscales-críticos cuando status = 'emitted'. Blinda inmutabilidad
--      en la DB, no solo por convención de app.
--   3. Dropea columna `invoices.pdf_url` (los signed URLs vencían rápido
--      y el endpoint regenera on-demand).
--   4. Borra todos los objetos del bucket `invoices-pdf` y luego el bucket.
--
-- Si el otro flow Inngest sigue creando objetos en el bucket entre la
-- aplicación de esta migration y el deploy de código actualizado, la
-- migration falla por FK constraint del bucket. En la práctica deploys
-- son atómicos para esto.

set row_security = off;

------------------------------------------------------------------------------
-- 1. pdf_hash
------------------------------------------------------------------------------
alter table public.invoices
  add column pdf_hash text;

comment on column public.invoices.pdf_hash is
  'SHA256 hex del PDF generado en el momento de la emisión. Prueba criptográfica de integridad — el endpoint regenera on-demand y compara opcionalmente.';

------------------------------------------------------------------------------
-- 2. Trigger inmutabilidad post-CAE
------------------------------------------------------------------------------
-- E.5 ya tenía un trigger `invoices_enforce_immutability_on_emitted` que
-- protegía algunos campos. Lo reemplazamos por uno más completo que
-- bloquea TODOS los campos AFIP-críticos cuando status = 'emitted'.

drop trigger if exists invoices_enforce_immutability_on_emitted on public.invoices;
drop function if exists public.check_invoice_immutability();

create or replace function public.check_invoice_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'emitted' then
    return new;
  end if;

  -- Status puede transicionar emitted → cancelled (anulación), pero no
  -- volver atrás.
  if new.status <> 'emitted' and new.status <> 'cancelled' then
    raise exception 'invoice % está emitted: status solo puede pasar a cancelled', old.id;
  end if;

  if  new.cae               is distinct from old.cae
   or new.cae_vencimiento   is distinct from old.cae_vencimiento
   or new.imp_total         is distinct from old.imp_total
   or new.imp_neto          is distinct from old.imp_neto
   or new.imp_iva           is distinct from old.imp_iva
   or new.imp_trib          is distinct from old.imp_trib
   or new.imp_op_ex         is distinct from old.imp_op_ex
   or new.imp_tot_conc      is distinct from old.imp_tot_conc
   or new.moneda            is distinct from old.moneda
   or new.cotizacion        is distinct from old.cotizacion
   or new.numero            is distinct from old.numero
   or new.punto_venta       is distinct from old.punto_venta
   or new.letter            is distinct from old.letter
   or new.kind              is distinct from old.kind
   or new.cbte_tipo_afip    is distinct from old.cbte_tipo_afip
   or new.fecha             is distinct from old.fecha
   or new.doc_tipo          is distinct from old.doc_tipo
   or new.doc_nro           is distinct from old.doc_nro
   or new.channel_id        is distinct from old.channel_id
   or new.client_id         is distinct from old.client_id
  then
    raise exception
      'Campos inmutables post-CAE (id=%): cae, importes, numeración, doc, fecha y receptor no se pueden modificar',
      old.id
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.check_invoice_immutability() is
  'M.0 — bloquea cambios a campos AFIP-críticos cuando invoice.status = emitted. Permite update solo de pdf_hash, pdf_url (deprecated), motivo_nc_nd, notified_at, etc.';

create trigger invoices_enforce_immutability_on_emitted
  before update on public.invoices
  for each row execute function public.check_invoice_immutability();

------------------------------------------------------------------------------
-- 3. Bucket invoices-pdf
------------------------------------------------------------------------------
-- Supabase no permite delete directo desde una migration SQL en
-- storage.objects/buckets (RLS + triggers internos). El borrado se hace
-- vía script Node usando la Storage API:
--
--   pnpm tsx scripts/cleanup-invoices-pdf-bucket.ts
--
-- Una vez ejecutado, el bucket queda vacío. Como el código actualizado
-- nunca más escribe ahí, queda inerte; se puede borrar manualmente
-- desde Supabase Studio sin riesgo.

------------------------------------------------------------------------------
-- 4. Dropear columna pdf_url
------------------------------------------------------------------------------
alter table public.invoices
  drop column if exists pdf_url;

set row_security = on;
