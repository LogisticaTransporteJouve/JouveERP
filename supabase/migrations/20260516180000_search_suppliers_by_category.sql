-- K.12 — Extender search_suppliers con filtro por categoría.
--
-- Drop+recreate porque agregar params cambia la firma de la función.

set row_security = off;

drop function if exists public.search_suppliers(text, boolean, int, int);

create function public.search_suppliers(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int     default 0,
  p_limit        int     default 50,
  p_category_id  uuid    default null
)
returns setof public.suppliers
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select s.*
  from public.suppliers s, q
  where (not p_only_active or s.is_active)
    and (p_category_id is null or s.category_id = p_category_id)
    and (
      q.needle = ''
      or lower(s.legal_name) like '%' || q.needle || '%'
      or lower(coalesce(s.display_name, '')) like '%' || q.needle || '%'
      or s.cuit like q.needle || '%'
      or lower(s.legal_name) % q.needle
      or lower(coalesce(s.display_name, '')) % q.needle
    )
  order by
    case when q.needle = '' then 0
         else greatest(
           similarity(lower(s.legal_name), q.needle),
           similarity(lower(coalesce(s.display_name, '')), q.needle)
         )
    end desc nulls last,
    s.legal_name asc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.search_suppliers(text, boolean, int, int, uuid) is
  'Fuzzy supplier search con filtro opcional por categoría. K.12.';

set row_security = on;
