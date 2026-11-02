SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.2 + 0.3: a fiscal comprobante never reaches AFIP with a fecha in a
-- closed accounting period, and a voucher AFIP already authorized is never
-- lost because its journal entry cannot be posted.
--
--   1. guard_invoice_period_closed: a fiscal draft (or its draft→emitting
--      flip) dated in a closed period is refused before any AFIP call.
--   2. pending_journal_entries: the entries an authorized voucher could not
--      post, keyed like emit_journal / repost_journal (source_table, source_id).
--   3. emit_journal_or_record: the →emitted transition of a voucher with a CAE
--      (or CAEA) no longer aborts when its entry fails; the failure is recorded.
--      Before this, persist-cae raised 55006, the run failed and the invoice
--      was marked failed with its CAE at AFIP. Other writes keep aborting.
--   4. post_pending_journals: posts the pending entries of open periods; the
--      reopen action calls it for the reopened period.

-- 1. No fiscal draft or emission in a closed period ----------------------------

create or replace function public.guard_invoice_period_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(new.fecha, 'YYYY-MM');
begin
  if new.status in ('draft', 'emitting')
     and new.cae is null
     and public.is_channel_fiscal(new.channel_id)
     and exists (select 1 from public.accounting_closed_periods where period = v_period) then
    raise exception 'El período contable % está cerrado: usá una fecha de un período abierto o pedí que lo reabran en Contabilidad.', v_period
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoice_period_closed() from public, anon, authenticated;

create trigger invoices_guard_period_closed
  before insert or update of status, fecha, channel_id on public.invoices
  for each row execute function public.guard_invoice_period_closed();

-- 2. Pending entries -------------------------------------------------------------

create table public.pending_journal_entries (
  source_table   text not null check (source_table in ('invoices')),
  source_id      uuid not null,
  accrual_period text not null check (accrual_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- SQLSTATE only: error messages can carry amounts.
  error_code     text not null,
  created_at     timestamptz not null default now(),
  last_try_at    timestamptz not null default now(),
  primary key (source_table, source_id)
);

comment on table public.pending_journal_entries is
  'Entries an AFIP-authorized document could not post (closed period, missing chart-of-accounts role). Posted by post_pending_journals.';

create index pending_journal_entries_period_idx
  on public.pending_journal_entries (accrual_period, last_try_at);

alter table public.pending_journal_entries enable row level security;

revoke all on table public.pending_journal_entries from public, anon, authenticated;
grant select on table public.pending_journal_entries to authenticated;
grant all on table public.pending_journal_entries to service_role;

create policy "accounting roles read pending journal entries"
  on public.pending_journal_entries for select to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance']))
    or (
      (select public.user_has_role(array['fiscal_reader']))
      and exists (
        select 1 from public.invoices i
         where pending_journal_entries.source_table = 'invoices'
           and i.id = pending_journal_entries.source_id
           and public.is_channel_fiscal(i.channel_id)
      )
    )
  );

-- 3. Record instead of abort for authorized vouchers ----------------------------

create or replace function public.emit_journal_or_record(
  p_source text,
  p_id     uuid,
  p_period text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_code  text;
begin
  begin
    v_entry := public.emit_journal(p_source, p_id);
    -- emit_journal swallows a missing chart-of-accounts role (P0002) and
    -- returns null; null is also "nothing to post" (internal, zero total).
    if v_entry is null and public.journal_entry_status(p_source, p_id) = 'missing' then
      v_code := 'P0002';
    end if;
  exception
    when serialization_failure or deadlock_detected or lock_not_available then
      raise;
    when others then
      v_code := sqlstate;
  end;

  if v_code is not null then
    raise warning 'pending_journal_entry % % code=%', p_source, p_id, v_code;
    insert into public.pending_journal_entries (source_table, source_id, accrual_period, error_code)
    values (p_source, p_id, p_period, v_code)
    on conflict (source_table, source_id)
      do update set error_code = excluded.error_code, last_try_at = now();
  end if;
end;
$$;

revoke all on function public.emit_journal_or_record(text, uuid, text) from public, anon, authenticated;

-- Latest body: 20261031180534_journal_reverse_repost.sql (invoices_after_update_journal).
create or replace function public.invoices_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'emitted' and new.status = 'emitted' and new.cae is not null then
    -- AFIP already authorized it: the voucher must be saved even if its entry
    -- cannot be posted now (closed period, missing account).
    -- LEAVE + NOTE: the period mirrors journal_expected_entry (fecha month);
    -- it changes only if invoices gain an accrual override.
    perform public.emit_journal_or_record('invoices', new.id, to_char(new.fecha, 'YYYY-MM'));
  elsif old.status <> 'emitted' and new.status = 'emitted' then
    perform public.emit_journal('invoices', new.id);
  elsif old.status = 'emitted' and new.status = 'cancelled' then
    perform public.reverse_journal_entry(e.id)
       from public.current_journal_entries('invoices', new.id) as e(id);
  end if;
  return new;
end;
$$;

revoke all on function public.invoices_after_update_journal() from public, anon, authenticated;

-- 4. Post pending entries of open periods ----------------------------------------

create or replace function public.post_pending_journals(
  p_period text default null,
  p_limit  integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  v_status  text;
  v_posted  integer := 0;
  v_cleared integer := 0;
  v_failed  integer := 0;
begin
  -- No role check: granted to service_role only; callers gate with userCan.
  for r in
    select p.source_table, p.source_id
      from public.pending_journal_entries p
     where (p_period is null or p.accrual_period = p_period)
       and not exists (
         select 1 from public.accounting_closed_periods c where c.period = p.accrual_period
       )
     order by p.last_try_at, p.source_id
     limit p_limit
     for update skip locked
  loop
    begin
      v_status := public.journal_entry_status(r.source_table, r.source_id);
      if v_status = 'missing' then
        perform public.emit_journal(r.source_table, r.source_id);
        v_status := public.journal_entry_status(r.source_table, r.source_id);
        if v_status = 'match' then
          v_posted := v_posted + 1;
        end if;
      elsif v_status in ('match', 'none', 'not_live') then
        v_cleared := v_cleared + 1;
      end if;

      if v_status in ('match', 'none', 'not_live') then
        delete from public.pending_journal_entries
         where source_table = r.source_table and source_id = r.source_id;
      else
        v_failed := v_failed + 1;
        update public.pending_journal_entries
           set error_code = case when v_status = 'missing' then 'P0002' else 'differs' end,
               last_try_at = now()
         where source_table = r.source_table and source_id = r.source_id;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      update public.pending_journal_entries
         set error_code = sqlstate, last_try_at = now()
       where source_table = r.source_table and source_id = r.source_id;
    end;
  end loop;

  return jsonb_build_object(
    'posted', v_posted,
    'cleared', v_cleared,
    'failed', v_failed,
    'remaining_open', (
      select count(*) from public.pending_journal_entries p
       where not exists (
         select 1 from public.accounting_closed_periods c where c.period = p.accrual_period
       )
    )
  );
end;
$$;

revoke all on function public.post_pending_journals(text, integer) from public, anon, authenticated;
grant execute on function public.post_pending_journals(text, integer) to service_role;
