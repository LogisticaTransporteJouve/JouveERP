-- L.1 hotfix — el seed inicial usó un `INSERT … SELECT FROM (values …)
-- JOIN parents` que captura el snapshot de chart_of_accounts pre-insert,
-- así que las cuentas level 3 no podían resolver sus padres de level 2
-- recién creados. Resultado: en dev/prod se cargaron 16 cuentas (level
-- 1 y 2 solamente) en vez de las ~50 planificadas, dejando casi todos
-- los system_role sin asignar.
--
-- Esta migration completa el seed insertando las cuentas faltantes nivel
-- por nivel (un statement por fila resuelve el padre contra el estado
-- actual de la tabla). idempotente: si ya existe el code lo deja como
-- está.

set row_security = off;

create or replace function pg_temp.seed_coa(
  p_code text,
  p_name text,
  p_level int,
  p_account_type text,
  p_eerr_category text,
  p_system_role text
) returns void
language plpgsql
as $$
declare
  v_parent_id uuid;
  v_parent_code text;
begin
  -- Skip si ya existe (idempotente).
  perform 1 from public.chart_of_accounts where code = p_code;
  if found then
    return;
  end if;

  v_parent_code := substring(p_code from '^(.*)\.[0-9]+$');
  if v_parent_code is null then
    v_parent_id := null;
  else
    select id into v_parent_id from public.chart_of_accounts where code = v_parent_code;
    if v_parent_id is null then
      raise exception 'Seed COA: padre con code % no encontrado para %', v_parent_code, p_code;
    end if;
  end if;

  insert into public.chart_of_accounts (
    parent_id, code, name, level, account_type, eerr_category, system_role
  ) values (
    v_parent_id, p_code, p_name, p_level,
    p_account_type::public.coa_account_type,
    p_eerr_category,
    case when p_system_role is null then null else p_system_role::public.coa_system_role end
  );
end;
$$;

-- Level 3 (los level 2 ya existen desde la migration original)
select pg_temp.seed_coa('1.1.1', 'Caja y bancos',                  3, 'activo',             null,                     null);
select pg_temp.seed_coa('1.1.2', 'Créditos por ventas',            3, 'activo',             null,                     null);
select pg_temp.seed_coa('1.1.3', 'Créditos fiscales',              3, 'activo',             null,                     null);
select pg_temp.seed_coa('1.1.4', 'Otros créditos',                 3, 'activo',             null,                     null);
select pg_temp.seed_coa('1.1.5', 'Valores a depositar',            3, 'activo',             null,                     null);
select pg_temp.seed_coa('2.1.1', 'Deudas comerciales',             3, 'pasivo',             null,                     null);
select pg_temp.seed_coa('2.1.2', 'Deudas fiscales',                3, 'pasivo',             null,                     null);
select pg_temp.seed_coa('2.1.3', 'Cheques diferidos emitidos',     3, 'pasivo',             null,                     'cheques_diferidos_emitidos');
select pg_temp.seed_coa('3.1.1', 'Capital suscripto',              3, 'patrimonio',         null,                     null);
select pg_temp.seed_coa('3.2.1', 'Resultados no asignados',        3, 'patrimonio',         null,                     null);
select pg_temp.seed_coa('4.1.1', 'Ventas de servicios',            3, 'resultado_positivo', 'ingresos_operativos',    'ventas');
select pg_temp.seed_coa('4.2.1', 'Intereses ganados',              3, 'resultado_positivo', 'ingresos_financieros',   null);
select pg_temp.seed_coa('4.3.1', 'Ajustes de caja positivos',      3, 'resultado_positivo', 'otros_ingresos',         'ajustes_caja');
select pg_temp.seed_coa('5.1.1', 'Costos directos de operación',   3, 'resultado_negativo', 'costo',                  'compras');
select pg_temp.seed_coa('5.2.1', 'Combustible',                    3, 'resultado_negativo', 'gastos_operativos',      null);
select pg_temp.seed_coa('5.2.2', 'Mantenimiento de vehículos',     3, 'resultado_negativo', 'gastos_operativos',      null);
select pg_temp.seed_coa('5.2.3', 'Peajes',                         3, 'resultado_negativo', 'gastos_operativos',      null);
select pg_temp.seed_coa('5.2.4', 'Repuestos',                      3, 'resultado_negativo', 'gastos_operativos',      null);
select pg_temp.seed_coa('5.3.1', 'Sueldos y jornales',             3, 'resultado_negativo', 'gastos_administrativos', null);
select pg_temp.seed_coa('5.3.2', 'Honorarios profesionales',       3, 'resultado_negativo', 'gastos_administrativos', null);
select pg_temp.seed_coa('5.3.3', 'Servicios públicos',             3, 'resultado_negativo', 'gastos_administrativos', null);
select pg_temp.seed_coa('5.3.4', 'Alquileres',                     3, 'resultado_negativo', 'gastos_administrativos', null);
select pg_temp.seed_coa('5.3.5', 'Otros gastos administrativos',   3, 'resultado_negativo', 'gastos_administrativos', 'gastos');
select pg_temp.seed_coa('5.4.1', 'Intereses pagados',              3, 'resultado_negativo', 'gastos_financieros',     null);
select pg_temp.seed_coa('5.4.2', 'Comisiones bancarias',           3, 'resultado_negativo', 'gastos_financieros',     null);

-- Level 4
select pg_temp.seed_coa('1.1.1.1', 'Caja general',                       4, 'activo', null, 'caja');
select pg_temp.seed_coa('1.1.1.2', 'Bancos',                             4, 'activo', null, 'banco');
select pg_temp.seed_coa('1.1.2.1', 'Clientes',                           4, 'activo', null, 'clientes');
select pg_temp.seed_coa('1.1.3.1', 'IVA Crédito Fiscal',                 4, 'activo', null, 'iva_credito');
select pg_temp.seed_coa('1.1.3.2', 'Percepciones IIBB sufridas',         4, 'activo', null, 'percepciones_iibb_pagadas');
select pg_temp.seed_coa('1.1.3.3', 'Retenciones sufridas',               4, 'activo', null, 'retenciones_pagadas');
select pg_temp.seed_coa('1.1.5.1', 'Cheques en cartera',                 4, 'activo', null, 'cheques_cartera');
select pg_temp.seed_coa('2.1.1.1', 'Proveedores',                        4, 'pasivo', null, 'proveedores');
select pg_temp.seed_coa('2.1.2.1', 'IVA Débito Fiscal',                  4, 'pasivo', null, 'iva_debito');
select pg_temp.seed_coa('2.1.2.2', 'IVA Percibido',                      4, 'pasivo', null, 'iva_percibido');
select pg_temp.seed_coa('2.1.2.3', 'IVA Retenido',                       4, 'pasivo', null, 'iva_retenido');
select pg_temp.seed_coa('2.1.2.4', 'Percepciones IIBB practicadas',      4, 'pasivo', null, 'percepciones_iibb_cobradas');
select pg_temp.seed_coa('2.1.2.5', 'Retenciones practicadas a terceros', 4, 'pasivo', null, 'retenciones_cobradas');

drop function pg_temp.seed_coa(text, text, int, text, text, text);

set row_security = on;
