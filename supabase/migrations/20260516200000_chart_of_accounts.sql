-- L.1 — Plan de cuentas jerárquico (chart of accounts).
--
-- Tabla `chart_of_accounts` con jerarquía vía parent_id self-fk y `code`
-- jerárquico estilo 1 → 1.1 → 1.1.1 → 1.1.1.1. Es la fundación de toda
-- la Fase L: en L.2 los asientos automáticos generados desde transactions,
-- comprobantes, OPs y recibos buscan la cuenta destino por `system_role`.
--
-- Decisiones:
--   - `code` libre (text, no array) — el orden lexicográfico no sirve
--     (`1.10` ordena antes que `1.2`), así que la UI ordena por
--     parent_id + nombre o por la propia jerarquía traversal.
--   - `level` redundante con conteo de puntos en code, pero lo guardamos
--     para queries rápidas ("dame todas las cuentas hoja", etc.).
--   - `system_role` único cuando no nulo — solo una cuenta puede ser
--     "la" caja, "el" IVA débito, etc. Si el contador tiene varias cuentas
--     contables para IVA débito (poco común), L.2 + auto_journal_mapping
--     cubre ese caso.
--   - `account_type` enum a nivel SQL (no text + check) para que
--     PostgREST lo exponga tipado y database.types.ts lo refleje como
--     union literal.
--   - Seed mínimo (capítulos 1-5 + hijos típicos), el contador agrega
--     las que falten desde la UI.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Enums
------------------------------------------------------------------------------
create type public.coa_account_type as enum (
  'activo',
  'pasivo',
  'patrimonio',
  'resultado_positivo',
  'resultado_negativo',
  'orden'
);

comment on type public.coa_account_type is
  'Tipo contable de la cuenta. "orden" es para cuentas de orden (memoria, sin impacto patrimonial).';

-- system_role queda como text + check para que agregar roles nuevos en
-- features posteriores no requiera alter type ... add value (que no es
-- transaccional). Lista cerrada por check para que la app no escriba
-- valores ad-hoc.
create type public.coa_system_role as enum (
  'caja',
  'banco',
  'clientes',
  'proveedores',
  'iva_debito',
  'iva_credito',
  'iva_percibido',
  'iva_retenido',
  'percepciones_iibb_pagadas',
  'percepciones_iibb_cobradas',
  'retenciones_pagadas',
  'retenciones_cobradas',
  'ventas',
  'compras',
  'gastos',
  'cheques_cartera',
  'cheques_diferidos_emitidos',
  'caja_apertura',
  'ajustes_caja'
);

comment on type public.coa_system_role is
  'Rol que cumple una cuenta en los asientos automáticos de L.2. Solo una cuenta del plan puede tener un rol dado (unique parcial).';

------------------------------------------------------------------------------
-- 2. chart_of_accounts
------------------------------------------------------------------------------
create table public.chart_of_accounts (
  id              uuid                    primary key default gen_random_uuid(),
  parent_id       uuid                    references public.chart_of_accounts (id) on delete restrict,
  code            text                    not null,
  name            text                    not null,
  level           int                     not null,
  account_type    public.coa_account_type not null,
  eerr_category   text,
  system_role     public.coa_system_role,
  is_active       boolean                 not null default true,
  created_by      uuid                    references auth.users (id) on delete set null,
  created_at      timestamptz             not null default now(),
  updated_at      timestamptz             not null default now(),

  constraint chart_of_accounts_code_unique unique (code),
  constraint chart_of_accounts_code_format check (code ~ '^[0-9]+(\.[0-9]+)*$'),
  constraint chart_of_accounts_level_positive check (level >= 1 and level <= 8),
  constraint chart_of_accounts_no_self_parent check (parent_id is null or parent_id <> id),
  constraint chart_of_accounts_root_has_no_parent check (
    (level = 1 and parent_id is null) or (level > 1 and parent_id is not null)
  )
);

-- Solo una cuenta puede tener un system_role dado, y solo cuentas activas
-- (si una cuenta con rol se desactiva, otra puede tomar el rol).
create unique index chart_of_accounts_system_role_unique
  on public.chart_of_accounts (system_role)
  where system_role is not null and is_active = true;

create index chart_of_accounts_parent_idx       on public.chart_of_accounts (parent_id);
create index chart_of_accounts_account_type_idx on public.chart_of_accounts (account_type);
create index chart_of_accounts_active_idx       on public.chart_of_accounts (is_active);

comment on table public.chart_of_accounts is
  'Plan de cuentas jerárquico (L.1). Codes estilo 1.1.2.3, depth max 8. system_role usado por L.2 para localizar la cuenta destino de cada asiento auto.';
comment on column public.chart_of_accounts.code is
  'Código jerárquico estilo 1 → 1.1 → 1.1.1. Único en toda la tabla.';
comment on column public.chart_of_accounts.level is
  'Profundidad en el árbol (1 = capítulo raíz). Redundante con conteo de "." en code pero acelera queries de cuentas-hoja.';
comment on column public.chart_of_accounts.eerr_category is
  'Subcategoría del estado de resultados (e.g. "gastos_administrativos", "ingresos_operativos"). Lo usa L.5 para agrupar el EERR.';
comment on column public.chart_of_accounts.system_role is
  'Rol del sistema. Lookup de L.2 para generar asientos automáticos.';

create trigger chart_of_accounts_set_updated_at
  before update on public.chart_of_accounts
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------------------------
alter table public.chart_of_accounts enable row level security;

create policy "Authenticated users can view chart_of_accounts"
  on public.chart_of_accounts for select
  to authenticated
  using (true);

create policy "Owners, admins and finance can insert chart_of_accounts"
  on public.chart_of_accounts for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can update chart_of_accounts"
  on public.chart_of_accounts for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and admins can delete chart_of_accounts"
  on public.chart_of_accounts for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

------------------------------------------------------------------------------
-- 4. Seed — plan estándar pyme argentina
------------------------------------------------------------------------------
-- Capítulos 1..5 + hijos típicos de logística/servicios. system_role
-- asignado a las cuentas-puente que L.2 va a consumir desde el día uno.
-- El contador puede agregar/desactivar lo que falte vía UI.

-- Capítulos (level 1)
insert into public.chart_of_accounts (code, name, level, account_type) values
  ('1', 'Activo',              1, 'activo'),
  ('2', 'Pasivo',              1, 'pasivo'),
  ('3', 'Patrimonio neto',     1, 'patrimonio'),
  ('4', 'Resultados positivos',1, 'resultado_positivo'),
  ('5', 'Resultados negativos',1, 'resultado_negativo');

-- Sub-rubros y hojas. Se referencian por code → resolvemos parent_id
-- mirando el code del padre (todo lo que está antes del último ".").
with parents as (
  select id, code from public.chart_of_accounts
)
insert into public.chart_of_accounts (parent_id, code, name, level, account_type, eerr_category, system_role)
select p.id, v.code, v.name, v.level, v.account_type::public.coa_account_type, v.eerr_category, v.system_role::public.coa_system_role
from (values
  -- 1.1 Activo corriente
  ('1.1',     'Activo corriente',                       2, 'activo',             null,                       null),
  ('1.1.1',   'Caja y bancos',                          3, 'activo',             null,                       null),
  ('1.1.1.1', 'Caja general',                           4, 'activo',             null,                       'caja'),
  ('1.1.1.2', 'Bancos',                                 4, 'activo',             null,                       'banco'),
  ('1.1.2',   'Créditos por ventas',                    3, 'activo',             null,                       null),
  ('1.1.2.1', 'Clientes',                               4, 'activo',             null,                       'clientes'),
  ('1.1.3',   'Créditos fiscales',                      3, 'activo',             null,                       null),
  ('1.1.3.1', 'IVA Crédito Fiscal',                     4, 'activo',             null,                       'iva_credito'),
  ('1.1.3.2', 'Percepciones IIBB sufridas',             4, 'activo',             null,                       'percepciones_iibb_pagadas'),
  ('1.1.3.3', 'Retenciones sufridas',                   4, 'activo',             null,                       'retenciones_pagadas'),
  ('1.1.4',   'Otros créditos',                         3, 'activo',             null,                       null),
  ('1.1.5',   'Valores a depositar',                    3, 'activo',             null,                       null),
  ('1.1.5.1', 'Cheques en cartera',                     4, 'activo',             null,                       'cheques_cartera'),

  -- 2.1 Pasivo corriente
  ('2.1',     'Pasivo corriente',                       2, 'pasivo',             null,                       null),
  ('2.1.1',   'Deudas comerciales',                     3, 'pasivo',             null,                       null),
  ('2.1.1.1', 'Proveedores',                            4, 'pasivo',             null,                       'proveedores'),
  ('2.1.2',   'Deudas fiscales',                        3, 'pasivo',             null,                       null),
  ('2.1.2.1', 'IVA Débito Fiscal',                      4, 'pasivo',             null,                       'iva_debito'),
  ('2.1.2.2', 'IVA Percibido',                          4, 'pasivo',             null,                       'iva_percibido'),
  ('2.1.2.3', 'IVA Retenido',                           4, 'pasivo',             null,                       'iva_retenido'),
  ('2.1.2.4', 'Percepciones IIBB practicadas',          4, 'pasivo',             null,                       'percepciones_iibb_cobradas'),
  ('2.1.2.5', 'Retenciones practicadas a terceros',     4, 'pasivo',             null,                       'retenciones_cobradas'),
  ('2.1.3',   'Cheques diferidos emitidos',             3, 'pasivo',             null,                       'cheques_diferidos_emitidos'),

  -- 3.1 Patrimonio
  ('3.1',     'Capital',                                2, 'patrimonio',         null,                       null),
  ('3.1.1',   'Capital suscripto',                      3, 'patrimonio',         null,                       null),
  ('3.2',     'Resultados acumulados',                  2, 'patrimonio',         null,                       null),
  ('3.2.1',   'Resultados no asignados',                3, 'patrimonio',         null,                       null),

  -- 4.1 Resultados positivos
  ('4.1',     'Ingresos operativos',                    2, 'resultado_positivo', 'ingresos_operativos',      null),
  ('4.1.1',   'Ventas de servicios',                    3, 'resultado_positivo', 'ingresos_operativos',      'ventas'),
  ('4.2',     'Ingresos financieros',                   2, 'resultado_positivo', 'ingresos_financieros',     null),
  ('4.2.1',   'Intereses ganados',                      3, 'resultado_positivo', 'ingresos_financieros',     null),
  ('4.3',     'Otros ingresos',                         2, 'resultado_positivo', 'otros_ingresos',           null),
  ('4.3.1',   'Ajustes de caja positivos',              3, 'resultado_positivo', 'otros_ingresos',           'ajustes_caja'),

  -- 5.1 Resultados negativos
  ('5.1',     'Costo de servicios prestados',           2, 'resultado_negativo', 'costo',                    null),
  ('5.1.1',   'Costos directos de operación',           3, 'resultado_negativo', 'costo',                    'compras'),
  ('5.2',     'Gastos operativos',                      2, 'resultado_negativo', 'gastos_operativos',        null),
  ('5.2.1',   'Combustible',                            3, 'resultado_negativo', 'gastos_operativos',        null),
  ('5.2.2',   'Mantenimiento de vehículos',             3, 'resultado_negativo', 'gastos_operativos',        null),
  ('5.2.3',   'Peajes',                                 3, 'resultado_negativo', 'gastos_operativos',        null),
  ('5.2.4',   'Repuestos',                              3, 'resultado_negativo', 'gastos_operativos',        null),
  ('5.3',     'Gastos administrativos',                 2, 'resultado_negativo', 'gastos_administrativos',   null),
  ('5.3.1',   'Sueldos y jornales',                     3, 'resultado_negativo', 'gastos_administrativos',   null),
  ('5.3.2',   'Honorarios profesionales',               3, 'resultado_negativo', 'gastos_administrativos',   null),
  ('5.3.3',   'Servicios públicos',                     3, 'resultado_negativo', 'gastos_administrativos',   null),
  ('5.3.4',   'Alquileres',                             3, 'resultado_negativo', 'gastos_administrativos',   null),
  ('5.3.5',   'Otros gastos administrativos',           3, 'resultado_negativo', 'gastos_administrativos',   'gastos'),
  ('5.4',     'Gastos financieros',                     2, 'resultado_negativo', 'gastos_financieros',       null),
  ('5.4.1',   'Intereses pagados',                      3, 'resultado_negativo', 'gastos_financieros',       null),
  ('5.4.2',   'Comisiones bancarias',                   3, 'resultado_negativo', 'gastos_financieros',       null)
) as v(code, name, level, account_type, eerr_category, system_role)
join parents p
  on p.code = substring(v.code from '^(.*)\.[0-9]+$');

set row_security = on;
