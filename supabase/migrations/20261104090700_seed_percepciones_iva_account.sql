SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- "Percepciones IVA sufridas" (1.1.3.x, activo, next free code under 1.1.3
-- "Créditos fiscales") takes the role percepciones_iva_pagadas unless an active
-- account already holds it. 1.1.3.3 is "Retenciones sufridas", so the code is
-- computed, not fixed. Without the account the purchase journal posts IVA
-- perceptions to iva_credito (20261104090800).

do $$
declare
  v_parent uuid;
  v_code   text;
begin
  if not exists (
    select 1 from public.chart_of_accounts where system_role = 'percepciones_iva_pagadas' and is_active
  ) then
    select id into v_parent from public.chart_of_accounts where code = '1.1.3';
    if v_parent is not null then
      select '1.1.3.' || (coalesce(max(substring(code from '^1\.1\.3\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^1\.1\.3\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, system_role)
      values (v_parent, v_code, 'Percepciones IVA sufridas', 4, 'activo', 'percepciones_iva_pagadas');
    end if;
  end if;
end;
$$;
