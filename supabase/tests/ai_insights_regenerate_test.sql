-- Insight regeneration (20261104096000): regenerate_ai_insights swaps the
-- open and acknowledged cards of the replaced kinds in one transaction,
-- skips dismissed findings, keeps acknowledged ones acknowledged, leaves the
-- kinds it was not asked to replace alone, and a second run does not
-- duplicate anything (one live row per fingerprint). Service role only.
-- One transaction, rolled back.

begin;

select plan(12);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.ai_insights (kind, severity, title, finding, fingerprint, status) values
  ('cashflow', 'info', 'Caja vieja', 'x', null, 'open'),
  ('dup_invoice', 'warning', 'Dup A', 'x', 'dup_invoice:a', 'open'),
  ('dup_invoice', 'warning', 'Dup B', 'x', 'dup_invoice:b', 'acknowledged'),
  ('dup_invoice', 'warning', 'Dup C', 'x', 'dup_invoice:c', 'dismissed'),
  ('trip_margin', 'warning', 'Viajes', 'x', 'trip_margin:t', 'open');

create temp table regen_rows as
select $$[
  {"kind":"cashflow","severity":"info","title":"Caja nueva","finding":"y","metrics":{},"source_refs":[],"proposal":null,"fingerprint":null},
  {"kind":"dup_invoice","severity":"warning","title":"Dup A","finding":"y","metrics":{},"source_refs":["a"],"proposal":null,"fingerprint":"dup_invoice:a"},
  {"kind":"dup_invoice","severity":"warning","title":"Dup B","finding":"y","metrics":{},"source_refs":["b"],"proposal":null,"fingerprint":"dup_invoice:b"},
  {"kind":"dup_invoice","severity":"warning","title":"Dup C","finding":"y","metrics":{},"source_refs":["c"],"proposal":null,"fingerprint":"dup_invoice:c"},
  {"kind":"dup_invoice","severity":"warning","title":"Dup A otra vez","finding":"y","metrics":{},"source_refs":["a"],"proposal":null,"fingerprint":"dup_invoice:a"}
]$$::jsonb as rows;

-- 1. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.regenerate_ai_insights(text[], jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.regenerate_ai_insights(text[], jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.regenerate_ai_insights(text[], jsonb)', 'execute'),
  'only the service role runs the regeneration'
);

-- 2. First run ----------------------------------------------------------------------

create temp table first_run as
select public.regenerate_ai_insights(array['cashflow', 'dup_invoice'], rows) as n
from regen_rows;

select is(
  (select n from first_run), 3,
  'inserts the new set, minus the dismissed finding and the repeated one'
);

select is(
  (select array_agg(title order by title) from public.ai_insights where kind = 'cashflow'),
  array['Caja nueva'],
  'the previous aggregate card is replaced'
);

select is(
  (select status from public.ai_insights
    where fingerprint = 'dup_invoice:b' and status <> 'dismissed'),
  'acknowledged',
  'a finding someone acknowledged comes back acknowledged'
);

select is(
  (select status from public.ai_insights where fingerprint = 'dup_invoice:a'),
  'open',
  'a new finding comes back open'
);

select is(
  (select count(*)::int from public.ai_insights where fingerprint = 'dup_invoice:c'),
  1,
  'a dismissed finding is not raised again'
);

select is(
  (select title from public.ai_insights where kind = 'trip_margin'),
  'Viajes',
  'a kind not being replaced (its reads failed) keeps its card'
);

-- 3. Second run: nothing duplicates -----------------------------------------------

create temp table second_run as
select public.regenerate_ai_insights(array['cashflow', 'dup_invoice'], rows) as n
from regen_rows;

select is(
  (select count(*)::int from public.ai_insights
    where kind in ('cashflow', 'dup_invoice') and status in ('open', 'acknowledged')),
  3,
  'a second run replaces the cards instead of adding to them'
);

select is(
  (select status from public.ai_insights
    where fingerprint = 'dup_invoice:b' and status <> 'dismissed'),
  'acknowledged',
  'the acknowledgement survives a second run'
);

-- 4. Refusals ---------------------------------------------------------------------

select throws_ok(
  $$select public.regenerate_ai_insights(
      array['cashflow'],
      '[{"kind":"trip_margin","severity":"info","title":"t","finding":"f","fingerprint":"trip_margin:u"}]'::jsonb)$$,
  '22023',
  null,
  'a row of a kind that is not being replaced is refused'
);

select throws_ok(
  $$insert into public.ai_insights (kind, severity, title, finding, fingerprint, status)
    values ('dup_invoice', 'warning', 'Dup A', 'x', 'dup_invoice:a', 'open')$$,
  '23505',
  null,
  'one live row per fingerprint'
);

select lives_ok(
  $$insert into public.ai_insights (kind, severity, title, finding, fingerprint, status)
    values ('dup_invoice', 'warning', 'Dup A', 'x', 'dup_invoice:a', 'dismissed')$$,
  'a dismissed copy of a live finding is allowed'
);

select * from finish(true);

rollback;
