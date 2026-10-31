SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Manual journal entries are fiscal-only (docs/plan-separacion-fiscal-interno.md,
-- PR C, decision D1): channel NULL ("fiscal general") or an active fiscal
-- channel, never an internal one, and never with source_* (only the
-- auto-posting triggers link an entry to a document).
--   * create_manual_journal_entry: the only path the app uses to post a manual
--     entry. create_journal_entry keeps its grant to authenticated until PR C2,
--     so code from before this migration (a rollback) still works.
--   * The owner/admin ALL policies on journal_entries / journal_entry_lines go:
--     no app path writes the journal with the user's client, every writer is a
--     SECURITY DEFINER function. TRUNCATE is revoked from anon/authenticated.
--   * journal_non_fiscal_entries(): diagnostic of entries already on a
--     non-fiscal channel, run by the owner from the SQL editor.

create or replace function public.create_manual_journal_entry(
  p_entry_date  date,
  p_description text,
  p_lines       jsonb,
  p_channel_id  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fiscal boolean;
  v_active boolean;
  v_lines  jsonb;
  v_count  int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear asientos contables' using errcode = '42501';
  end if;

  if p_channel_id is not null then
    select is_fiscal, is_active into v_fiscal, v_active
      from public.invoicing_channels where id = p_channel_id;
    if not found or not v_fiscal or not v_active then
      raise exception 'Un asiento manual va sin canal o en un canal fiscal activo'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  v_count := case when jsonb_typeof(p_lines) = 'array' then jsonb_array_length(p_lines) else 0 end;
  if v_count < 2 then
    raise exception 'Un asiento necesita al menos dos líneas'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Only account_id lines: a manual entry does not resolve system roles.
  select jsonb_agg(jsonb_build_object(
           'account_id', l ->> 'account_id',
           'debit', l -> 'debit',
           'credit', l -> 'credit',
           'description', l ->> 'description') order by ord)
    into v_lines
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  if exists (select 1 from jsonb_array_elements(v_lines) l where l ->> 'account_id' is null) then
    raise exception 'Cada línea del asiento necesita una cuenta'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- The accrual period is the entry date's month, as the app derived it before.
  return public.create_journal_entry(
    p_entry_date,
    to_char(p_entry_date, 'YYYY-MM'),
    p_description,
    v_lines,
    null,
    null,
    p_channel_id,
    false,
    null
  );
end;
$$;

revoke all on function public.create_manual_journal_entry(date, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_manual_journal_entry(date, text, jsonb, text) to authenticated, service_role;

drop policy if exists "Owners and admins can manage journal_entries" on public.journal_entries;
drop policy if exists "Owners and admins can manage journal_entry_lines" on public.journal_entry_lines;

revoke truncate on public.journal_entries from anon, authenticated;
revoke truncate on public.journal_entry_lines from anon, authenticated;

create or replace function public.journal_non_fiscal_entries()
returns table (
  entry_id     uuid,
  entry_date   date,
  channel_id   text,
  source_table text,
  source_id    uuid,
  description  text
)
language sql
stable
security definer
set search_path = ''
as $$
  select je.id, je.entry_date, je.channel_id, je.source_table, je.source_id, je.description
    from public.journal_entries je
    join public.invoicing_channels c on c.id = je.channel_id
   where not c.is_fiscal
   order by je.entry_date, je.id;
$$;

revoke all on function public.journal_non_fiscal_entries() from public, anon, authenticated;
