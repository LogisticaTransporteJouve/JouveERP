SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.11: the fiscal_reader (contador) sees the manual journal entries
-- without channel.
--
-- A manual entry goes without channel or in an active fiscal channel
-- (create_manual_journal_entry, D1): without channel it is a "fiscal
-- general" entry, part of the fiscal books. The fiscal_reader policies
-- required is_channel_fiscal(channel_id), which is null for a NULL channel,
-- so the accountant's libro diario and mayor left those entries out. Entries
-- of an internal channel stay hidden.

drop policy if exists "fiscal_reader select fiscal" on public.journal_entries;
create policy "fiscal_reader select fiscal" on public.journal_entries
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and (channel_id is null or public.is_channel_fiscal(channel_id))
  );

drop policy if exists "fiscal_reader select fiscal" on public.journal_entry_lines;
create policy "fiscal_reader select fiscal" on public.journal_entry_lines
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and exists (
      select 1 from public.journal_entries je
       where je.id = journal_entry_lines.journal_entry_id
         and (je.channel_id is null or public.is_channel_fiscal(je.channel_id))
    )
  );
