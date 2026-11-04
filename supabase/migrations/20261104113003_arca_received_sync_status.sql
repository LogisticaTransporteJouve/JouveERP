SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- How the last «Recibidos de ARCA» run went, so the tray can show that a
-- requested run started, how it ended, or that it never started. Written by
-- the service role only (the request action and the Inngest job); owner and
-- admin read it through the row's existing select policy, and the tray reads
-- it from a server action gated by purchase_invoices:write.
--
-- Nullable columns with no default: no rewrite, and code from before this
-- migration ignores them.

alter table public.arca_web_account
  add column sync_requested_at timestamptz,
  add column sync_started_at   timestamptz,
  add column sync_finished_at  timestamptz,
  add column sync_result       jsonb;

comment on column public.arca_web_account.sync_result is
  'ReceivedSyncResult of the last run (lib/afip/received-sync.ts): outcome, counts, failed months or the sign-in error code. Never the clave.';
