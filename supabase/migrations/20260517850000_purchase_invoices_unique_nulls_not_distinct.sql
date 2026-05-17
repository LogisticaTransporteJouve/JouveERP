-- Fix purchase_invoices unique constraint para que sea inferible vía
-- PostgREST `onConflict` (seeds + upserts).
--
-- Contexto:
--   Migration 20260517810000 reemplazó la UNIQUE CONSTRAINT por una
--   UNIQUE INDEX con expresión `coalesce(letter::text, '')` para tratar
--   NULL == NULL (evitar dups de NCs con letter NULL). Funciona a nivel
--   DB, pero PostgREST no puede inferir el constraint cuando la indexed
--   column es una expresión: el seed falla con "no unique or exclusion
--   constraint matching the ON CONFLICT specification".
--
-- Fix:
--   PG 15+ tiene `NULLS NOT DISTINCT` en UNIQUE CONSTRAINT. Reemplazamos
--   el index-expresión por un constraint real con esa cláusula. Mantiene
--   la misma semántica (NULL == NULL) y vuelve a ser referenciable.

drop index if exists public.purchase_invoices_unique_supplier_numero_idx;

alter table public.purchase_invoices
  add constraint purchase_invoices_unique_supplier_numero
  unique nulls not distinct (supplier_id, kind, letter, punto_venta, numero);
