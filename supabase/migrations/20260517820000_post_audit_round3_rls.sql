-- Round 3 — RLS + permissions:
--
-- 1. journal_entries / journal_entry_lines / auto_journal_mapping:
--    SELECT estaba abierto a todos los authenticated. Drivers, ops y
--    warehouse veían el libro contable. Restringimos a accounting:read.
--
-- 2. search_global: la matview no aplica RLS. El RPC ahora filtra por
--    el rol del caller — entity_types los que el caller no puede leer
--    quedan fuera.

set row_security = off;

------------------------------------------------------------------------------
-- 1. RLS journal_entries — restringir a roles con accounting:read
------------------------------------------------------------------------------
-- Usamos user_has_role + lista hardcoded de roles que tienen accounting:read
-- (owner/admin/finance). El RBAC matrix vive en TS pero la regla a nivel DB
-- debe ser explícita.

drop policy if exists "Authenticated users can view journal_entries" on public.journal_entries;
drop policy if exists "Authenticated users can view journal_entry_lines" on public.journal_entry_lines;
drop policy if exists "Authenticated users can view auto_journal_mapping" on public.auto_journal_mapping;

create policy "Roles con accounting can view journal_entries"
  on public.journal_entries for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Roles con accounting can view journal_entry_lines"
  on public.journal_entry_lines for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Roles con accounting can view auto_journal_mapping"
  on public.auto_journal_mapping for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

------------------------------------------------------------------------------
-- 2. search_global: filtrar entity_types por permisos del caller
------------------------------------------------------------------------------
-- Reemplaza el search_global anterior (que devolvía todo a cualquier
-- authenticated). Ahora consulta user_roles del caller y excluye los
-- entity_types que no puede ver.
--
-- Mapping rol → entity_types permitidos (mirror del RBAC matrix TS):
--   owner / admin: todo
--   finance: todo
--   operations: client, supplier, invoice, transaction (sin compras)
--   warehouse: supplier, transaction (lo justo para warehouse ops)
--   driver: nada

create or replace function public.search_global(
  p_query text,
  p_limit int default 20
)
returns table (
  entity_type text,
  entity_id   text,
  title       text,
  subtitle    text,
  url         text,
  rank        real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('spanish', p_query) as tsq
  ),
  caller_roles as (
    select array_agg(role_id) as roles
      from public.user_roles
     where user_id = auth.uid()
  ),
  allowed_types as (
    select case
      when (select roles from caller_roles) && array['owner', 'admin', 'finance']
        then array['client', 'supplier', 'invoice', 'purchase_invoice',
                   'receipt', 'payment_order', 'transaction']
      when (select roles from caller_roles) && array['operations']
        then array['client', 'supplier', 'invoice', 'transaction']
      when (select roles from caller_roles) && array['warehouse']
        then array['supplier', 'transaction']
      else array[]::text[]
    end as types
  )
  select
    s.entity_type, s.entity_id, s.title, s.subtitle, s.url,
    ts_rank(s.tsv, q.tsq) as rank
  from public.search_index s, q, allowed_types a
  where s.tsv @@ q.tsq
    and s.entity_type = any (a.types)
  order by rank desc, s.title asc
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.search_global is
  'M.3 búsqueda global gated por permisos del caller. Roles sin accounting (driver) reciben array vacío de entity_types y por ende 0 hits.';

revoke all on function public.search_global from public;
grant execute on function public.search_global(text, int) to authenticated;

set row_security = on;
