# Antes de promover

Lo que el owner revisa y aprueba antes de correr **Promote to production**
con cualquier commit posterior a `production-latest`. Cubre **todas las
migraciones posteriores a `production-latest`** (hoy `94f942b`, promovido el
2026-11-05; su última migración es `20261104194201`):
`promote-to-production.yml` las aplica todas juntas. Las consultas son de
solo lectura y se corren en el SQL editor de producción **antes** de
promover, sobre el schema de `production-latest` (sin ninguna migración
pendiente).

**Qué falta aprobar.** Solo los ítems de
[Pendientes para el próximo promote](#pendientes-para-el-próximo-promote):
`20261105090000`, `20261105090001`, `20261105090100` y los que se sumen
después, más el paso de [Después de promover](#después-de-promover). Todas
las migraciones hasta `20261104194201` ya están en producción: sus ítems
quedan marcados abajo, en
[Aplicadas en producción](#aplicadas-en-producción-promotes-hasta-el-2026-11-05),
y los «Aprobar» de `20261103000000`–`20261104080500` que viven en los
archivos de tema de `docs/pendientes/` tampoco gatean nada ya.

Los límites de rollback que no tienen mitigación en el schema (se respetan
operando) están en [`limites-de-rollback.md`](limites-de-rollback.md).

**Estado de producción (owner, 2026-11-04):** la base tiene solo clientes y
facturas de venta en pesos: ni recibos, ni comprobantes en dólares, ni
compras, cheques, órdenes de pago, préstamos, planillas o movimientos de
empleados. Todo backfill sobre esas tablas es un no-op en producción y no
hace falta re-asentar nada viejo. Los ítems de revisión de esos datos quedan
marcados **N/A en producción** con su SQL (sirven si se promueve sobre otra
base). Hoy (`94f942b`) producción tiene todas las tablas que
nombran esas consultas (`employee_account_movements`, `employee_debt_plans`,
`bank_statement_lines`, `freight_settlements`, …), así que ya corren, aunque
sobre una base sin esos datos no devuelven nada.

## Aplicadas en producción (promotes hasta el 2026-11-05)

Marcadas porque su migración (o su código, en el reconciliador de #340)
ya está en `production-latest` (`94f942b`). Sus
notas de rollback hablan del código que estaba en producción cuando se
escribieron, anterior a `94f942b`. Hoy un rollback de código vuelve a
`94f942b`, que ya tiene todo ese código («Recategorizar», el importador,
`uninvoiced_shipments`, `get_vehicle_margin`…): esas notas solo valen para
un rollback a un SHA anterior a `94f942b`.

- [x] **Aprobar `20261102200000`** (comprobantes fiscales en período
      cerrado y asientos pendientes). **Revisión real.** Un trigger nuevo en
      `invoices`, que tiene filas en producción: un borrador fiscal (o una
      emisión sin CAE) con fecha en un período cerrado ya no se emite ni se
      guarda con otro estado, fecha o canal. Ver los borradores fiscales que
      quedan trabados (corría sobre el schema de producción de entonces):
      `select i.id, i.fecha, i.status from public.invoices i where i.status in ('draft', 'emitting') and i.cae is null and public.is_channel_fiscal(i.channel_id) and exists (select 1 from public.accounting_closed_periods cp where cp.period = to_char(i.fecha, 'YYYY-MM'));`
      Rollback: el asiento de un comprobante autorizado que no se pudo
      postear queda en `pending_journal_entries`, y solo el código nuevo lo
      postea (al reabrir el período, `post_pending_journals`). Reabrir el
      período con código anterior no lo postea: queda pendiente hasta que,
      ya con código nuevo, se cierre y reabra ese período.
- [x] **Aprobar `20261103040000`–`040100` y `20261103060000`–`060100`**
      (roles de préstamos y de anticipos al personal). `040000` agrega
      `prestamos` e `intereses_pagados` y `060000` agrega
      `anticipos_personal` al enum del plan de cuentas: no se pueden quitar.
      `040100` le pone el rol `intereses_pagados` a la cuenta **5.4.1
      "Intereses pagados" que ya existe** y crea 2.1.N "Préstamos
      financieros". `060100` crea 1.1.4.N "Anticipos al personal". Con
      código anterior **no editar esas tres cuentas** en Plan de cuentas: el
      código viejo no conoce los roles (la insignia sale vacía y guardar
      falla con "Datos inválidos"). Ver qué cambia:
      `select code, name, system_role from public.chart_of_accounts where code in ('5.4.1', '2.1', '1.1.4') or code like '2.1.%' or code like '1.1.4.%' order by code;`
- [x] **Aprobar `20261103050100`** (períodos SAC). Límite de rollback: no
      crear un período SAC hasta que el deploy quede firme
      ([`limites-de-rollback.md`](limites-de-rollback.md), "SAC").
- [x] **Aprobar `20261103210000`** (recibos con letra X). Rollback: con
      código anterior, un recibo nuevo se ve R en la app y el PDF y X en su
      asiento y su movimiento de Caja (solo la descripción).
- [x] **Aprobar `20261102210000`–`20261102260000`, `20261103010000`,
      `20261103020000`, `20261103040200`, `20261103050000`,
      `20261103060200`, `20261103060300`, `20261103070000` y
      `20261103130000`.** Tablas, columnas y funciones nuevas, o funciones
      reemplazadas con las mismas firmas; el código anterior no lee lo
      nuevo. Lo único que toca filas existentes es `250000`, que agrega
      `invoice_items.revenue_kind` con `'service'` en toda fila. Rollback:
      `230000` cambia la firma de `next_internal_purchase_numero`, pero la
      vieja estaba revocada de `authenticated` y su única llamada (el
      formulario de compras) nunca funcionó; `get_management_pnl` (`260000`,
      `070000`) no existía en la producción de entonces, así que no hay nada a qué
      volver.
- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Antes de aprobar `20261104096400`** (#339, exento, no gravado y
      tributos por compra): el backfill pasa el `imp_trib` de cada compra a
      percepción de IIBB. El asiento no cambia, pero el TXT del libro IVA
      Compras de un período ya presentado declara esos tributos en el campo de
      IIBB y no en "Otros tributos": lo aprueban el dueño y el contador
      (`docs/decisions/2026-11-04-exento-no-gravado-y-reparto-de-otros-tributos-en-compras.md`).
      Compras que cambian, por período:
      `select to_char(fecha, 'YYYY-MM') as periodo, count(*), sum(imp_trib) from purchase_invoices where imp_trib <> 0 group by 1 order by 1;`
- [x] **Aprobar `20261104096200`–`20261104096700`** (#339). `096200` agrega
      el rol `percepciones_iva_pagadas` al enum del plan de cuentas: no se
      puede quitar. Rollback: un trigger pasa a IIBB el `imp_trib` que manda
      el código anterior, pero cambiar los tributos desde el código anterior en
      una compra que ya los tiene repartidos (percepción de IVA, municipales o
      internos) se rechaza ("Los tributos no suman…"); el código anterior no
      ve el exento ni el no gravado. Con código anterior a #339 no editar la
      cuenta "Percepciones IVA sufridas" en Plan de cuentas (no conoce el
      rol, como "Diferencias de cambio" abajo).
- [x] **Reconciliador de emisiones** (#340, `issue-invoice-reconcile`, sin
      migración). **Revisión real: el owner revisa la lista de borradores de
      abajo antes de promover.** Su primera corrida vuelve a mandar a AFIP los borradores de
      los últimos 3 días y resuelve las emisiones trabadas que ya existen. Un
      borrador que el usuario ya volvió a facturar con otro comprobante se
      borra antes, o se emitiría dos veces:
      `select id, status, created_at, updated_at from invoices where (status = 'draft' and created_at > now() - interval '3 days') or status = 'emitting';`
- [x] **Aprobar `20261104090500`** (#340, importación de ARCA en período
      cerrado). Rollback: es un trigger; con código anterior la importación
      guarda igual el comprobante y deja su asiento en
      `pending_journal_entries`. Sin #340 el cron de reconciliación no corre.
- [x] **Aprobar `20261104092000`–`20261104092300`** (#342: cheques en
      percibido, "Sin clasificar" en el margen por camión, deshacer pago de
      impuestos, NC/ND que siguen a su compra). Rollback: mismas firmas y
      columnas; el código anterior ya conoce los rubros de gestión, ignora la
      clave nueva de `recategorize_expense` y no escribe las columnas
      `payment_previous_*` (un impuesto pagado con código nuevo, deshecho y
      vuelto a pagar con el viejo conserva los valores del primer pago).
- [x] **Aprobar `20261104093000`–`20261104093400`** (#343, tesorería).
      Rollback: mismas funciones y argumentos; lo que el código anterior
      dejaba editar después de cobrar un cheque propio o anular un préstamo
      con plata ahora recibe el mensaje del guard.
- [x] **N/A en producción (base sin recibos ni comprobantes en dólares a 2026-11-04).** Sin recibos, OP ni NC en dólares, el
      re-asiento no toca nada. **Antes de aprobar `20261104094300`** (#344, diferencia de cambio): su
      backfill re-asienta, en los períodos abiertos, los recibos y OP en
      dólares emitidos contra comprobantes a otra cotización y las NC en
      dólares emitidas contra un origen a otra cotización. Cambian asientos de
      meses pasados sin cerrar; los de períodos cerrados conservan el suyo
      (los cuenta un NOTICE). Lista de lo que entra (los de un período
      cerrado salen también, y no cambian):
  ```sql
  select 'recibo' as doc, r.id, r.receipt_date as fecha
    from receipts r
    join receipt_allocations ra on ra.receipt_id = r.id
    join invoices i on i.id = ra.invoice_id
   where r.status = 'issued' and r.currency = 'USD'
     and coalesce(i.moneda, 'PES') in ('DOL', 'USD')
     and nullif(coalesce(nullif(i.cotizacion, 0), get_exchange_rate('USD', i.fecha)), 1)
         is distinct from nullif(coalesce(nullif(r.cotizacion, 0), get_exchange_rate('USD', r.receipt_date)), 1)
  union
  select 'orden de pago', po.id, po.payment_date
    from payment_orders po
    join payment_order_allocations poa on poa.payment_order_id = po.id
    join purchase_invoices pi on pi.id = poa.purchase_invoice_id
   where po.status = 'issued' and po.currency = 'USD'
     and coalesce(pi.moneda, 'PES') in ('DOL', 'USD')
     and nullif(coalesce(nullif(pi.cotizacion, 0), get_exchange_rate('USD', pi.fecha)), 1)
         is distinct from nullif(coalesce(nullif(po.cotizacion, 0), get_exchange_rate('USD', po.payment_date)), 1)
  union
  select 'NC', n.id, n.fecha
    from invoices n
    join invoices o on o.id = n.invoice_origin_id
   where n.kind = 'nc' and n.status = 'emitted'
     and coalesce(n.moneda, 'PES') <> 'PES' and coalesce(o.moneda, 'PES') <> 'PES'
     and nullif(coalesce(nullif(o.cotizacion, 0), get_exchange_rate('USD', o.fecha)), 1)
         is distinct from nullif(coalesce(nullif(n.cotizacion, 0), get_exchange_rate('USD', n.fecha)), 1)
  order by fecha;
  ```
- [x] **Aprobar `20261104094000`–`20261104094300`** (#344). `094000` agrega
      el valor `diferencia_cambio` al enum de roles del plan de cuentas: no se
      puede quitar. Rollback: las RPC de saldos de apertura y el aging tienen
      las mismas firmas y columnas; los asientos re-hechos quedan. Con código
      anterior a #344 **no editar la cuenta "Diferencias de cambio"** en Plan
      de cuentas: el código viejo no conoce el rol (la insignia sale vacía y
      guardar falla con "Datos inválidos").
- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Antes de aprobar `20261104095200`** (#345), el dueño revisa los
      cargos que el backfill baja del total al neto (los saldos de esos
      empleados bajan el IVA y las percepciones; si un cierre de planilla ya
      descontó el total, queda saldo a favor del empleado):
      `select m.employee_id, m.amount, pi.imp_neto from employee_account_movements m join purchase_invoices pi on pi.id = m.purchase_invoice_id where is_channel_fiscal(pi.channel_id) and m.amount <> pi.imp_neto;`
- [x] **Aprobar `20261104095000`–`20261104095300`** (#345). Rollback: el
      código anterior llama a las RPC de la rendición con sus argumentos
      viejos (resuelven a las nuevas con "a cargo del chofer"), lista un
      faltante asentado como adelanto como "sin asentar" (volver a asentar
      devuelve el mismo), rechaza asentar un sobrante al chofer y no ve
      `embargo_override` (el trigger lo respeta igual).
- [x] **Aprobar `20261104096000`** (insights) **y `20261104096100`**
      (denegaciones de permisos quitados) (#346). Sin la primera, el analista
      falla (no existe el RPC) y las tarjetas quedan como estaban. Rollback:
      el código anterior borra e inserta con el service client; el índice
      único hace fallar el insert de dos corridas viejas simultáneas en vez de
      duplicar las tarjetas. La segunda solo inserta denegaciones de la
      escritura que cubría cada `:read` quitado; las filas viejas quedan y el
      código anterior las lee como antes.
- [x] **Aprobar `20261104100000`–`20261104100300`** (#350, emisión AFIP).
      No tocan filas existentes:
  - `100000` agrega el guard de cotización USD mayor a 1 para comprobantes
    fiscales en dólares.
  - `100100` cambia el total de la lista de comprobantes a solo emitidos.
  - `100200` impide emitir con un CAEA declarado "sin movimiento".
  - `100300` agrega el RPC `delete_orphan_files`.

  **N/A en producción (base sin recibos ni comprobantes en dólares a 2026-11-04).** Antes de aprobar, ver si hay comprobantes USD guardados con cotización 1
  (el guard no los repara):
  `select id, fecha, cotizacion from public.invoices where moneda <> 'PES' and coalesce(cotizacion, 0) <= 1;`
  Rollback: firmas sin cambio; el código anterior reintenta y falla la
  emisión con un CAEA "sin movimiento".

- [x] **Aprobar `20261104101000`–`20261104101400`** (#351, tesorería).
  - Los cheques USD de proveedores y las cuotas de préstamos USD
    **nuevos** se asientan a la cotización de la OP y del desembolso.
  - Los asientos ya existentes no se reasientan. Reasentarlos cambia
    períodos pasados y lo decide el dueño.
  - Las cuentas con movimientos quedan con moneda, tipo y saldo inicial
    congelados.
  - Un rechazo de cheque con fecha en un período cerrado ahora se
    rechaza (antes se asentaba con fecha de hoy).

  **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** Ver las cuentas que quedan congeladas (lo que va a mirar
  `account_has_movements`, que crea `101100`):

  ```sql
  select a.id, a.name from public.accounts a
   where exists (select 1 from public.transactions t where t.account_id = a.id)
      or exists (select 1 from public.checks c where c.cartera_account_id = a.id)
      or exists (select 1 from public.issued_checks ic where ic.bank_account_id = a.id)
      or exists (select 1 from public.bank_statement_lines l where l.account_id = a.id)
      or exists (select 1 from public.account_opening_balances o where o.account_id = a.id);
  ```

  Rollback: columnas agregadas al final, firmas sin cambio; la cuenta
  corriente vieja muestra la fila del cheque rechazado sin link.

- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Antes de aprobar `20261104102300`** (#349): el backfill resincroniza
      los cargos de compras a cargo de empleados que tienen NC y reasienta
      esas NC a `anticipos_personal`. Saltea los períodos cerrados. El cargo
      nuevo es la cifra de la factura (canal fiscal: neto + no gravado +
      exento + municipales + internos; interno: total) menos la de sus NC
      vigentes en la misma moneda; si queda en cero o menos, o la factura
      está anulada, el cargo se borra (`nuevo` vacío). Las consultas calculan
      eso mismo sobre el schema de hoy (no gravado, exento, municipales e
      internos todavía no existen, y `096400` los deja en 0 en las compras
      que ya están).

  Cargos que cambian (`actual` vacío: el backfill lo crea):

  ```sql
  with fig as (
    select p.id, p.invoice_origin_id, p.kind, p.status, p.charged_employee_id,
           p.channel_id, p.imp_neto, p.moneda,
           case when is_channel_fiscal(p.channel_id)
                then p.imp_neto
                     + coalesce((to_jsonb(p) ->> 'imp_no_gravado')::numeric, 0)
                     + coalesce((to_jsonb(p) ->> 'imp_op_exentas')::numeric, 0)
                     + coalesce((to_jsonb(p) ->> 'imp_perc_municipales')::numeric, 0)
                     + coalesce((to_jsonb(p) ->> 'imp_impuestos_internos')::numeric, 0)
                else p.imp_total end as figura
      from purchase_invoices p
  ),
  con_nc as (
    select f.id,
           case when f.status = 'received' then nullif(greatest(f.figura - coalesce(
             sum(nc.figura) filter (where coalesce(nc.moneda, 'PES') = coalesce(f.moneda, 'PES')),
             0), 0), 0) end as nuevo
      from fig f
      join fig nc on nc.invoice_origin_id = f.id and nc.kind = 'nc' and nc.status = 'received'
     where f.charged_employee_id is not null
     group by f.id, f.status, f.figura, f.moneda
  )
  select c.id as compra, f.charged_employee_id as empleado, m.amount as actual, c.nuevo
    from con_nc c
    join fig f on f.id = c.id
    left join employee_account_movements m on m.purchase_invoice_id = c.id
   where m.amount is distinct from c.nuevo
   order by 2;
  ```

  Planes de deuda activos cuyo total supera el cargo que queda (el de
  `095200` en canal fiscal, el de arriba si la compra tiene NC):

  ```sql
  with fig as (
    select p.id, p.invoice_origin_id, p.kind, p.status, p.charged_employee_id,
           p.channel_id, p.imp_neto, p.moneda,
           case when is_channel_fiscal(p.channel_id)
                then p.imp_neto
                     + coalesce((to_jsonb(p) ->> 'imp_no_gravado')::numeric, 0)
                     + coalesce((to_jsonb(p) ->> 'imp_op_exentas')::numeric, 0)
                     + coalesce((to_jsonb(p) ->> 'imp_perc_municipales')::numeric, 0)
                     + coalesce((to_jsonb(p) ->> 'imp_impuestos_internos')::numeric, 0)
                else p.imp_total end as figura
      from purchase_invoices p
  ),
  con_nc as (
    select f.id,
           case when f.status = 'received' then nullif(greatest(f.figura - coalesce(
             sum(nc.figura) filter (where coalesce(nc.moneda, 'PES') = coalesce(f.moneda, 'PES')),
             0), 0), 0) end as nuevo
      from fig f
      join fig nc on nc.invoice_origin_id = f.id and nc.kind = 'nc' and nc.status = 'received'
     where f.charged_employee_id is not null
     group by f.id, f.status, f.figura, f.moneda
  ),
  cargo as (
    select m.employee_id, m.purchase_invoice_id, m.amount as actual,
           case when c.id is not null then c.nuevo
                when is_channel_fiscal(f.channel_id) and f.imp_neto > 0 then f.imp_neto
                else m.amount end as nuevo
      from employee_account_movements m
      join fig f on f.id = m.purchase_invoice_id
      left join con_nc c on c.id = m.purchase_invoice_id
  )
  select p.id, p.employee_id, p.description, p.total, k.purchase_invoice_id as compra,
         k.actual, k.nuevo
    from employee_debt_plans p
    join cargo k on k.employee_id = p.employee_id
   where p.status = 'activo' and p.total > coalesce(k.nuevo, 0);
  ```

  Las NC que quedan con su asiento viejo por período cerrado se ven
  **después** de promover (`docs/pendientes/2026-11-04-auditoria-w2-rrhh-gestion-y-rendiciones.md`).

- [x] **Aprobar `20261104102000`–`20261104102400`** (#349, RRHH y Gestión).
  - `102000` reescribe `management_pnl_lines`. Las diferencias de cambio
    pasan a "Intereses" (fuera del margen operativo), y en las cuotas sin
    desglose los intereses ya no cuentan como capital.
  - `102100` corrige el mensaje de la rendición.
  - `102400` reescribe `sync_automatic_tasks` sobre la versión de
    `101400`.

  Rollback: el código anterior lee las mismas columnas; Gestión con
  código viejo muestra los mismos buckets.

- [x] **Aprobar `20261104104000`** (valida seis CHECK que habían quedado
      `NOT VALID`; no cambia datos). Toda fila existente los cumple; si una
      validación igual fallara, la migración entera se revierte y el promote
      frena. Ver cuáles siguen sin validar:
      `select conrelid::regclass, conname from pg_constraint where not convalidated and connamespace = 'public'::regnamespace;`
      Rollback: nada que hacer, el código no lee el flag.
- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Antes de aprobar `20261104112000`** (auditoría w3, compras): una
      compra fiscal nueva, o editada en sus importes, cuyo total no da neto +
      IVA + otros tributos + no gravado + exento se rechaza. Las existentes no
      se tocan: siguen guardando ediciones que no cambian importes, y en
      proveedores queda la diferencia (el asiento acredita las partes, la
      cuenta corriente y el aging el total). Ver cuáles son; para cada una el
      dueño decide pasar la diferencia a no gravado (re-asienta) o anularla y
      recargarla, y las de período cerrado piden reabrirlo:
      `select pi.id, pi.fecha, pi.letter, pi.punto_venta, pi.numero, pi.imp_total - (pi.imp_neto + pi.imp_iva + pi.imp_trib + coalesce((to_jsonb(pi) ->> 'imp_no_gravado')::numeric, 0) + coalesce((to_jsonb(pi) ->> 'imp_op_exentas')::numeric, 0)) as gap, exists (select 1 from public.accounting_closed_periods cp where cp.period = to_char(pi.fecha, 'YYYY-MM')) as closed from public.purchase_invoices pi where pi.status = 'received' and public.is_channel_fiscal(pi.channel_id) and abs(pi.imp_total - (pi.imp_neto + pi.imp_iva + pi.imp_trib + coalesce((to_jsonb(pi) ->> 'imp_no_gravado')::numeric, 0) + coalesce((to_jsonb(pi) ->> 'imp_op_exentas')::numeric, 0))) > 0.01 order by pi.fecha;`
- [x] **Aprobar `20261104112000`** (auditoría w3, compras: el total de una
      compra fiscal es la suma de sus partes). No toca filas existentes.
      Rollback: el código anterior escribe las mismas columnas; una compra
      fiscal que no cierra recibe el mensaje del guard.
- [x] **Aprobar `20261104120500`** (auditoría w4, compras): una compra fiscal
      nueva, o editada en sus importes, tiene que cerrar al centavo (antes
      aceptaba un centavo de diferencia, que quedaba en proveedores), y una B
      o C fiscal no puede guardar IVA, exento ni no gravado por ningún camino,
      ítems incluidos. Las existentes siguen guardando ediciones que no tocan
      esas columnas. Producción no tiene compras (N/A); si las tuviera, las
      que quedan a un centavo (sobre el schema de producción de entonces):
      `select pi.id, pi.fecha, pi.letter, pi.punto_venta, pi.numero from public.purchase_invoices pi where pi.status = 'received' and public.is_channel_fiscal(pi.channel_id) and abs(pi.imp_total - (pi.imp_neto + pi.imp_iva + pi.imp_trib + coalesce((to_jsonb(pi) ->> 'imp_no_gravado')::numeric, 0) + coalesce((to_jsonb(pi) ->> 'imp_op_exentas')::numeric, 0))) between 0.005 and 0.01;`
      Rollback: el código anterior escribe las mismas columnas; lo que rompe
      una de las dos reglas recibe el mensaje del guard.
- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Decidir las compras fiscales B y C con IVA** (auditoría w3, S1 F2;
      no se cambian datos). Las cargadas antes de #339 pueden tener IVA,
      exento o no gravado aparte: el libro IVA, el estimado y `iva_credito`
      cuentan ese IVA como crédito fiscal y el TXT no. El dueño y el contador
      deciden si se pliegan al neto en los períodos abiertos (re-asienta) y
      qué hacer con las de períodos cerrados. Contarlas:
      `select exists (select 1 from public.accounting_closed_periods cp where cp.period = to_char(pi.fecha, 'YYYY-MM')) as closed, count(*), sum(pi.imp_iva) as iva from public.purchase_invoices pi where pi.status = 'received' and pi.letter in ('B', 'C') and public.is_channel_fiscal(pi.channel_id) and pi.imp_iva + coalesce((to_jsonb(pi) ->> 'imp_no_gravado')::numeric, 0) + coalesce((to_jsonb(pi) ->> 'imp_op_exentas')::numeric, 0) > 0 group by 1;`
- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Antes de aprobar `20261104110600`** (tesorería w3): desde esa
      migración, un cheque propio de una OP que el banco rechaza devuelve en
      Caja el egreso de la OP. Los ya rechazados antes no lo tienen: su banco
      sigue con el egreso de más. El owner decide si cargarles el ingreso a
      mano ("Rechazo cheque propio #…", en la fecha del rechazo):
      `select ic.id, ic.check_number, ic.bank_name, ic.amount, ic.currency, ic.rejected_at, po.punto_venta, po.numero from issued_checks ic join payment_orders po on po.id = ic.payment_order_id where ic.status = 'rejected' and not exists (select 1 from transactions t where t.issued_check_id = ic.id) order by ic.rejected_at;`
      Las OP con un cheque propio anulado por fuera de la orden (antes de
      `20261102210000`) ya no se pueden anular ni editar: esa anulación
      devolvió la deuda en el diario, y anular la OP la devolvería otra vez.
      El owner revisa cada una con el contador:
      `select ic.id, ic.check_number, ic.amount, ic.currency, po.punto_venta, po.numero from issued_checks ic join payment_orders po on po.id = ic.payment_order_id where ic.status = 'cancelled' and po.status = 'issued';`
- [x] **Aprobar `20261104110600`** (tesorería w3: el rechazo de un cheque
      propio de una OP devuelve su egreso en Caja; una OP con un cheque
      anulado por fuera no se anula ni se edita). No toca filas existentes.
      Rollback: mismas funciones y argumentos; el código anterior lee el
      movimiento nuevo como cualquier movimiento de cheque propio.
- [x] **Aprobar `20261104113000`–`20261104113002`** (percepciones de
      Ganancias y otros impuestos nacionales en compras). `113000` agrega el
      rol `percepciones_ganancias` al enum del plan de cuentas: no se puede
      quitar. `113001` agrega `imp_perc_nacionales` (0 en toda fila: sin
      backfill) y crea la cuenta 1.1.3.N "Percepciones y pagos a cuenta de
      Ganancias"; `113002` suma la columna al libro IVA Compras. Rollback: el
      código anterior no manda la columna (queda en 0) y lee las columnas del
      libro que nombra; editar los tributos desde el código anterior en una
      compra que tiene Ganancias se rechaza ("Los tributos no suman…"). Con
      código anterior no editar la cuenta nueva en Plan de cuentas (no conoce
      el rol).
- [x] **Antes de aprobar `20261104110601`: confirmar Supabase Vault en
      producción.** `get_arca_web_password` es `language sql` sobre
      `vault.decrypted_secrets`: sin la extensión la migración falla y el
      promote frena a mitad de camino, con las migraciones anteriores ya
      aplicadas. Tiene que devolver una fila:
      `select extname, extversion from pg_extension where extname = 'supabase_vault';`
      Sin fila, activar `supabase_vault` en Database → Extensions antes de
      promover.
- [x] **Aprobar `20261104104001`, `104002`, `110601`, `113003`, `120000`,
      `120200`, `120201`, `120600` y `120700`** (bandeja de Recibidos de
      ARCA, usuario web de ARCA, Gestión y cheques propios, auditorías w4).
      Salvo `120700`, ninguna de este ítem toca filas existentes. Rollback
      de cada una:
  - `104001` (bandeja `arca_received_vouchers`, `link_received_vouchers`
    y el trigger que vincula una compra cargada a mano): tabla y
    funciones nuevas; el código anterior no las lee y el trigger solo
    marca comprobantes de la bandeja, no toca la compra.
  - `104002` (en Gestión percibido, lo pagado de una compra "Neutro" no
    suma): `management_pnl_lines` mantiene firma y columnas; con código
    anterior solo cambian las cifras.
  - `110601` (usuario web de ARCA, clave en Vault): tabla de una fila y
    funciones nuevas, solo para `service_role`; el código anterior no
    las llama. La clave guardada queda en Vault.
  - `113003` (estado de la última sincronización de Recibidos): columnas
    nulas sin default; el código anterior las ignora.
  - `120000` (corte a los dos ingresos fallidos seguidos y vínculo solo
    con el mismo total): `record_arca_web_attempt` es nueva y
    `record_arca_web_sign_in` queda para el código anterior;
    `link_received_vouchers` mantiene la firma.
  - `120200` (cheque propio fijo a su OP): guard nuevo; el código
    anterior ya rechaza esas ediciones en `updateIssuedCheckAction` con
    el mismo mensaje.
  - `120201` (lo que paga una OP sobre un cheque rechazado toma el
    reparto de la OP original): función nueva y `management_pnl_lines`
    con la misma firma; solo cambian las cifras.
  - `120600`: solo cambia el comentario de `ai_workflows`.
  - `120700` **desactiva el centro de costo FLOTA_DZ** (DZ Instalaciones
    se retiró el 2026-10-31). Es la única de este ítem que escribe una
    fila que ya existe en producción (no la única pendiente: `040100`
    re-etiqueta 5.4.1, ver arriba, y `094300` le pone `diferencia_cambio`
    a una cuenta existente llamada "Diferencias de cambio", si la hay), y
    un rollback de código no la reactiva: si hace falta, se reactiva en Contabilidad → Centros
    de costo. Ver el estado actual:
    `select code, name, is_active from public.cost_centers where code = 'FLOTA_DZ';`
- [x] **Aprobar `20261104122000`, `123000` y `123001`** (auditoría w5).
      Ninguna toca filas existentes. Rollback de cada una:
  - `122000`: el trigger que vincula una compra con Recibidos compara
    además moneda e IVA (en una A), y una compra vinculada que se edita y
    deja de coincidir devuelve el comprobante a Pendientes;
    `link_received_vouchers` mantiene la firma.
  - `123000`: un cheque propio se liga a una OP solo desde
    `create_payment_order`/`update_payment_order`, también al insertarlo.
    El código anterior inserta cheques ligados solo por esas RPC.
  - `123001`: monto, moneda, cartera, recibo y estado de un cheque de
    terceros cambian solo por sus RPC. El código anterior nunca hace PATCH
    de `checks`.
- [x] **Aprobar `20261104132000`** (auditoría w6): `guard_check_edit` corre
      también en INSERT (un cheque de terceros nuevo es manual, en cartera y
      sin recibo, salvo que lo cargue `create_receipt`/`update_receipt`),
      fija además `source_kind`, `source_client_id` y
      `source_payment_line_id`, y `check_movements` acepta escrituras solo de
      las RPC de cheques, recibos e importador, de sus cascadas y del
      movimiento «recibido» inicial de «Nuevo cheque». No toca filas
      existentes. Rollback: el código anterior inserta cheques solo con esas
      formas, nunca hace PATCH de esas columnas y escribe `check_movements`
      solo por esas RPC y el «recibido» inicial.
- [x] **Aprobar `20261104131000` y `20261104132100`** (auditoría w6).
      Ninguna toca filas existentes.
  - `131000`: un comprobante de Recibidos vuelve a Pendientes también si
    se edita la clave de la compra vinculada (proveedor, tipo, letra, punto
    de venta, número o canal), y una compra se queda con un solo
    comprobante. `link_received_vouchers` mantiene la firma; el código
    anterior no tiene la bandeja.
  - `132100`: los ítems de una compra fiscal en un período cerrado no
    cambian (neto e IVA por alícuota, o tener o no ítems), ni por la RPC
    ni por escritura directa. Rollback: el código anterior llama a la misma
    RPC y recibe el mensaje del guard (55006). Como guarda el encabezado
    antes que los ítems, las notas, el vencimiento o la cuenta que cambió
    quedan guardados aunque vea el error.
- [x] **Aprobar `20261104140000`** (auditoría w7): un cheque propio cambia
      de estado solo desde «emitido» y se inserta emitido
      (`guard_issued_check_edit`). No toca filas existentes. Rollback: el
      código anterior solo mueve cheques desde «emitido» y los inserta así.
- [x] **Aprobar `20261104140001`** (auditoría w7): `guard_document_header`
      en `receipts` y `payment_orders`. El estado pasa solo de emitido a
      anulado. Monto, moneda, cotización, cliente o proveedor, canal, fecha
      y número cambian solo dentro de `update_receipt` /
      `update_payment_order`. No toca filas existentes. Rollback: el código
      anterior solo anula, edita por esas RPC y escribe notas,
      `notified_at` y `created_by`.
- [x] **Aprobar `20261104140002`** (auditoría w7): `guard_document_line` en
      `payment_order_payment_lines`, `receipt_payment_lines` y
      `receipt_retentions`. Las escriben solo `create_*` / `update_*` de su
      documento y las acciones de clave foránea. No toca filas existentes.
      Rollback: el código anterior escribe esas filas solo por esas RPC.
- [x] **Aprobar `20261104140003`** (auditoría w7): `deposit_check` acepta
      solo un banco activo de la moneda del cheque. `guard_check_edit`
      rechaza en INSERT una cartera que no sea `checks`/`echeq`. El
      «recibido» inicial toma de la base su `created_at`, su `created_by` y
      la emisión del cheque como fecha. No toca filas existentes. Rollback:
      el código anterior deposita solo en los bancos del diálogo, carga
      cheques solo en carteras y manda esos valores en el «recibido».
- [x] **Aprobar `20261104140100` y `140101`** (auditoría w7, compras). No
      tocan filas existentes. Rollback de cada una:
  - `140100`: agrega `purchase_items_change_refused` (la regla de período
    cerrado de `replace_purchase_invoice_items`, sola y de solo lectura) y
    la RPC pasa a llamarla; rechaza exactamente lo mismo que antes. El
    código anterior no llama al predicado.
  - `140101`: el CUIT de un proveedor con compras fiscales en un período
    cerrado no cambia (55006). El código anterior recibe un error genérico
    («No se pudo actualizar el proveedor.»): no muestra el motivo, pero el
    cambio se rechaza igual. Ver si hay
    proveedores afectados (N/A en producción, sin compras):
    `select distinct s.id, s.cuit from public.suppliers s join public.purchase_invoices p on p.supplier_id = s.id join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal join public.accounting_closed_periods cp on cp.period = to_char(p.fecha, 'YYYY-MM') where p.status = 'received';`
- [x] **Aprobar `20261104141000`** (ARCA, #390): cambiar el CUIT de un
      proveedor devuelve a Pendientes los comprobantes de Recibidos ligados
      a sus compras con el CUIT viejo y vincula los del CUIT nuevo. Es una
      función nueva y un trigger nuevo en `suppliers`, y no toca filas
      existentes. Rollback: el código anterior edita el CUIT igual y el
      trigger corre, pero solo toca la bandeja, que el código anterior no
      tiene.
- [x] **Aprobar `20261104150000`** (auditoría w8): `guard_document_insert`
      en `receipts` y `payment_orders`. Una cabecera se inserta solo dentro
      de `create_receipt` / `create_payment_order`. No toca filas
      existentes. Rollback: el código anterior inserta cabeceras solo por
      esas RPC.
- [x] **Aprobar `20261104150001`** (auditoría w8, préstamos). No toca filas
      existentes.
  - `guard_loan_installment_payment`: una cuota se inserta pendiente, y su
    estado, fecha e importe pagados y su movimiento cambian solo dentro de
    `pay_loan_installment` / `adopt_loan_installment_payment`.
  - `guard_loan`: el desembolso se liga solo dentro de
    `record_loan_disbursement`, y no se inserta.
  - `create_loan`: el préstamo y sus cuotas en una transacción.
  - Rollback: el código anterior paga por `pay_loan_installment` y no
    registra desembolsos; inserta préstamos y cuotas pendientes de forma
    directa, lo que sigue permitido.
- [x] **Aprobar `20261104150002`** (auditoría w8): una línea de OP en una
      cartera tiene que endosar un cheque (trigger en la línea), y
      `create_receipt` / `update_receipt` rechazan una línea en cartera sin
      cheque. No toca filas existentes, pero un documento que ya tenga una
      línea así se rechaza al volver a guardarlo. Rollback: los formularios
      del código anterior no mandan esas líneas. Ver si hay documentos
      afectados (N/A en producción, sin cheques ni OP):
      `select l.payment_order_id from public.payment_order_payment_lines l join public.accounts a on a.id = l.account_id where a.type in ('checks', 'echeq') and l.endorsed_check_id is null union all select l.receipt_id from public.receipt_payment_lines l join public.accounts a on a.id = l.account_id where a.type in ('checks', 'echeq') and not exists (select 1 from public.checks k where k.source_payment_line_id = l.id);`
- [x] **Aprobar `20261104150003`** (auditoría w8): `guard_transaction_origin`
      en `transactions`. Un movimiento en una cartera, o con un vínculo a un
      recibo, una OP o un cheque, lo escriben solo su documento y los
      triggers de cheques y sueldos. No toca filas existentes. Rollback: el
      código anterior escribe esos movimientos solo por esas RPC y
      triggers; «Nuevo movimiento» rechaza carteras y no pone esos
      vínculos.
- [x] **Aprobar `20261104150200` y `150201`** (auditoría w8, gestión). No
      tocan filas existentes. Rollback de cada una:
  - `150200`: una NC/ND de compra sin centro de costo toma el de su origen
    aunque tenga cuenta propia (antes, solo si la cuenta también venía
    vacía). El código anterior manda los mismos campos; solo lee el centro
    que ahora completa el trigger. Las NC/ND ya cargadas sin centro:
    `docs/pendientes/2026-11-04-gestion-flota-y-rrhh-auditoria-w8.md`.
  - `150201`: `get_vehicle_margin` cuenta en su centro la NC/ND de una
    compra vinculada a una carga de combustible o un service. Mismas
    columnas; el código anterior no llama a `get_vehicle_margin`.
- [x] **Aprobar `20261104160000`** (auditoría w9, sueldos):
      `guard_payroll_payment_transaction`. El movimiento de un pago de sueldo
      es el que creó su alta: `transaction_id` no cambia después. No toca
      filas existentes. Rollback: el código anterior nunca escribe la
      columna.
- [x] **Aprobar `20261104160001`** (auditoría w9, préstamos). No toca filas
      existentes.
  - `guard_loan_installment_payment`: una cuota pagada no se borra, salvo
    con su préstamo (que `guard_loan` ya solo deja borrar sin nada pagado).
  - `guard_loan`: el capital, la moneda y el canal no cambian una vez
    registrado el desembolso, importado el préstamo o pagada una cuota; el
    estado pasa solo de activo a anulado («Anular») o a pagado dentro de
    las RPC de pago.
  - Rollback: el código anterior no borra cuotas sueltas, anula con el
    mismo UPDATE, marca pagado por las mismas RPC y no edita las condiciones
    de un préstamo.
- [x] **Aprobar `20261104160002`** (auditoría w9, almacenaje). No toca filas
      existentes.
  - `claim_storage_billing_period`: un período con una factura viva emitida
    bajo el id de su reserva vencida la vincula, en vez de borrar la reserva
    y dejar emitir otra factura.
  - `guard_storage_billing_run_invoice`: un período se vincula solo a una
    factura de su cliente que no falló ni se anuló.
  - Rollback: el código anterior emite con una clave al azar, así que sus
    reservas vencidas se borran como antes. Una reserva que deja el código
    nuevo y que el anterior vincula al reclamar devuelve null, y el código
    anterior muestra «No se pudo validar el período.» sin emitir nada.
- [x] **Aprobar `20261104160100`** (auditoría w9, fiscal): RPC nueva
      `import_arca_issued_invoice`, que la importación de ventas de ARCA usa
      para guardar la cabecera y sus ítems por alícuota en una sola
      transacción. Solo la ejecuta el service role. No toca filas
      existentes: las ventas ya importadas sin ítems siguen igual (ver
      «Re-leer de ARCA las ventas ya importadas» en
      `docs/pendientes/2026-11-04-fiscal-ventas-auditoria-w8.md`). Rollback:
      el código anterior no llama a la función y sigue con su upsert más el
      INSERT de ítems aparte. Ventas importadas sin ítems hoy (solo para
      saber cuántas hay, no se cambian):
      `select count(*) from public.invoices i where i.idempotency_key like 'arca-sync-%' and not exists (select 1 from public.invoice_items it where it.invoice_id = i.id);`
- [x] **Aprobar `20261104160200` y `160201`** (auditoría w9, gestión). No
      tocan filas existentes. Rollback de cada una:
  - `160200`: una NC/ND de compra editada toma la cuenta y el centro de su
    origen cuando quedan vacíos, y al cambiarle el origen pasa al nuevo lo
    heredado del anterior (salvo un campo ya vacío en un período cerrado).
    El trigger ahora también corre al cambiar cuenta, centro o tipo. El
    código anterior no tiene cuenta ni centro en el formulario y no los
    manda al editar, pero manda `kind`: con el trigger nuevo, cualquier
    edición de una NC/ND sin cuenta o centro, en período abierto, guarda los
    de su origen. El rollback es seguro. Las ya guardadas sin cuenta o
    centro:
    `docs/pendientes/2026-11-04-gestion-nc-nd-edicion-insights-y-flota-ia-w9.md`.
  - `160201`: `ai_fleet_margin` suma dos columnas al final
    (`uninvoiced_freight`, `total_uninvoiced_freight`) con un `drop` y
    `create` en la misma transacción; ingreso y neto no cambian. El código
    anterior y `get_vehicle_margin` leen las columnas por nombre.
- [x] **Aprobar `20261104170000`, `170001` y `170002`** (auditoría w10,
      tesorería). No tocan filas existentes ni cambian políticas RLS.
  - `170000`: `payroll_payments_guard_transaction` también corre cuando
    cambia `entry_id`: un pago de sueldo queda en la liquidación en que se
    cargó. Rollback: el código anterior nunca actualiza `entry_id`.
  - `170001`: `guard_loan` deja cargar `import_run_id` solo desde
    `commit_import_run` y nunca lo cambia en un UPDATE;
    `guard_loan_installment_payment` no deja pasar una cuota a otro
    préstamo ni renumerar una cuota pagada. Rollback: el código anterior
    escribe `import_run_id` solo por el importador y no mueve ni renumera
    cuotas.
  - `170002`: trigger nuevo `storage_billing_runs_guard_delete`. Un período
    de almacenaje con una factura vigente (la vinculada, o la emitida bajo
    el id de su reserva) no se borra; `release_invoice_billing_links` lo
    sigue liberando porque corre con la factura ya fallida o anulada.
    Rollback: el código anterior borra solo reservas sin factura vinculada
    y sin factura viva bajo su id (emite con una clave al azar, o la
    emisión falló), así que esos borrados pasan.
- [x] **Aprobar `20261104170200` y `170201`** (auditoría w10, gestión). No
      tocan filas existentes. Rollback de cada una:
  - `170200`: el trigger de herencia de las NC/ND de compra deja como está
    lo que escribe `recategorize_expense`, así que recategorizar una NC/ND
    a «Sin cuenta» o «Sin centro» guarda el vacío. El código de
    producción de entonces (anterior a `94f942b`) no tiene «Recategorizar» ni llama a
    `recategorize_expense`: el rollback no cambia nada. Las recategorizadas
    a vacío antes de esto:
    `docs/pendientes/2026-11-04-gestion-recategorizar-nc-nd-y-flota-pendiente-por-cargas-w10.md`.
  - `170201`: `v_trip_revenue` suma `uninvoiced_shipments` al final
    (`create or replace`, mismas opciones y permisos). `ai_fleet_margin` y
    `get_vehicle_margin` suman columnas al final con `drop` y `create` en la
    misma transacción (permisos repuestos). `ai_fleet_margin` por vehículo
    trae además el grupo `none` («Sin vehículo»). El código anterior lee
    todo por nombre e ignora las columnas nuevas. Con el grupo `none`,
    `getFleetMargin` (asistente) del código anterior muestra por vehículo
    una fila «Sin vehículo», y sus totales (grupos, ingreso, neto) incluyen
    esos viajes (cosmético). El código de producción de entonces no llama a
    `get_vehicle_margin`. Corrección de los encabezados:
    `docs/pendientes/2026-11-04-lecturas-fallidas-y-notas-de-rollback-w11.md`.
- [x] **Aprobar `20261104190100`** (auditoría w11, RRHH). No toca filas
      existentes ni cambia políticas RLS.
      `enforce_payroll_period_immutability` pasa a `SECURITY DEFINER`:
      solo owner o admin (o el service role) sacan un período de
      `closed`, y una entry o un extra no se pasan de un período cerrado a
      otro. Rollback: el código anterior reabre solo por la action con
      `hr:admin` (owner/admin) y nunca mueve entries ni extras.
  - Con este deploy, la importación de ventas de ARCA vincula una NC sin
    `CbtesAsoc` solo a una factura de su moneda a la que le queda lugar, y
    no trae comprobantes en otra moneda que pesos o dólares
    (`lib/afip/sync-issued.ts`, sin migración; un rollback vuelve a vincular
    por total sin mirar lugar ni moneda). Producción tiene ventas y
    NC reales importadas de ARCA, y el cambio no las toca. Antes de
    promover, correr esta consulta de solo lectura (válida sobre el
    esquema de `20261102170000`). Lista cada NC de una factura cuyas NC
    suman más que su total, y cada NC vinculada por total a una factura de
    otra moneda. Lo que salga lo decide el dueño:
    `docs/pendientes/2026-11-04-fiscal-nc-por-total-y-liquidaciones-auditoria-w11.md`.

    ```sql
    with credited as (
      select n.invoice_origin_id as factura_id,
             sum(n.imp_total) as nc_total,
             count(*) as nc_count
        from public.invoices n
       where n.kind = 'nc'
         and n.invoice_origin_id is not null
         and n.status in ('draft', 'emitting', 'emitted')
       group by n.invoice_origin_id
    )
    select f.id as factura_id, f.punto_venta, f.cbte_tipo_afip as factura_tipo,
           f.numero as factura_numero, f.fecha as factura_fecha,
           f.moneda as factura_moneda, f.imp_total as factura_total,
           c.nc_total, c.nc_count,
           n.id as nc_id, n.cbte_tipo_afip as nc_tipo, n.numero as nc_numero,
           n.fecha as nc_fecha, n.moneda as nc_moneda, n.imp_total as nc_imp_total,
           (n.idempotency_key like 'arca-sync-%'
              and n.cbte_tipo_origen_afip is null) as vinculada_por_total,
           c.nc_total > f.imp_total + 0.01 as factura_acreditada_de_mas,
           n.moneda <> f.moneda as otra_moneda
      from public.invoices n
      join public.invoices f on f.id = n.invoice_origin_id
      join credited c on c.factura_id = f.id
     where n.kind = 'nc'
       and n.status in ('draft', 'emitting', 'emitted')
       and (c.nc_total > f.imp_total + 0.01
            or (n.idempotency_key like 'arca-sync-%'
                and n.cbte_tipo_origen_afip is null
                and n.moneda <> f.moneda))
     order by f.fecha, f.id, n.fecha, n.numero;
    ```
- [x] **Aprobar `20261104190300`, `190301` y `190302`** (auditoría w11,
      vínculos de facturación y cheques). No tocan filas existentes ni
      cambian políticas RLS.
  - `190300`: trigger nuevo `shipments_guard_invoice`. Una carga se vincula
    solo a una factura de su cliente que no falló ni se anuló.
    `link_freight_settlement_invoice` ya valida lo mismo, y
    `release_invoice_billing_links` solo limpia el vínculo. Rollback: el
    código de producción de entonces informa el rechazo como «La factura se
    emitió pero no se vinculó…» aunque la factura falló (cosmético),
    conserva la reserva 15 minutos y después emite otra factura (con clave
    al azar).
  - `190301`: funciones nuevas `storage_invoice_is_void` y
    `storage_billing_void_run_ids` (invoker, para `authenticated`).
    `claim_storage_billing_period`, `guard_storage_billing_run_delete` y
    `guard_storage_billing_run_invoice` se reemplazan desde su última
    versión. Una factura fiscal con NC emitidas por el total libera su
    período: la próxima reserva del cliente borra esos períodos ya
    existentes. Un período vinculado no suelta su factura. Rollback: misma
    firma de la reserva; el código anterior nunca cambia la factura de un
    período vinculado.
  - `190302`: trigger nuevo `checks_guard_import_run`. `import_run_id` de un
    cheque lo pone solo `commit_import_run` y no cambia. Rollback: el código
    de producción de entonces no tiene importador y nunca escribe la columna.
  - Consulta de control antes de aplicar (solo lectura): cuántos períodos
    libera `190301` en la próxima reserva de cada cliente.

    ```sql
    select r.id, r.client_id, r.period_start, r.period_end, i.imp_total,
           sum(n.imp_total) as credited
      from public.storage_billing_runs r
      join public.invoices i on i.id = r.invoice_id
      join public.invoicing_channels c on c.id = i.channel_id and c.is_fiscal
      join public.invoices n on n.invoice_origin_id = i.id
                            and n.kind = 'nc' and n.status = 'emitted'
     group by r.id, r.client_id, r.period_start, r.period_end, i.imp_total
    having sum(n.imp_total) >= i.imp_total - 0.01;
    ```
- [x] **Aprobar `20261104190200` y `190201`** (auditoría w11, gestión). No
      tocan filas existentes ni cambian políticas RLS. Rollback de cada una:
  - `190200`: `get_vehicle_margin` suma `uninvoiced_shipments` al final, con
    `drop` y `create` en la misma transacción (permisos repuestos: solo
    `service_role`). El código de producción de entonces no llama a
    `get_vehicle_margin`.
  - `190201`: trigger nuevo `purchase_invoices_nc_nd_follow_factura`. Al
    cambiar la cuenta o el centro de una factura de compra vigente, sus
    NC/ND vigentes que tenían el valor anterior lo siguen, como en
    «Recategorizar»; una NC/ND de un período cerrado rechaza el cambio de la
    factura. El código de producción de entonces no cambia cuenta ni centro
    desde «Modificar», así que el trigger no corre con él: el rollback no
    cambia nada. Las facturas ya editadas antes no se corrigen:
    `docs/pendientes/2026-11-04-gestion-margen-por-camion-nc-nd-y-escaneo-w11.md`.
  - Corrección de los encabezados de `190201`, `190300` y `190302`:
    `docs/pendientes/2026-11-04-notas-de-rollback-w11-y-controles-por-permiso-w12.md`.
- [x] **Aprobar `20261104194000`** (auditoría w12, vínculo de factura de
      cargas y liquidaciones). No toca filas existentes ni cambia políticas
      RLS.
  - Funciones nuevas `billing_invoice_is_void`, `billing_void_invoice_ids` y
    `claim_shipment_for_invoicing` (invoker, para `authenticated`).
    `storage_invoice_is_void` pasa a envoltorio de la primera, con la misma
    firma.
  - `guard_billed_shipment` (ahora `SECURITY DEFINER`),
    `guard_shipment_invoice` y `guard_freight_settlement` se reemplazan
    desde su última versión.
  - Efectos: una carga cuya factura fiscal se acreditó por el total se
    puede corregir y se libera en su próxima «Facturar flete»; una carga
    facturada no suelta su factura por PATCH; operaciones no vincula
    facturas; una NC interna ya no libera una liquidación.
  - Rollback: el código anterior reserva con un `update` (`invoice_id` nulo)
    y vincula solo después de reservar, como owner o admin. Una carga
    acreditada sigue facturada para él, como hoy.
  - Consulta de control antes de aplicar (solo lectura): las cargas que la
    próxima «Facturar flete» libera.

    ```sql
    select s.id, s.invoice_id, i.imp_total, sum(n.imp_total) as acreditado
      from public.shipments s
      join public.invoices i on i.id = s.invoice_id
      join public.invoicing_channels c on c.id = i.channel_id and c.is_fiscal
      join public.invoices n on n.invoice_origin_id = i.id
                            and n.kind = 'nc' and n.status = 'emitted'
     group by s.id, s.invoice_id, i.imp_total
    having sum(n.imp_total) >= i.imp_total - 0.01;
    ```

  - **N/A en producción:** las liquidaciones facturadas cuyo remito interno
    tiene NC internas por el total, que ya no se pueden cancelar.
    `freight_settlements` nace en `20261103090000`, que se aplicó en el
    mismo promote que esta migración: producción no tenía liquidaciones.
    Hoy la tabla existe en producción y la consulta corre.

    ```sql
    select fs.id, fs.invoice_id, i.imp_total, sum(n.imp_total) as acreditado
      from public.freight_settlements fs
      join public.invoices i on i.id = fs.invoice_id
      join public.invoicing_channels c on c.id = i.channel_id and not c.is_fiscal
      join public.invoices n on n.invoice_origin_id = i.id
                            and n.kind = 'nc' and n.status = 'emitted'
     where fs.status = 'invoiced'
     group by fs.id, fs.invoice_id, i.imp_total
    having sum(n.imp_total) >= i.imp_total - 0.01;
    ```
- [x] **Aprobar `20261104194001`** (auditoría w12, re-vínculos de
      almacenaje). No toca filas existentes ni cambia políticas RLS. Función
      nueva `claim_storage_billing_period_with_relinks` (invoker, para
      `authenticated`): la reserva de siempre, que además devuelve los
      períodos que re-vinculó. `claim_storage_billing_period` pasa a
      envoltorio, con la misma firma, resultado y errores. Rollback: el
      código anterior llama al envoltorio.
- [x] **Aprobar `20261104194100` y `194101`** (auditoría w12, RRHH y
      archivos). No tocan filas existentes ni objetos guardados.
  - `194100`: `enforce_payroll_period_immutability` se reemplaza desde
    `190100` y además corre `before insert` en `payroll_periods` (trigger
    nuevo `payroll_periods_enforce_immutability_insert`).
    `posts_employee_accounts` lo define solo la base: un usuario no lo cambia
    ni inserta un período con `false` (`service_role` sí). Rollback: el código
    anterior nunca escribe la columna.
  - `194101`: cambian las políticas `files_storage_insert` y
    `files_storage_delete` de `storage.objects` y la de INSERT de
    `public.files`; función nueva `files_storage_key_is_free` (DEFINER, para
    `authenticated`). La lectura (`files_storage_select`) no cambia, así que
    los archivos guardados se siguen viendo y firmando igual. Borra un blob
    quien lo subió (`owner_id`) u owner/admin; suben los roles con
    `files:write`, y nunca a una key que nombra una fila de otro usuario.
    Rollback: el código anterior sube con esos roles a keys nuevas y borra
    como quien subió o como owner/admin.
  - Consulta de control antes de aplicar (solo lectura): blobs que, con la
    política nueva, solo owner/admin pueden borrar (sin `owner_id` o con un
    `owner_id` distinto de quien registró la fila), y keys que nombran dos
    filas.

    ```sql
    select f.id, f.bucket_path, f.uploaded_by, o.owner_id
      from public.files f
      join storage.objects o on o.bucket_id = f.bucket and o.name = f.bucket_path
     where f.bucket = 'files'
       and f.source <> 'chat_attachment'
       and o.owner_id is distinct from f.uploaded_by::text;

    select bucket, bucket_path, count(*)
      from public.files
     group by bucket, bucket_path
    having count(*) > 1;
    ```
- [x] **Aprobar `20261104194200` y `194201`** (auditoría w12, gestión). No
      tocan filas existentes ni cambian políticas RLS ni permisos. Conviene
      promoverlas junto con `190201`. Rollback de cada una:
  - `194200`: `purchase_nc_nd_inherit_account` se reemplaza desde su última
    versión (`170200`). Tampoco rellena lo que fija el trigger
    `purchase_nc_nd_follow_factura`, así que una NC/ND que tenía la cuenta o
    el centro vacíos a propósito los mantiene vacíos cuando se edita la
    factura. Un rollback de código deja la función nueva, y el «Modificar»
    de producción de entonces no manda `account_id` ni `cost_center_id`: el
    trigger de seguimiento no corre y no se rellena nada.
  - `194201`: `ai_fleet_margin` se reemplaza (`create or replace`, misma
    firma y mismos permisos). Por cliente, `uninvoiced_shipments` suma las
    cargas sin facturar y sin flete de otros clientes en sus viajes.
    `total_uninvoiced_shipments` no cambia. El código de producción de
    entonces no lee `uninvoiced_shipments` (su `ai_fleet_margin` no lo tenía) y lee
    las demás columnas por nombre: el rollback no cambia nada.
    `docs/pendientes/2026-11-04-gestion-nc-nd-vacia-y-reparto-por-cliente-w12.md`.
  - Corrección de los encabezados de `194200` y `194201`:
    `docs/pendientes/2026-11-05-notas-de-rollback-w12-auditoria-w13.md`.

## Pendientes para el próximo promote

Migraciones de `main` que todavía no están en `production-latest`. Cada rama
que agrega una migración suma su ítem al final de esta sección.

- [ ] **Aprobar `20261105090000` y `090001`** (auditoría w13, vínculos de
      facturación y flota). No tocan filas existentes ni cambian políticas
      RLS. Van después de `20261103090000`, `20261103090100`,
      `20261104030000`, `20261104194000` y `20261104194201`, de las que
      reemplazan funciones.
  - `090000`: `guard_shipment_freight_settlement`,
    `guard_shipment_driver_settlement` y `guard_trip_driver_settlement` se
    reemplazan desde su última versión, con el mismo cuerpo, y pasan a
    `SECURITY DEFINER` (siguen revocadas de `public`, `anon` y
    `authenticated`). Operaciones ya no cambia cliente, estado, flete,
    cobranza ni viaje de una carga de una liquidación o rendición viva, ni
    el chofer de su viaje. Rollback: el código anterior hace los mismos
    `update` y recibe el mensaje de la guarda (hint `jouve_guard`), como ya
    le pasaba a owner.
  - `090001`: función nueva `shipment_invoice_is_void` (`SECURITY DEFINER`,
    para `authenticated` y `service_role`; responde solo a owner, admin,
    operations y el service role). `v_trip_revenue`, `ai_fleet_margin` y
    `ai_shipments_summary` se reemplazan con las mismas columnas, firmas y
    permisos. Una carga cuya factura ya no la factura cuenta como por
    facturar. Rollback: el código anterior lee las mismas columnas.
  - Consulta de control antes de aplicar (solo lectura, válida sobre el
    esquema de producción): las cargas que pasan de facturadas a por
    facturar, porque su factura fiscal tiene NC emitidas por el total o
    porque su factura falló o se anuló.

    ```sql
    select s.id, s.trip_id, s.freight_amount, i.id as invoice_id, i.status,
           i.imp_total, coalesce(sum(n.imp_total), 0) as acreditado
      from public.shipments s
      join public.invoices i on i.id = s.invoice_id
      join public.invoicing_channels c on c.id = i.channel_id
      left join public.invoices n on n.invoice_origin_id = i.id
                                 and n.kind = 'nc' and n.status = 'emitted'
     where s.status <> 'cancelled'
     group by s.id, s.trip_id, s.freight_amount, i.id, i.status, i.imp_total,
              c.is_fiscal
    having i.status in ('failed', 'cancelled')
        or (c.is_fiscal
            and coalesce(sum(n.imp_total), 0) >= i.imp_total - 0.01);
    ```

    `docs/pendientes/2026-11-05-facturacion-y-flota-auditoria-w13.md`.
- [ ] **Aprobar `20261105090100`** (auditoría w13, archivos). Va después de
      `20261104194101`. No toca filas existentes ni objetos guardados.
  - Cambia la política «Roles with files:read can view files» de
    `public.files`: un archivo que nada vincula (sin adjunto, sin extracción
    de Document Intelligence, sin documento de RRHH ni de flota) solo lo ven
    quien lo subió y owner/admin. Como `files_storage_select` sigue a esa
    fila, lo mismo vale para sus bytes. Función nueva `is_linked_file`
    (DEFINER, para `authenticated`).
  - `files_storage_key_is_free` se reemplaza: una key que nombra cualquier
    fila, también una propia, ya no se puede volver a subir.
  - Los archivos vinculados se leen igual. Subir y vincular sigue
    funcionando porque quien sube es quien vincula.
  - Rollback: el código anterior sube a keys nuevas y vincula como quien
    subió. Los escaneos reemplazados que deja quedan ocultos hasta el
    barrido de las 03:00.
  - Consulta de control antes de aplicar (solo lectura): archivos que nada
    vincula y que, con la política nueva, dejan de ver los demás roles.

    ```sql
    select f.id, f.original_filename, f.source, f.uploaded_by, f.created_at
      from public.files f
     where not exists (select 1 from public.file_attachments fa where fa.file_id = f.id)
       and not exists (select 1 from public.ai_document_extractions e where e.file_id = f.id)
       and not exists (select 1 from public.employee_documents d where d.attachment_file_id = f.id)
       and not exists (select 1 from public.fleet_documents d where d.attachment_file_id = f.id)
     order by f.created_at desc;
    ```

  - `docs/pendientes/2026-11-05-archivos-y-escaneo-auditoria-w13.md`.
- [ ] **Aprobar `20261105100000`–`100002`** (auditoría w14, borradores sin
      ítems, ingreso de flota y totales de listados). Van después de
      `20261105090001`, de la que reemplazan funciones. Ninguna toca filas
      al aplicarse ni cambia políticas RLS.
  - `100000`: función nueva `fail_itemless_invoice_drafts`
    (`SECURITY DEFINER`, solo `service_role`). Desde el deploy,
    `issue-invoice-reconcile` marca **fallido**, cada 15 minutos, todo
    borrador con más de 15 minutos y sin ítems, con el motivo en
    `afip_observaciones`. Eso libera su remito interno, período de mora,
    cargas (se desvinculan), períodos de almacenaje (se borran) o
    liquidación (vuelve a confirmada). En producción afecta a los que
    devuelva la consulta de abajo, 50 por corrida. Rollback: el
    código anterior no llama a la función y vuelve a saltear esos
    borradores. Los que ya pasaron a fallido quedan fallidos (no se
    revierte).
  - Consulta de control antes de promover (solo lectura, válida sobre el
    esquema de producción): los borradores sin ítems que el reconciliador
    va a marcar fallidos y lo que cada uno retiene.

    ```sql
    select i.id, i.channel_id, i.kind, i.client_id, i.imp_total, i.created_at,
           i.source_remito_id,
           exists (select 1 from public.shipments s where s.invoice_id = i.id) as cargas,
           exists (select 1 from public.storage_billing_runs r where r.invoice_id = i.id) as almacenaje,
           exists (select 1 from public.freight_settlements f where f.invoice_id = i.id) as liquidacion,
           exists (select 1 from public.late_interest_charges lc
                    where lc.id::text = i.idempotency_key) as interes_por_mora
      from public.invoices i
     where i.status = 'draft'
       and i.created_at < now() - interval '15 minutes'
       and not exists (select 1 from public.invoice_items it where it.invoice_id = i.id)
     order by i.created_at;
    ```

  - `100001`: función nueva `shipment_invoice_billed_ratio`
    (`SECURITY DEFINER`, para `authenticated` y `service_role`; responde
    solo a owner, admin, operations y el service role). `v_trip_revenue` y
    `ai_fleet_margin` se reemplazan con las mismas columnas, firmas y
    permisos. `ai_shipments_summary` se borra y se recrea con dos columnas
    nuevas al final (`invoiced_freight`, `unpriced`) y los mismos permisos.
    Una carga de una factura fiscal con NC o ND emitidas cuenta en el
    ingreso de flota por la parte que su factura todavía factura. Rollback:
    el código anterior lee las columnas por nombre y recibe las cifras
    nuevas.
  - Consulta de control antes de promover (solo lectura, válida sobre el
    esquema de producción): las cargas cuyo ingreso de flota cambia, con el
    flete que van a contar.

    ```sql
    with adj as (
      select n.invoice_origin_id as invoice_id,
             coalesce(sum(n.imp_total) filter (where n.kind = 'nc'), 0) as acreditado,
             coalesce(sum(n.imp_total) filter (where n.kind = 'nd'), 0) as debitado
        from public.invoices n
       where n.status = 'emitted'
         and n.kind in ('nc', 'nd')
         and n.invoice_origin_id is not null
         and not exists (select 1 from public.late_interest_charges lc
                          where lc.nd_invoice_id = n.id or lc.id::text = n.idempotency_key)
       group by n.invoice_origin_id
    )
    select s.id, s.trip_id, s.freight_amount, i.id as invoice_id, i.imp_total,
           a.acreditado, a.debitado,
           round(coalesce(s.freight_amount, 0)
                 * greatest(0, (i.imp_total - a.acreditado + a.debitado) / i.imp_total), 2)
             as flete_que_cuenta
      from public.shipments s
      join public.invoices i on i.id = s.invoice_id
      join public.invoicing_channels c on c.id = i.channel_id and c.is_fiscal
      join adj a on a.invoice_id = i.id
     where s.status <> 'cancelled'
       and i.status not in ('failed', 'cancelled')
       and i.imp_total > 0
       and a.acreditado < i.imp_total - 0.01
     order by s.trip_id, s.id;
    ```

  - `100002`: función nueva `like_contains_pattern` (invoker, inmutable,
    para `authenticated` y `service_role`). `invoice_list_totals` y
    `receipt_list_totals` se reemplazan con las mismas firmas y permisos;
    el nombre del cliente se busca como en sus listados (`%`, `_` y `\`
    literales, `*` un carácter). Rollback: el código anterior pasa el mismo
    término y obtiene la regla nueva. Sin consulta de control: no cambia
    datos y solo cambian los totales de una búsqueda con `%`, `_` o `*`.
  - `docs/pendientes/2026-11-05-facturacion-y-flota-auditoria-w14.md`.
- [ ] **Aprobar `20261105100100`** (auditoría w14, archivos por registro).
      Va después de `20261105090100`. No toca filas existentes ni objetos
      guardados: cambia quién los lee.
  - Cambia dos políticas de lectura:
    - «Roles with files:read can view file_attachments»: un adjunto lo ve
      quien lee el registro al que apunta. Compras, comprobantes, recibos,
      órdenes de pago, cheques, movimientos e impuestos: owner, admin y
      finance. Clientes y proveedores: además operations. Combustible:
      owner, admin y operations. Chat: el dueño de la sesión u owner/admin.
    - «Roles with files:read can view files»: un archivo lo ven quien lo
      subió, owner/admin, o quien lee alguno de los registros que lo tienen.
      Un escaneo es de quien lo escaneó.
  - Como `files_storage_select` sigue a la fila, los bytes siguen la misma
    regla. El contador mantiene los adjuntos de impuestos (`20261104050400`
    no cambia). Owner y admin no pierden nada.
  - Quién pierde acceso: operations pierde los adjuntos de finanzas y los
    escaneos de otros usuarios. Warehouse pierde todo lo que no subió (no
    tiene pantalla que liste archivos). Finance pierde los tickets de
    combustible y los escaneos de otros usuarios.
  - Rollback: el código anterior lee las mismas tablas y ve menos filas. Su
    «Eliminar» cuenta los vínculos con el cliente del usuario. No borra un
    archivo en uso, porque los únicos archivos con varios vínculos son
    escaneos convertidos en documentos de finanzas, y quien puede quitar uno
    de esos vínculos los ve todos.
  - Consulta de control antes de aplicar (solo lectura, schema de
    `production-latest`). Lista, por cada usuario que no es owner/admin, los
    archivos que hoy lee y deja de leer, agrupados por los registros que los
    tienen.
    - `linked_to = {}`: archivo que nada vincula. Ya lo oculta
      `20261105090100` si se promueve junto.
    - No cuenta los archivos que el usuario subió: los sigue viendo.
    - Si alguien necesita alguno de esos archivos, darle el rol que lee el
      registro.

    ```sql
    with user_role_sets as (
      select ur.user_id, array_agg(ur.role_id::text order by ur.role_id) as roles
        from public.user_roles ur
       group by ur.user_id
    ),
    links as (
      select fa.file_id,
             case
               when fa.purchase_invoice_id is not null then 'purchase_invoice'
               when fa.invoice_id          is not null then 'invoice'
               when fa.receipt_id          is not null then 'receipt'
               when fa.payment_order_id    is not null then 'payment_order'
               when fa.check_id            is not null then 'check'
               when fa.issued_check_id     is not null then 'issued_check'
               when fa.client_id           is not null then 'client'
               when fa.supplier_id         is not null then 'supplier'
               when fa.transaction_id      is not null then 'transaction'
               when fa.fuel_load_id        is not null then 'fuel_load'
               when fa.tax_document_id     is not null then 'tax_document'
               when fa.ai_chat_message_id  is not null then 'ai_chat_message'
             end as entity_type,
             s.user_id as owner_id
        from public.file_attachments fa
        left join public.ai_chat_messages m on m.id = fa.ai_chat_message_id
        left join public.ai_chat_sessions s on s.id = m.session_id
      union all
      select e.file_id, 'ai_document', e.created_by
        from public.ai_document_extractions e
      union all
      select d.attachment_file_id, 'employee_document', null
        from public.employee_documents d
       where d.attachment_file_id is not null
      union all
      select d.attachment_file_id, 'fleet_document', null
        from public.fleet_documents d
       where d.attachment_file_id is not null
    ),
    -- Roles sin owner/admin que leen cada registro (lib/auth/permissions.ts).
    read_roles (entity_type, roles) as (
      values
        ('purchase_invoice',  array['finance']),
        ('invoice',           array['finance']),
        ('receipt',           array['finance']),
        ('payment_order',     array['finance']),
        ('check',             array['finance']),
        ('issued_check',      array['finance']),
        ('transaction',       array['finance']),
        ('tax_document',      array['finance']),
        ('employee_document', array['finance']),
        ('client',            array['finance', 'operations']),
        ('supplier',          array['finance', 'operations']),
        ('ai_chat_message',   array['finance', 'operations']),
        ('ai_document',       array['finance', 'operations']),
        ('fuel_load',         array['operations']),
        ('fleet_document',    array['operations'])
    ),
    lost as (
      select u.user_id, u.roles, f.original_filename,
             array(select distinct l.entity_type from links l
                    where l.file_id = f.id order by 1) as linked_to
        from user_role_sets u
        cross join public.files f
       where not (u.roles && array['owner', 'admin'])
         -- Lo lee hoy (política de 20261031204119).
         and u.roles && array['finance', 'operations', 'warehouse']
         and f.source <> 'chat_attachment'
         and ('finance' = any (u.roles)
              or not exists (select 1 from links l
                              where l.file_id = f.id
                                and l.entity_type = 'employee_document'))
         and ('operations' = any (u.roles)
              or not exists (select 1 from links l
                              where l.file_id = f.id
                                and l.entity_type = 'fleet_document'))
         -- Y deja de leerlo.
         and f.uploaded_by is distinct from u.user_id
         and not exists (
           select 1 from links l
             join read_roles r on r.entity_type = l.entity_type
            where l.file_id = f.id
              and u.roles && r.roles
              and (l.entity_type not in ('ai_chat_message', 'ai_document')
                   or l.owner_id = u.user_id)
         )
    )
    select au.email, lost.roles, lost.linked_to, count(*) as archivos,
           (array_agg(lost.original_filename order by lost.original_filename))[1:3] as ejemplos
      from lost
      left join auth.users au on au.id = lost.user_id
     group by au.email, lost.roles, lost.linked_to
     order by au.email, archivos desc;
    ```

  - `docs/pendientes/2026-11-05-archivos-por-registro-auditoria-w14.md`.
- [ ] **Aprobar `20261105120100`** (auditoría w15, flota: ND acreditadas).
      Va después de `20261104194000` y `20261105100001`, de las que
      reemplaza funciones. No toca filas al aplicarse ni cambia políticas
      RLS.
  - Función nueva `billing_invoice_live_debits` (invoker, para
    `authenticated` y `service_role`): lo que todavía facturan las ND de
    flete de una factura, cada una neta de sus propias NC.
  - `billing_invoice_is_void` (misma firma, invoker y permisos): una factura
    fiscal queda anulada cuando sus NC suman su total más esas ND. Una
    factura acreditada por el total con una ND de flete viva deja de leerse
    anulada: su carga, liquidación o período de almacenaje siguen
    facturados.
  - `shipment_invoice_billed_ratio` (misma firma, definer y permisos): cada
    ND cuenta neta de sus NC.
  - Rollback: el código anterior llama a las mismas funciones con los
    mismos argumentos y lee las respuestas nuevas.
  - Consulta de control antes de aplicar (solo lectura, válida sobre el
    esquema de producción): las facturas fiscales acreditadas por el total
    con una ND de flete viva, que dejan de leerse anuladas, y lo que
    retiene cada una.

    ```sql
    with adj as (
      select i.id, i.imp_total,
             coalesce((select sum(n.imp_total) from public.invoices n
                        where n.invoice_origin_id = i.id
                          and n.kind = 'nc' and n.status = 'emitted'), 0) as acreditado,
             coalesce((select sum(greatest(0, d.imp_total - coalesce((
                               select sum(n.imp_total) from public.invoices n
                                where n.invoice_origin_id = d.id
                                  and n.kind = 'nc' and n.status = 'emitted'), 0)))
                         from public.invoices d
                        where d.invoice_origin_id = i.id
                          and d.kind = 'nd' and d.status = 'emitted'
                          and not exists (
                            select 1 from public.late_interest_charges lc
                             where lc.nd_invoice_id = d.id
                                or lc.id::text = d.idempotency_key)), 0) as nd_vivas
        from public.invoices i
        join public.invoicing_channels c on c.id = i.channel_id
       where c.is_fiscal
         and i.status not in ('failed', 'cancelled')
    )
    select a.id, a.imp_total, a.acreditado, a.nd_vivas,
           (select count(*) from public.shipments s where s.invoice_id = a.id) as cargas,
           (select count(*) from public.storage_billing_runs r where r.invoice_id = a.id) as almacenaje,
           (select count(*) from public.freight_settlements f
             where f.invoice_id = a.id and f.status <> 'cancelled') as liquidaciones
      from adj a
     where a.acreditado >= a.imp_total - 0.01
       and a.acreditado < a.imp_total + a.nd_vivas - 0.01;
    ```

  - `docs/pendientes/2026-11-05-flota-nd-acreditadas-auditoria-w15.md`.

## Después de promover

- [ ] Correr `ai-workflows-reconcile` a mano una vez, desde el dashboard de
      Inngest. El deploy saca el cron `ai-workflows-materialize` de 15
      minutos y las tareas de IA existentes no tienen scheduler durmiendo
      hasta la pasada de las 04:52; sin la corrida manual, las que vencen
      antes corren tarde. Lo mismo después de un rollback y vuelta adelante
      (`docs/pendientes/2026-11-04-tareas-ia-por-eventos.md`).
      **Ya corresponde:** el promote de `94f942b` (2026-11-05) sacó
      `ai-workflows-materialize`. Owner: marcá este ítem cuando la hayas
      corrido.
- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a
      2026-11-04).** Las NC de compras a cargo de empleados que `102300`
      dejó con su asiento viejo por período cerrado: ítem **Después de
      promover** en
      `docs/pendientes/2026-11-04-auditoria-w2-rrhh-gestion-y-rendiciones.md`.
