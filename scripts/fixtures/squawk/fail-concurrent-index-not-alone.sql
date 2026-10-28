-- squawk: ban-concurrent-index-creation-in-transaction
-- Two statements: `db push` commits the SET before the concurrent build, so the
-- file does not apply all-or-nothing (.squawk.toml). It also trips the
-- timeout and robustness rules; the test pins the transaction one.
SET LOCAL lock_timeout = '5s';

CREATE INDEX CONCURRENTLY fixture_holdings_user_id_idx ON public.fixture_holdings (user_id, id);
