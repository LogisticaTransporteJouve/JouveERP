-- Regression invariants of the fiscal/internal separation that hold on main
-- today. The third one in the plan (every document entry matches build_*)
-- waits for the build_* of every origin (PR D). One transaction, rolled back.

begin;

select plan(3);

select is(
  (select count(*)::int from public.journal_non_fiscal_entries()),
  0,
  'no journal entry is on a non-fiscal channel'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('journal_entries', 'journal_entry_lines')
      and cmd <> 'SELECT'),
  0,
  'no policy lets authenticated write the journal directly'
);

-- create_journal_entry keeps its grant until PR C2; trigger functions cannot
-- be called outside a trigger.
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname ~ '(journal|_lines$)'
      and p.prorettype <> 'trigger'::regtype
      and p.proname not in ('create_journal_entry', 'create_manual_journal_entry')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  '{}'::text[],
  'authenticated cannot run the internal journal functions'
);

select * from finish();

rollback;
