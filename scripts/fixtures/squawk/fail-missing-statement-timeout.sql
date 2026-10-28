-- squawk: require-statement-timeout
-- The header's other half; like require-lock-timeout, it fires on a statement
-- that locks an existing table.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.fixture_holdings ADD COLUMN note text;
