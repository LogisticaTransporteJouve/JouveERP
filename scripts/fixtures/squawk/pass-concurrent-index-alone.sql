-- A concurrent index build, alone in its file so the migration still applies
-- all-or-nothing (.squawk.toml).
--
-- The exemptions:
--   require-lock-timeout / require-statement-timeout: the header's `SET`s would
--     be other statements beside the build.
--   prefer-robust-stmts: `IF NOT EXISTS` would silently adopt an INVALID index
--     left by a failed build instead of failing loudly.
-- squawk-ignore require-lock-timeout, require-statement-timeout, prefer-robust-stmts
CREATE INDEX CONCURRENTLY fixture_holdings_user_id_idx ON public.fixture_holdings (user_id, id);
