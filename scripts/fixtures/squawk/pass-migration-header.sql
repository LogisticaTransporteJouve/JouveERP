-- The header every new migration starts with (CLAUDE.md points here): both
-- timeouts before any other statement. An index on a table the same file
-- creates needs no CONCURRENTLY: the table is empty and nothing reads it yet.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE public.fixture_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fixture_runs IS 'Fixture. Never applied.';

CREATE INDEX fixture_runs_user_id_idx ON public.fixture_runs (user_id, ran_at DESC);
