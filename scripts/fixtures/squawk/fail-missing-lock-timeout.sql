-- squawk: require-lock-timeout
-- The rule fires on a statement that locks an existing table; a CREATE TABLE
-- alone would not trigger it.
SET LOCAL statement_timeout = '15min';

ALTER TABLE public.fixture_holdings ADD COLUMN note text;
