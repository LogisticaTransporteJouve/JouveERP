SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Table privileges for the Data API roles, explicit instead of inherited.
-- Older Supabase images gave every new public table to anon, authenticated
-- and service_role through default privileges; current ones grant only
-- REFERENCES/TRIGGER/TRUNCATE, so on a fresh database (local, CI) the app
-- could not read user_roles. RLS, enabled on every public table, stays the
-- gate. anon gets nothing: no policy admits it, so a grant it still holds
-- from the old defaults only widens the surface.
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;

revoke select, insert, update, delete on all tables in schema public from anon;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;

-- A materialized view has no RLS: search_index is read only through the
-- search_global function, whose role map is the gate.
revoke all on public.search_index from anon, authenticated;
