-- squawk: require-concurrent-index-creation
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE INDEX fixture_holdings_user_id_idx ON public.fixture_holdings (user_id);
