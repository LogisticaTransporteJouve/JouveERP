-- Auto-clasificación de gastos (Port 02): resuelve cada factura de compra a una
-- cuenta de gasto (hoja del plan) además del centro de costo existente.
--
-- 1) purchase_invoices.account_id — FK nullable a la cuenta de gasto resuelta.
--    Cuando está seteada, el posteo debita esa cuenta en vez del rol genérico
--    'compras' (cambio backward-compatible: el rol sigue siendo el fallback).
-- 2) expense_leaf_accounts — vista de cuentas de gasto hoja (sin hijos activos),
--    que son los targets válidos del clasificador.

set row_security = off;

alter table public.purchase_invoices
  add column account_id uuid references public.chart_of_accounts (id) on delete restrict;

comment on column public.purchase_invoices.account_id is
  'Cuenta de gasto resuelta (hoja del plan). Si está seteada, el posteo debita esta cuenta en vez del rol compras. La sugiere el clasificador IA, la confirma un humano.';

create index purchase_invoices_account_idx
  on public.purchase_invoices (account_id);

-- Hojas de gasto: activas, account_type resultado_negativo, sin hijo activo.
create or replace view public.expense_leaf_accounts with (security_invoker = on) as
  select c.id, c.code, c.name, c.level
  from public.chart_of_accounts c
  where c.is_active = true
    and c.account_type = 'resultado_negativo'
    and not exists (
      select 1
      from public.chart_of_accounts child
      where child.parent_id = c.id and child.is_active = true
    );

comment on view public.expense_leaf_accounts is
  'Cuentas de gasto hoja (resultado_negativo, sin hijos activos). Targets del clasificador de gastos.';

set row_security = on;
