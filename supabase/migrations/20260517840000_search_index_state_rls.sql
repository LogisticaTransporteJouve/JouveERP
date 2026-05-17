-- Round 4 — RLS sobre search_index_state
--
-- La tabla singleton search_index_state fue creada en
-- 20260517810000_post_audit_round2_bloqueantes.sql sin RLS habilitada.
-- Aunque sólo expone un boolean (dirty) + timestamp, dejarla abierta a
-- todos los authenticated permitiría leakage del estado interno del worker
-- de refresh y, peor, el UPDATE directo desde el cliente.
--
-- El cron worker accede vía refresh_search_index_if_dirty() que es
-- security definer, así que no necesita policies. Habilitamos RLS y NO
-- creamos policies → bloqueo total para roles authenticated/anon.

set row_security = off;

alter table public.search_index_state enable row level security;

-- Sin policies = nadie excepto el rol service_role (que bypassa RLS) y
-- funciones security definer pueden leer/escribir. Es lo que queremos.

comment on table public.search_index_state is
  'Singleton interno del worker de refresh de search_index. RLS bloquea acceso directo; solo accesible vía refresh_search_index_if_dirty().';
