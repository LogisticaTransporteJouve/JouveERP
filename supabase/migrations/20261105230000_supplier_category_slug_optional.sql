SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The supplier category slug is no longer read or written by the app (the
-- owner asked to remove it everywhere). The column stays, with a generated
-- default, so a category created without it is valid and code from before
-- this change keeps working after a rollback; dropping it is a later step
-- (docs/pendientes/2026-11-05-supplier-category-slug-drop.md). The default
-- ('c_' + 32 hex chars) passes supplier_categories_slug_format and is unique.
alter table public.supplier_categories
  alter column slug set default ('c_' || replace(gen_random_uuid()::text, '-', ''));

comment on column public.supplier_categories.slug is
  'Deprecated: not used by the app since 2026-11-05. Filled by its default until dropped.';
