-- Audit remediation T1a — security lockdown (no behavior change for legit flows).
--
-- Supabase grants EXECUTE to anon+authenticated by default; `revoke ... from
-- public` does NOT remove it, so many SECURITY DEFINER functions were callable
-- via PostgREST /rpc/* by any authenticated user (ledger forgery, invoice
-- renumbering, HR balance rewrites, rate-limit resets). PostgREST exposes the
-- `public` schema (supabase/config.toml), so this is remotely exploitable with
-- the public anon key.
--
-- Fix strategy:
--   * Functions invoked ONLY via the service-role client (crons/actions) or
--     internally by triggers -> revoke EXECUTE from anon/authenticated. Triggers
--     and definer-internal calls run as the function owner and are unaffected.
--   * Functions still called via the RLS user client that read auth.uid()
--     internally (create_journal_entry, grant_vacation_balances) -> keep EXECUTE
--     but add an internal role guard. The guard skips when auth.uid() is null
--     (service-role crons) and rejects authenticated callers lacking the role.
--     All legitimate authenticated callers (manual journal action, HR admin
--     action, and the auto-posting triggers driven by finance/owner/admin
--     writers) satisfy the guard.
--   * security_invoker on 5 views that leaked HR/payroll data past RLS.
--   * user_roles writes service-role-only (closes admin -> owner self-promotion).

set row_security = off;

------------------------------------------------------------------------------
-- 1. Revoke EXECUTE on service/trigger-only privileged functions
------------------------------------------------------------------------------

do $$
declare
  fn text;
  fns text[] := array[
    'apply_vacation_delta',
    'generate_journal_for_transaction',
    'emit_journal_for_invoice',
    'emit_journal_for_receipt',
    'emit_journal_for_payment_order',
    'emit_journal_for_purchase_invoice',
    'emit_journal_for_endorsed_check_rejected',
    'emit_journal_for_issued_check_transition',
    'build_invoice_journal_lines',
    'build_purchase_invoice_journal_lines',
    'next_internal_invoice_numero_atomic',
    'next_internal_purchase_numero',
    'bump_rate_limit_bucket',
    'refresh_search_index',
    'refresh_search_index_if_dirty',
    'cleanup_padron_cache',
    'cleanup_rate_limit_buckets',
    'find_orphan_files'
  ];
  sig text;
begin
  foreach fn in array fns loop
    for sig in
      select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
    loop
      -- Revoke from PUBLIC too: functions created without an explicit revoke
      -- carry a PUBLIC grant that authenticated/anon inherit. Explicit
      -- service_role grants (crons) are on the role directly and survive.
      execute format('revoke execute on function %s from public, anon, authenticated;', sig);
    end loop;
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- 2. create_journal_entry — internal role guard (keeps EXECUTE for auth)
------------------------------------------------------------------------------
-- Body identical to 20260516215000_journal_create_entry_fix.sql plus the guard.

create or replace function public.create_journal_entry(
  p_entry_date       date,
  p_accrual_period   text,
  p_description      text,
  p_lines            jsonb,
  p_source_table     text default null,
  p_source_id        uuid default null,
  p_channel_id       text default null,
  p_is_reversal      boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line     jsonb;
  v_account_id uuid;
  v_role     text;
  v_sort     int := 0;
begin
  -- Audit T1: reject direct PostgREST calls by unauthorized roles. Allow the
  -- service role (Inngest crons/actions) and authenticated finance/owner/admin
  -- (manual action + auto-posting triggers). anon and under-privileged
  -- authenticated callers are blocked. Checking the JWT role (not auth.uid())
  -- is required because anon also has a null auth.uid().
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear asientos contables'
      using errcode = '42501';
  end if;

  -- Reset al modo DEFERRED al inicio (ver 20260516215000).
  set constraints public.jel_enforce_balance deferred;

  insert into public.journal_entries (
    entry_date, accrual_period, description,
    source_table, source_id, channel_id,
    created_by, is_reversal, reversed_entry_id
  )
  values (
    p_entry_date, p_accrual_period, p_description,
    p_source_table, p_source_id, p_channel_id,
    auth.uid(), p_is_reversal, p_reversed_entry_id
  )
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if v_line ? 'account_id' and v_line->>'account_id' is not null then
      v_account_id := (v_line->>'account_id')::uuid;
    elsif v_line ? 'system_role' and v_line->>'system_role' is not null then
      v_role := v_line->>'system_role';
      v_account_id := public.find_account_by_role(v_role::public.coa_system_role);
      if v_account_id is null then
        raise exception 'No hay cuenta activa asignada al rol "%" del plan de cuentas', v_role
          using errcode = 'P0002';
      end if;
    else
      raise exception 'Cada línea debe traer account_id o system_role'
        using errcode = '22023';
    end if;

    insert into public.journal_entry_lines (
      journal_entry_id, chart_of_accounts_id,
      debit, credit, description, sort_order
    )
    values (
      v_entry_id, v_account_id,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'description',
      v_sort
    );

    v_sort := v_sort + 1;
  end loop;

  set constraints public.jel_enforce_balance immediate;

  return v_entry_id;
end;
$$;

------------------------------------------------------------------------------
-- 3. grant_vacation_balances — internal role guard (keeps EXECUTE for auth)
------------------------------------------------------------------------------
-- Body identical to 20260517130000_vacations.sql plus the guard.

create or replace function public.grant_vacation_balances(
  p_target_year int default extract(year from now())::int,
  p_carryover   boolean default true
)
returns table (employee_id uuid, balance_id uuid, entitled_days int, carryover_days int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp           record;
  v_anios         int;
  v_entitled      int;
  v_prev_balance  record;
  v_carry         int;
  v_balance_id    uuid;
  v_granted_at    date := make_date(p_target_year, 10, 1);
  v_expires_at    date := make_date(p_target_year + 1, 4, 30);
  v_dec31         date := make_date(p_target_year, 12, 31);
begin
  -- Audit T1: allow the service-role cron and authenticated owner/admin (the HR
  -- admin action); block anon and everyone else. See create_journal_entry note.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin']) then
    raise exception 'No autorizado para otorgar balances de vacaciones'
      using errcode = '42501';
  end if;

  update public.employee_vacation_balances
     set status = 'expired'
   where status = 'active'
     and expires_at < current_date;

  for v_emp in
    select id, hire_date
    from public.employees
    where is_active = true
  loop
    if exists (
      select 1 from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year
    ) then
      continue;
    end if;

    v_anios := extract(year from age(v_dec31, v_emp.hire_date))::int;

    if v_emp.hire_date > make_date(p_target_year, 7, 1) then
      v_entitled := greatest(0, ((v_dec31 - v_emp.hire_date) / 20)::int);
    elsif v_anios < 5 then
      v_entitled := 14;
    elsif v_anios < 10 then
      v_entitled := 21;
    elsif v_anios < 20 then
      v_entitled := 28;
    else
      v_entitled := 35;
    end if;

    v_carry := 0;
    if p_carryover then
      select id,
             (entitled_days + bonus_days + carryover_days - used_days) as remaining
        into v_prev_balance
      from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year - 1
      order by period_year desc
      limit 1;

      if found and v_prev_balance.remaining > 0 then
        v_carry := v_prev_balance.remaining;
      end if;
    end if;

    insert into public.employee_vacation_balances (
      employee_id, period_year, entitled_days, carryover_days,
      granted_at, expires_at, status, created_by
    )
    values (
      v_emp.id, p_target_year, v_entitled, v_carry,
      v_granted_at, v_expires_at, 'active', auth.uid()
    )
    returning id into v_balance_id;

    employee_id    := v_emp.id;
    balance_id     := v_balance_id;
    entitled_days  := v_entitled;
    carryover_days := v_carry;
    return next;
  end loop;
end;
$$;

-- Lock the two guarded functions to authenticated + service_role. The internal
-- guard enforces role authorization; anon has no roles and is blocked anyway,
-- but revoking is defense in depth.
revoke execute on function public.create_journal_entry(date, text, text, jsonb, text, uuid, text, boolean, uuid) from public, anon;
grant  execute on function public.create_journal_entry(date, text, text, jsonb, text, uuid, text, boolean, uuid) to authenticated, service_role;
revoke execute on function public.grant_vacation_balances(int, boolean) from public, anon;
grant  execute on function public.grant_vacation_balances(int, boolean) to authenticated, service_role;

------------------------------------------------------------------------------
-- 4. security_invoker on data-leaking views
------------------------------------------------------------------------------

alter view public.v_payroll_entries_resolved      set (security_invoker = on);
alter view public.v_payroll_entries_with_payments  set (security_invoker = on);
alter view public.v_employee_vacation_balances     set (security_invoker = on);
alter view public.v_attendance_records_resolved    set (security_invoker = on);
alter view public.v_file_attachments_resolved      set (security_invoker = on);

------------------------------------------------------------------------------
-- 5. user_roles writes service-role-only
------------------------------------------------------------------------------
-- An admin could POST /rest/v1/user_roles {self, owner} to self-promote (the
-- "admins cannot grant owner" rule lived only in app-side canAssignRole). All
-- legitimate role writes use getServiceClient() (bypasses RLS), so dropping the
-- authenticated write policies affects no legit flow. SELECT policies are kept.

do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public' and tablename = 'user_roles'
       and cmd in ('INSERT', 'DELETE', 'UPDATE', 'ALL')
  loop
    execute format('drop policy %I on public.user_roles;', pol.policyname);
  end loop;
end;
$$;

set row_security = on;
