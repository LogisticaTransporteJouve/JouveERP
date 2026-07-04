-- Restore the RPC hardening convention on get_account_balances. The
-- 20260701120000 migration dropped the old (text, text) function and recreated
-- it with a 3rd cost-center arg, but a freshly created function does NOT inherit
-- the old grants — Postgres left EXECUTE granted to PUBLIC (its default). Every
-- other RPC in the project pairs revoke-public + grant-authenticated; apply it
-- here too. (Not a live leak — the function is security-invoker and journal RLS
-- only grants SELECT to authenticated — but it diverges from the convention.)

revoke all on function public.get_account_balances(text, text, uuid) from public;
grant execute on function public.get_account_balances(text, text, uuid) to authenticated;

-- Same gap on get_exchange_rate (added in 20260701130000, multicurrency): it
-- was created without the revoke-public, so PUBLIC has EXECUTE. Harden it too.
revoke all on function public.get_exchange_rate(text, date) from public;
grant execute on function public.get_exchange_rate(text, date) to authenticated;
