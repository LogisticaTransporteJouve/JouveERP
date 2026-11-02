-- fiscal_reader: a journal entry without channel ("fiscal general" manual
-- entry) is visible with its lines; one of an internal channel stays hidden.
-- One transaction, rolled back.

begin;

select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000087fa', 'contador@fiscal-reader-null.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000087fa', 'fiscal_reader');

insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000000087a1', '91', 'Debe contador', 1, 'activo'),
  ('00000000-0000-0000-0000-0000000087a2', '92', 'Haber contador', 1, 'pasivo');

-- Written as the test owner: the journal is not writable by authenticated.
insert into public.journal_entries (id, entry_date, accrual_period, description, channel_id) values
  ('00000000-0000-0000-0000-0000000087e1', '2026-10-15', '2026-10', 'Manual sin canal', null),
  ('00000000-0000-0000-0000-0000000087e2', '2026-10-15', '2026-10', 'Interno', 'jouve_internal');
insert into public.journal_entry_lines (journal_entry_id, chart_of_accounts_id, debit, credit) values
  ('00000000-0000-0000-0000-0000000087e1', '00000000-0000-0000-0000-0000000087a1', 100, 0),
  ('00000000-0000-0000-0000-0000000087e1', '00000000-0000-0000-0000-0000000087a2', 0, 100),
  ('00000000-0000-0000-0000-0000000087e2', '00000000-0000-0000-0000-0000000087a1', 50, 0),
  ('00000000-0000-0000-0000-0000000087e2', '00000000-0000-0000-0000-0000000087a2', 0, 50);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000087fa","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.journal_entries
    where id = '00000000-0000-0000-0000-0000000087e1'),
  1, 'a fiscal_reader reads a manual entry without channel');
select is(
  (select count(*)::int from public.journal_entry_lines
    where journal_entry_id = '00000000-0000-0000-0000-0000000087e1'),
  2, 'and its lines');
select is(
  (select count(*)::int from public.journal_entries
    where id = '00000000-0000-0000-0000-0000000087e2'),
  0, 'an entry of an internal channel stays hidden');
select is(
  (select count(*)::int from public.journal_entry_lines
    where journal_entry_id = '00000000-0000-0000-0000-0000000087e2'),
  0, 'and so do its lines');

select * from finish();
rollback;
