-- The SET LOCAL header in front of a statement that locks an existing table,
-- where squawk's timeout rules fire: proves squawk counts `SET LOCAL` as the
-- timeouts (a bare SET outlives the migration under `db push`, see
-- .github/scripts/check-migration-set-local.mjs).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE public.fixture_holdings ADD COLUMN note text;
