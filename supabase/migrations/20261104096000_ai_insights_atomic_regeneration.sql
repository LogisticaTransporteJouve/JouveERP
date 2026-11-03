SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Insight regeneration in one transaction (audit w1-s5 F9).
--
-- The analyst (weekly cron and the manual "Recalcular") used to delete its
-- open and acknowledged rows and then insert the new set in two requests.
-- Two runs interleaved (A.delete, B.delete, A.insert, B.insert) published
-- every card twice, and an insert that failed after the delete left the
-- panel empty and lost every acknowledgement until the next run.
--
-- 1. Existing duplicates (same fingerprint, open or acknowledged) collapse to
--    one row: the acknowledged one first, then the newest. A proposal that
--    pointed at a removed copy keeps its row (insight_id goes to null, which
--    guard_ai_proposal allows).
-- 2. ai_insights_live_fingerprint_idx: one open or acknowledged row per
--    fingerprint.
-- 3. regenerate_ai_insights(p_kinds, p_rows): under an advisory lock,
--    deletes the open and acknowledged rows of p_kinds and inserts p_rows in
--    the same transaction. A row whose fingerprint has a dismissed row is
--    skipped; one whose fingerprint was acknowledged in a deleted row comes
--    back acknowledged (read from the deleted rows themselves, so an
--    acknowledgement committed while the run waited is kept). Returns how
--    many rows it inserted. Service role only (the analyst).
--
-- Rollback: older code deletes and inserts with the service client; the
-- unique index makes a concurrent pair of old runs fail its insert instead
-- of duplicating the cards (the next run republishes them).

------------------------------------------------------------------------------
-- 1. Collapse duplicates
------------------------------------------------------------------------------

with ranked as (
  select
    id,
    row_number() over (
      partition by fingerprint
      order by (status = 'acknowledged') desc, generated_at desc, id
    ) as rn
  from public.ai_insights
  where fingerprint is not null
    and status in ('open', 'acknowledged')
)
delete from public.ai_insights i
using ranked r
where i.id = r.id
  and r.rn > 1;

------------------------------------------------------------------------------
-- 2. One live row per fingerprint
------------------------------------------------------------------------------

-- squawk-ignore require-concurrent-index-creation
create unique index ai_insights_live_fingerprint_idx
  on public.ai_insights (fingerprint)
  where fingerprint is not null and status in ('open', 'acknowledged');

------------------------------------------------------------------------------
-- 3. regenerate_ai_insights
------------------------------------------------------------------------------

create function public.regenerate_ai_insights(p_kinds text[], p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acknowledged text[];
  v_count integer;
begin
  if p_kinds is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'regenerate_ai_insights: p_kinds and a JSON array of rows are required'
      using errcode = '22023';
  end if;
  -- A row of a kind that is not being replaced would sit next to its
  -- previous card (the kinds whose reads failed keep theirs).
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as r(value)
    where not coalesce((r.value ->> 'kind') = any (p_kinds), false)
  ) then
    raise exception 'regenerate_ai_insights: every row must be of a replaced kind'
      using errcode = '22023';
  end if;

  -- One regeneration at a time: a second run waits and then replaces the
  -- first one's rows.
  perform pg_advisory_xact_lock(hashtextextended('public.regenerate_ai_insights', 0));

  with removed as (
    delete from public.ai_insights
    where kind = any (p_kinds)
      and status in ('open', 'acknowledged')
    returning fingerprint, status
  )
  select coalesce(
           array_agg(fingerprint) filter (
             where status = 'acknowledged' and fingerprint is not null
           ),
           '{}'::text[]
         )
    into v_acknowledged
  from removed;

  insert into public.ai_insights
    (kind, severity, title, finding, metrics, source_refs, proposal, fingerprint, status)
  select
    r.kind,
    r.severity,
    r.title,
    r.finding,
    coalesce(r.metrics, '{}'::jsonb),
    coalesce(r.source_refs, '[]'::jsonb),
    r.proposal,
    r.fingerprint,
    case when r.fingerprint = any (v_acknowledged) then 'acknowledged' else 'open' end
  from jsonb_to_recordset(p_rows) as r(
    kind text,
    severity text,
    title text,
    finding text,
    metrics jsonb,
    source_refs jsonb,
    proposal jsonb,
    fingerprint text
  )
  where r.fingerprint is null
     or not exists (
       select 1
       from public.ai_insights d
       where d.status = 'dismissed'
         and d.fingerprint = r.fingerprint
     )
  on conflict (fingerprint)
    where fingerprint is not null and status in ('open', 'acknowledged')
    do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.regenerate_ai_insights(text[], jsonb) is
  'Reemplaza las tarjetas abiertas o vistas de los kinds del analyst por las nuevas, en una transacción y de a una corrida (advisory lock). Saltea las descartadas y mantiene vistas las que ya lo estaban (por fingerprint). Solo service role.';

revoke all on function public.regenerate_ai_insights(text[], jsonb) from public, anon, authenticated;
grant execute on function public.regenerate_ai_insights(text[], jsonb) to service_role;
