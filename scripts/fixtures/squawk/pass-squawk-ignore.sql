-- The per-statement exemption, in the form .squawk.toml asks for: the reason,
-- then the rule on the line right above the statement it covers (squawk only
-- reads the comment directly before the statement).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- fixture_holdings stays under a few hundred rows, so the build holds its lock
-- for milliseconds.
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX fixture_holdings_note_idx ON public.fixture_holdings (note);
