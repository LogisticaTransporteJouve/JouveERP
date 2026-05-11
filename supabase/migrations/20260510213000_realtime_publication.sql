-- E.8 — Realtime publication setup.
--
-- Supabase realtime works by subscribing to logical replication events
-- from the `supabase_realtime` publication. Tables not in the publication
-- never emit `postgres_changes` events to clients.
--
-- We add only the parent / user-facing tables. Child tables (payment
-- lines, allocations, retentions, check_movements) are kept out of the
-- publication on purpose: every RPC that touches them also bumps the
-- parent's `updated_at`, which fires a parent UPDATE that's enough to
-- invalidate the relevant TanStack Query keys.
--
-- Postgres Changes channels respect the same RLS policies the table has,
-- so users only receive events for rows they can already SELECT.

alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.receipts;
alter publication supabase_realtime add table public.checks;
alter publication supabase_realtime add table public.transactions;
