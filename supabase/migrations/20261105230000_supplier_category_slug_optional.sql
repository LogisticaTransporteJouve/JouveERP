SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The supplier category slug is no longer read or written by the app (the
-- owner asked to remove it everywhere). The column stays, nullable, so code
-- from before this change keeps working after a rollback; dropping it is a
-- later step (docs/pendientes/2026-11-05-supplier-category-slug-drop.md).
alter table public.supplier_categories
  alter column slug drop not null;

comment on column public.supplier_categories.slug is
  'Deprecated: not used by the app since 2026-11-05. Nullable until dropped.';
