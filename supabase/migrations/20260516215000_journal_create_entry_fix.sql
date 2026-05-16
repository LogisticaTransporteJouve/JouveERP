-- L.2a hotfix — create_journal_entry: resetear el constraint DEFERRABLE
-- al modo DEFERRED al inicio de cada invocación.
--
-- Bug: la función original hacía SET CONSTRAINTS jel_enforce_balance
-- IMMEDIATE al final para propagar el error en tiempo real. Pero esa
-- setting persiste hasta el COMMIT de la transacción. Cuando dos
-- create_journal_entry corren en la misma transacción (caso típico: un
-- trigger AFTER INSERT en transactions que crea un asiento mientras se
-- procesa un BEGIN…COMMIT más largo), la segunda llamada arranca con
-- IMMEDIATE y falla en la primera línea (todavía no llegó el crédito
-- compensador). Fix: SET DEFERRED al inicio para que cada invocación
-- empiece desde un estado conocido.

set row_security = off;

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
  -- Reset al modo DEFERRED al inicio. Sin esto, una llamada previa
  -- dentro de la misma transacción habría dejado el constraint en
  -- IMMEDIATE y la primera línea de este asiento fallaría con
  -- "desbalanceado: débito=X crédito=0".
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

  -- Forzar evaluación ahora para propagar el error en tiempo real.
  set constraints public.jel_enforce_balance immediate;

  return v_entry_id;
end;
$$;

set row_security = on;
