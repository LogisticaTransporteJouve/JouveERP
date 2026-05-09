-- E.6 fix — make `comprobantes.numero` nullable so drafts persist before
-- AFIP reserves a number.
--
-- The original check `numero >= 1` blocked the insert path: the server
-- creates the row with idempotency_key + items first, the Inngest workflow
-- later asks AFIP for `FECompUltimoAutorizado + 1` and updates the row.
-- Without a "not yet reserved" sentinel, the insert needs an AFIP roundtrip
-- which breaks idempotency on retry.
--
-- NULL semantics:
--   - numero IS NULL   → draft pending reservation
--   - numero >= 1      → reserved or emitted
--
-- The compound unique index (channel_id, punto_venta, kind, coalesce(letter, ''), numero)
-- continues to work because PG treats NULL as distinct in unique indexes,
-- so multiple drafts with numero=NULL don't collide. Once each draft gets a
-- real number, the uniqueness check kicks in normally.

alter table public.comprobantes
  drop constraint comprobantes_numero_check;

alter table public.comprobantes
  alter column numero drop not null;

alter table public.comprobantes
  add constraint comprobantes_numero_check
  check (numero is null or numero >= 1);
