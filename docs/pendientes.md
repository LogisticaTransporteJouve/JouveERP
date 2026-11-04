# Pendientes y faltantes — JouveERP

> Lista de trabajo vigente: lo que falta (código, datos y configuración) son
> los ítems `[ ]` de **Antes de promover**, de **Límites de rollback** y de
> todas las secciones fechadas, que siguen a las §1–§4 (la más nueva arriba).
> Las §1–§4 son el cierre de la tanda 2026-07-04 y quedan
> como historia: sus cifras y su "backlog vacío" son de esa fecha. Cuando se
> resuelve un punto, se marca acá y se sincroniza el roadmap.

> **Tanda 2026-07-04** — surgió de una auditoría docs vs código (roadmap,
> `docs/*`, `features/*`, migraciones, tests). Tanda de cierre (PRs #195–#201): mappers
> crear-desde-escaneo para **todos** los tipos con destino (recibo, OP, factura
> de venta, NC/ND de compra), **asientos manuales** + cuenta RECPAM + aplicación
> RG 4667, **tarifas de storage versionadas** (aumento % + snapshot en cada
> facturación), **flujo de caja con USD** al TC oficial, **L.6 export Libro IVA
> Digital** (TXT posicional) y **L.7 CAEA** de contingencia. Con esto el
> backlog de código quedó **vacío a esa fecha**.

> **pgTAP.** CI (job `database`) aplica todas las migraciones sobre un stack
> fresco y corre `supabase test db` en cada PR: los ítems "sin verificar
> contra datos de producción" de abajo quieren decir sin datos de producción
> y sin probar en el navegador, no sin pgTAP.

---

## Antes de promover

Lo que el owner revisa y aprueba antes de correr **Promote to production**
con cualquier commit posterior a `production-latest` que traiga estas
migraciones (#339–#351 y la auditoría w3). Las consultas son de solo lectura
y se corren en el SQL editor de producción **antes** de promover, sobre el
schema que hay hoy (sin las migraciones de esta lista):
`promote-to-production.yml` aplica todas las migraciones pendientes juntas.
Las de cada sección más vieja siguen con su ítem "Aprobar …" en su sección.

**Estado de producción (owner, 2026-11-04):** la base tiene solo clientes y
facturas de venta en pesos: ni recibos, ni comprobantes en dólares, ni
compras, cheques, órdenes de pago, préstamos, planillas o movimientos de
empleados. Todo backfill sobre esas tablas es un no-op en producción y no
hace falta re-asentar nada viejo. Los ítems de revisión de esos datos quedan
marcados **N/A en producción** con su SQL (sirven si se promueve sobre otra
base). La única revisión real que queda antes de promover es la lista de
borradores del reconciliador (#340), que revisa el owner. Los ítems
"Aprobar …" de cada migración (irreversibles y límites de rollback) siguen
vigentes.

- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Antes de aprobar `20261104096400`** (#339, exento, no gravado y
      tributos por compra): el backfill pasa el `imp_trib` de cada compra a
      percepción de IIBB. El asiento no cambia, pero el TXT del libro IVA
      Compras de un período ya presentado declara esos tributos en el campo de
      IIBB y no en "Otros tributos": lo aprueban el dueño y el contador
      (`docs/decisions.md`). Compras que cambian, por período:
      `select to_char(fecha, 'YYYY-MM') as periodo, count(*), sum(imp_trib) from purchase_invoices where imp_trib <> 0 group by 1 order by 1;`
- [ ] **Aprobar `20261104096200`–`20261104096700`** (#339). `096200` agrega
      el rol `percepciones_iva_pagadas` al enum del plan de cuentas: no se
      puede quitar. Rollback: un trigger pasa a IIBB el `imp_trib` que manda
      el código anterior, pero cambiar los tributos desde el código anterior en
      una compra que ya los tiene repartidos (percepción de IVA, municipales o
      internos) se rechaza ("Los tributos no suman…"); el código anterior no
      ve el exento ni el no gravado. Con código anterior a #339 no editar la
      cuenta "Percepciones IVA sufridas" en Plan de cuentas (no conoce el
      rol, como "Diferencias de cambio" abajo).
- [ ] **Reconciliador de emisiones** (#340, `issue-invoice-reconcile`, sin
      migración). **Revisión real: el owner revisa la lista de borradores de
      abajo antes de promover.** Su primera corrida vuelve a mandar a AFIP los borradores de
      los últimos 3 días y resuelve las emisiones trabadas que ya existen. Un
      borrador que el usuario ya volvió a facturar con otro comprobante se
      borra antes, o se emitiría dos veces:
      `select id, status, created_at, updated_at from invoices where (status = 'draft' and created_at > now() - interval '3 days') or status = 'emitting';`
- [ ] **Aprobar `20261104090500`** (#340, importación de ARCA en período
      cerrado). Rollback: es un trigger; con código anterior la importación
      guarda igual el comprobante y deja su asiento en
      `pending_journal_entries`. Sin #340 el cron de reconciliación no corre.
- [ ] **Aprobar `20261104092000`–`20261104092300`** (#342: cheques en
      percibido, "Sin clasificar" en el margen por camión, deshacer pago de
      impuestos, NC/ND que siguen a su compra). Rollback: mismas firmas y
      columnas; el código anterior ya conoce los rubros de gestión, ignora la
      clave nueva de `recategorize_expense` y no escribe las columnas
      `payment_previous_*` (un impuesto pagado con código nuevo, deshecho y
      vuelto a pagar con el viejo conserva los valores del primer pago).
- [ ] **Aprobar `20261104093000`–`20261104093400`** (#343, tesorería).
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
- [ ] **Aprobar `20261104094000`–`20261104094300`** (#344). `094000` agrega
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
- [ ] **Aprobar `20261104095000`–`20261104095300`** (#345). Rollback: el
      código anterior llama a las RPC de la rendición con sus argumentos
      viejos (resuelven a las nuevas con "a cargo del chofer"), lista un
      faltante asentado como adelanto como "sin asentar" (volver a asentar
      devuelve el mismo), rechaza asentar un sobrante al chofer y no ve
      `embargo_override` (el trigger lo respeta igual).
- [ ] **Aprobar `20261104096000`** (insights) **y `20261104096100`**
      (denegaciones de permisos quitados) (#346). Sin la primera, el analista
      falla (no existe el RPC) y las tarjetas quedan como estaban. Rollback:
      el código anterior borra e inserta con el service client; el índice
      único hace fallar el insert de dos corridas viejas simultáneas en vez de
      duplicar las tarjetas. La segunda solo inserta denegaciones de la
      escritura que cubría cada `:read` quitado; las filas viejas quedan y el
      código anterior las lee como antes.
- [ ] **Aprobar `20261104100000`–`20261104100300`** (#350, emisión AFIP).
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
- [ ] **Aprobar `20261104101000`–`20261104101400`** (#351, tesorería).
      - Los cheques USD de proveedores y las cuotas de préstamos USD **nuevos**
        se asientan a la cotización de la OP y del desembolso.
      - Los asientos ya existentes no se reasientan. Reasentarlos cambia
        períodos pasados y lo decide el dueño.
      - Las cuentas con movimientos quedan con moneda, tipo y saldo inicial
        congelados.
      - Un rechazo de cheque con fecha en un período cerrado ahora se rechaza
        (antes se asentaba con fecha de hoy).

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
      **después** de promover (sección de #349 más abajo).
- [ ] **Aprobar `20261104102000`–`20261104102400`** (#349, RRHH y Gestión).
      - `102000` reescribe `management_pnl_lines`. Las diferencias de cambio
        pasan a "Intereses" (fuera del margen operativo), y en las cuotas sin
        desglose los intereses ya no cuentan como capital.
      - `102100` corrige el mensaje de la rendición.
      - `102400` reescribe `sync_automatic_tasks` sobre la versión de `101400`.

      Rollback: el código anterior lee las mismas columnas; Gestión con
      código viejo muestra los mismos buckets.
- [ ] **Aprobar `20261104104000`** (valida seis CHECK que habían quedado
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
      `select pi.id, pi.fecha, pi.letter, pi.punto_venta, pi.numero, pi.imp_total - (pi.imp_neto + pi.imp_iva + pi.imp_trib + pi.imp_no_gravado + pi.imp_op_exentas) as gap, exists (select 1 from public.accounting_closed_periods cp where cp.period = to_char(pi.fecha, 'YYYY-MM')) as closed from public.purchase_invoices pi where pi.status = 'received' and public.is_channel_fiscal(pi.channel_id) and abs(pi.imp_total - (pi.imp_neto + pi.imp_iva + pi.imp_trib + pi.imp_no_gravado + pi.imp_op_exentas)) > 0.01 order by pi.fecha;`
      Rollback: el código anterior escribe las mismas columnas; una compra
      fiscal que no cierra recibe el mensaje del guard.
- [x] **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a 2026-11-04).** **Decidir las compras fiscales B y C con IVA** (auditoría w3, S1 F2;
      no se cambian datos). Las cargadas antes de #339 pueden tener IVA,
      exento o no gravado aparte: el libro IVA, el estimado y `iva_credito`
      cuentan ese IVA como crédito fiscal y el TXT no. El dueño y el contador
      deciden si se pliegan al neto en los períodos abiertos (re-asienta) y
      qué hacer con las de períodos cerrados. Contarlas:
      `select exists (select 1 from public.accounting_closed_periods cp where cp.period = to_char(pi.fecha, 'YYYY-MM')) as closed, count(*), sum(pi.imp_iva) as iva from public.purchase_invoices pi where pi.status = 'received' and pi.letter in ('B', 'C') and public.is_channel_fiscal(pi.channel_id) and pi.imp_iva + pi.imp_no_gravado + pi.imp_op_exentas > 0 group by 1;`
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
      Rollback: mismas funciones y argumentos; el código anterior lee el
      movimiento nuevo como cualquier movimiento de cheque propio.
- [ ] **Aprobar `20261104113000`–`20261104113002`** (percepciones de
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

## Límites de rollback (vigentes)

Un rollback de código vuelve a un SHA anterior sin revertir migraciones
(`CONTRIBUTING.md`, "Deploy y rollback"). Estos cambios no tienen
mitigación en el schema: el límite se respeta operando.

- [ ] **SAC** (`20261103050100_payroll_sac_periods`, #315 `f71136f`): no
      crear un período SAC (junio o diciembre) hasta que el deploy quede
      firme. El código anterior busca el período por año y mes, sin `kind`:
      con el SAC creado, la planilla de ese mes falla (`maybeSingle` ve dos
      filas) y el listado muestra el mes dos veces. Con un SAC ya creado, no
      volver a un SHA anterior a #315.
- [ ] **Tarifas de almacenaje migradas** (`20261104080500`, #337 `bf8b975`):
      el código anterior **no** puede editar una fila migrada (el guard
      rechaza precio, vigencia y cliente; la nota de rollback de la migración
      dice lo contrario y está mal). Su "Aumentar %" no filtra las migradas:
      inserta las filas aumentadas (para un cliente migrado no cambia nada,
      el tarifario las pisa), pero el cierre de las viejas va por lotes y el
      guard rechaza el lote entero, también las no migradas: quedan dos
      filas vigentes por cliente y la acción igual avisa que aplicó. Con
      código anterior a #337, no usar "Aumentar %" (aumentar desde el
      tarifario del cliente).

## 1. Lo único pendiente a 2026-07-04 (configuración, no código)

- [ ] **Email del aging semanal — env vars.** El cableado por Resend está
      shippeado (`lib/email/client.ts`); faltan `RESEND_API_KEY`, `EMAIL_FROM`
      y `FINANCE_EMAIL` en el entorno de producción. Sin ellas el cron loguea y
      saltea el envío (graceful).
- [ ] **CAEA — alta del punto de venta de contingencia.** Todo el flujo (código
      por quincena, emisión offline, régimen informativo) está shippeado, pero
      requiere crear una única vez el PV **"CAEA — Contingencias"** en
      _Administración de Puntos de Venta y Domicilios_ de ARCA. Hasta entonces
      `FECAEASolicitar` responde 15003 y el panel de `/admin/afip` lo muestra.
- [ ] **Tarifas de storage — cargar los valores reales.** El CRUD + versionado
      está; los importes vigentes son estimados hasta que se confirmen con el
      cliente. Se actualizan con "Aumentar %" o editando desde
      `/storage-tariffs`.

## 2. Cerrado en la tanda 2026-07-04

- [x] **Document Intelligence — crear desde escaneo** para recibo, orden de
      pago, factura de venta (emite por el flujo normal, con guard de
      duplicados) y NC/ND de compra (#195). Remitos quedan como archivo (no hay
      entidad remito en el ERP); extractos van por conciliación.
- [x] **Asientos manuales** (`source_table = null`) + cuenta **RECPAM 4.2.2** + aplicación **RG 4667** (generar/vincular/desvincular asiento desde la
      página de inflación) (#196). Decisión: el ajuste se calcula afuera y se
      carga manual — no hay RPC de reexpresión automática.
- [x] **H.5 tarifas** — snapshot de tarifas aplicadas en `storage_billing_runs` + aumento masivo por % con historial (#197). La emisión AFIP de storage ya
      estaba cableada vía `issueFiscalInvoiceAction` (el doc estaba desactualizado).
- [x] **Flujo de caja USD** — cuentas, cheques, aging, recurrentes y cuotas en
      USD convertidos al último TC oficial; las vistas de aging ahora exponen
      `moneda` (#198). Antes los USD del aging se sumaban como si fueran ARS.
- [x] **L.6 — export Libro IVA Digital** (TXT posicional, diseño RG 3685;
      importable en Portal IVA / IVA Simple RG 5705) (#199).
- [x] **L.7 — CAEA contingencia** (RG 5782/2025): solicitud por quincena,
      emisión offline en PV de contingencia, régimen informativo automático,
      QR con `tipoCodAut A`, panel admin (#200).

## 3. Descartados (decisiones)

- [x] ~~**M.5** — aprobaciones de montos altos~~ (decisión #20, 2026-06-22).
- [x] ~~**M.6** — portal cliente~~ (decisión #19, 2026-06-22).
- [x] ~~**RAG / embeddings (pgvector)**~~ (decisión 2026-07-04): infra paga
      nueva sin caso de uso; la FTS `search_global` cubría free-text (retirada
      2026-11-04).
- [x] ~~**Write-tools IA + NL→SQL**~~ (decisión 2026-07-04): el agente queda
      read-only; las escrituras pasan por los flujos normales con confirmación
      humana (Document Intelligence incluida). Vale a 2026-07-04: hoy el
      chat tiene propuestas que escriben tras confirmar; solo las corridas
      headless siguen read-only.

## 4. Hecho anteriormente (referencia)

- [x] **AI.0–AI.8** completo (chat + 25 tools a 2026-07-04 + persistencia + artifacts +
      medidor/tope + Document Intelligence + insights proactivos) + anomalías,
      conciliación de extractos y skills de chat.
- [x] **Fase K** (compras/pagos), **Fase L** (contabilidad, ahora completa),
      **Fase N** (RRHH), **Fase G** (flota), **Fase H** (pallets/depósito),
      **Fase R** (pagos recurrentes), **Treasury**, **M.2 multimoneda**
      (exchange_rates + cron BCRA + asientos multimoneda).
- [x] Tests (a 2026-07-04): 47/47 dominios con `schema.test.ts`; matriz de permisos con
      cobertura 100%.

---

## Búsqueda global retirada (2026-11-04)

- [x] Sale la búsqueda global ⌘K: UI, `searchGlobalAction`, la herramienta
      `searchGlobal` del AI CFO y la función Inngest `search-index-refresh`
      (`docs/decisions.md`). Solo código; la DB no cambia.
- [ ] **Migración de contrato:** borrar la vista materializada
      `search_index`, `search_global`, `refresh_search_index*`, los triggers
      `search_index_mark_dirty` y `search_index_state` cuando la próxima
      promoción quede firme. Con ella, sacar los pgTAP que los cubren
      (`supabase/tests/user_access_test.sql`, `receipts_letter_x_test.sql`,
      `definer_hardening_test.sql`, `schema_rls_and_grants_test.sql`) y
      regenerar `lib/db/database.types.ts`. Después ya no se puede volver a un
      SHA anterior a este cambio.
## Decisiones del owner, tanda 1 (2026-11-04)

- [x] Producción sin compras, cheques, OP, préstamos, RRHH, recibos ni
      comprobantes en dólares: los ítems de esos datos en **Antes de
      promover** quedan N/A con su SQL (`docs/decisions.md`).
- [x] Pagos de planilla, borrar un movimiento de la cuenta corriente con
      caja y pagar la deuda de un cheque vendido piden `transactions:write`;
      el botón queda oculto o deshabilitado con el motivo.
- [x] Percepciones o pagos a cuenta de Ganancias y otros impuestos
      nacionales en compras (`imp_perc_nacionales`, `20261104113000`–
      `20261104113002`): formulario, bandeja de ARCA, borrador de IA, asiento
      a `percepciones_ganancias`, campo 13 del TXT de compras; no es IVA.
- [x] Libro IVA Compras (pantalla, PDF, Excel) con una columna
      "Percepciones" con código (B, I, G, M), como el libro del contador.
- [x] Reparto sugerido de otros tributos en la bandeja de ARCA y el
      borrador de IA (historia del proveedor, 1,5 %/3 % de IVA, IIBB), y
      alícuota inferida de IVA/neto en los comprobantes de ARCA sin columnas
      por alícuota (21/10,5/27 %, 21 % con aviso si no coincide).
- [ ] No verificado contra una base real: las tres migraciones y el pgTAP
      `purchase_perc_nacionales` (corren en el job `database` de CI); el
      lector de Mis Comprobantes toma una columna de "percepciones de otros
      impuestos nacionales" por nombre, sin un archivo real que la traiga.

## Recibidos de ARCA (2026-11-04)

- [x] Bandeja de Mis Comprobantes → Recibidos: subir el archivo, aceptar
      cada comprobante como compra (importes de ARCA) o descartarlo
      (`20261104104001`, `/purchases/arca`).
- [x] Compras en una cuenta asignada a Neutro no suman en Gestión, tampoco
      en caja (`20261104104002`).
- [x] Clave fiscal del usuario de ARCA en Vault, editable por owner y admin
      en Admin → AFIP (`20261104110601`).
- [x] Traer de ARCA solo: robot HTTP (`lib/afip/mis-comprobantes/robot.ts`),
      función Inngest `arca-received-sync` (todos los días, últimos 60 días;
      `retries: 0`) y botón «Traer de ARCA» con período en la bandeja.
- [ ] Probar el robot contra ARCA desde producción (región `gru1`): el
      recorrido sale de la grabación del owner, nunca corrió de punta a punta.
- [x] Robot más seguro (auditoría w4): solo habla con `afip.gob.ar` y
      `afip.gov.ar` por https y la clave no sigue una redirección a otro
      sitio; dos ingresos fallidos seguidos frenan la cuenta
      (`20261104120000`, compare-and-set sobre las credenciales leídas); un
      mes cuyas filas no coinciden con `recordsTotal` falla; tope de 200 s
      por corrida; un comprobante se vincula solo si el total también
      coincide; el centavo de redondeo de ARCA va a no gravado (A) o al neto
      (B/C) al aceptar.
- [ ] Avisar por notificación a owner y admin cuando ARCA rechaza la clave
      (hoy lo muestran la bandeja y Admin → AFIP).
- [x] Lector validado con una consulta real de Recibidos (A con otros
      tributos, C y NC C que traen solo el total, todo en pesos) y con los
      encabezados del Excel que exporta la página.
- [ ] Sin ver todavía: el CSV que arma el servidor (`descargarComprobantes.do`),
      una B y un comprobante en dólares. El dueño dice que las compras son
      todas en pesos.
- [ ] FCE MiPyME y tipo M quedan en «No soportados»: se cargan a mano.

## Auditoría w2: deploy, docs y seguridad (2026-11-04)

- [x] **Stamps de migración:** `pnpm check:migrations` (y CI) rechaza una
      versión nueva que no es una fecha y hora UTC reales (`…096000`, minuto
      60). `pnpm db:restamp` ya no se niega cuando `main` está adelantado al
      reloj: estampa el segundo real siguiente a su máximo
      (`CONTRIBUTING.md`, "Migraciones").
- [x] **CHECK sin validar:** `20261104104000` valida los seis que habían
      quedado `NOT VALID` (tipos de aviso, destino de adjuntos, origen de
      tareas y tres de impuestos).
- [x] **PDF y avisos:** un error al generar un PDF (comprobante, recibo, OP,
      liquidación, rendición, libros IVA) o al leer o marcar los avisos va al
      log; el usuario ve un mensaje fijo sin el texto de la base.
- [x] **Login:** un ingreso fallido loguea solo el dominio del email.
- [x] **Invitar usuario:** los roles se asignan por `set_user_access` (el
      mismo escritor que el diálogo de accesos); una cuenta que ya tiene roles
      se rechaza en la misma transacción.

## Emisión AFIP — auditoría (2026-11-04)

- [x] Un reintento no pide un segundo CAE cuando otro comprobante trabado solo
      _intentó_ el mismo número: cuenta quien lo tiene (`numero`) y, entre los
      que solo lo intentaron, el que coincide con el comprobante de AFIP.
- [x] `issue-invoice-reconcile` (cada 15 min): una emisión fiscal trabada en
      `emitting` (AFIP no respondió) se emite con el CAE que AFIP tiene o pasa a
      `failed` (libera la liquidación o el envío); un borrador que nunca llegó a
      Inngest se vuelve a mandar con su clave. La NC de un remito facturado es
      la excepción: `credit-billed-remito` la manda con una clave por corrida,
      así que una primera corrida lenta puede tener una segunda; es interna y
      las dos terminan en el mismo número.
- [x] Reenviar el formulario con la misma clave vuelve a mandar un borrador sin
      run; si `inngest.send` falla el borrador no se borra.
- [x] Las llamadas a AFIP tienen un límite de 20 s (60 s el login de WSAA,
      5 s el piso CAEA).
- [x] Un segundo run no vuelve un comprobante `emitted` a `emitting`.
- [x] Una consulta a AFIP que no trae el comprobante ni el error 602 (no
      existe) queda sin respuesta: no marca fallida una emisión ni saltea un
      número en la importación de ARCA.
- [x] La importación de ARCA guarda un comprobante de un período cerrado con
      su asiento en `pending_journal_entries`.
- [x] CAEA: un error de lectura no se toma como "sin CAEA vigente" ni como
      "sin movimiento".
- [ ] Dos comprobantes con el mismo total, fecha y receptor que intentaron el
      mismo número durante una caída quedan en `emitting` (no se pide otro CAE)
      hasta que alguien decida de cuál es el de AFIP.
- [ ] `arca-issued-sync` hace hasta 100 consultas por paso: con AFIP lento
      (cada una cerca de 20 s) el paso puede pasar los 300 s.
- La revisión de los borradores antes de la primera corrida de
  `issue-invoice-reconcile`: en **Antes de promover**.
- [ ] Una emisión en `emitting` sin número enviado (el `onFailure` no pudo
      leer la fila, o el run se canceló) no la resuelve el cron: frena la
      importación de ARCA de su par hasta que alguien la marque fallida.

### Emisión AFIP — auditoría, segunda vuelta (2026-11-04)

- [x] Un run que agota los reintentos con un pedido reciente a AFIP (menos de
      30 min) no se marca fallido por un "no registrado" de AFIP: un pedido
      que se cortó por el límite de 20 s puede seguir procesándose. Queda en
      `emitting` y lo decide `issue-invoice-reconcile`. Un rechazo de AFIP
      (error no reintentable) sigue marcándose fallido en el momento.
- [x] El aviso al remito facturado de un CAE recuperado (por el `onFailure` o
      por el cron) sale en un paso propio: un reintento ya no lo pierde.
- [x] WSAA: el ticket nuevo se guarda en `afip_ta_cache` con reintentos antes
      de usarse; si no se puede guardar, el paso falla y se reintenta sin
      pedir otro login. Un error al leer el ticket guardado no se toma como
      "no hay ticket", y un `alreadyAuthenticated` vuelve a leer el guardado.
- [x] Estado CAEA: si falla el conteo de comprobantes sin informar, el panel y
      la herramienta de IA muestran el error en vez de "0".
- [x] Escaneo de una factura de venta: si no se pudo verificar si ya estaba
      cargada, "Emitir factura" queda deshabilitado y la acción la rechaza;
      el borrador de compra lo avisa.
- [x] Un comprobante fiscal en dólares necesita cotización mayor a 1 también
      en la base (`guard_invoice_cotizacion`), para cualquier escritor.
- [x] El total del listado de Comprobantes suma solo los emitidos (antes
      sumaba borradores); la cantidad sigue contando todas las filas listadas.
- [x] CAEA: no se emite con un CAEA ya informado "sin movimiento" para ese
      punto de venta (el comprobante falla con el aviso de emitirlo de nuevo
      con una fecha de la quincena vigente),
      y "sin movimiento" espera mientras haya un borrador del punto de venta
      con fecha dentro de la vigencia.
- [x] El barrido de archivos huérfanos borra solo los que siguen huérfanos al
      borrar (`delete_orphan_files`) y después saca sus bytes.
- [x] El mail semanal del aging va con clave de idempotencia: un reintento no
      lo manda dos veces.
- [ ] Mail manual de un comprobante, recibo o liquidación: sin clave de
      idempotencia. Hace falta un id de pedido que el diálogo mande a las tres
      acciones; hoy el doble envío lo frena solo el botón deshabilitado.
- [ ] `build_invoice_journal_lines` y `libro_iva_ventas` siguen tomando una
      cotización 1 guardada como válida en un comprobante en dólares viejo (la
      guarda nueva frena las filas nuevas). Revisar si hay alguna:
      `select id, fecha, cotizacion from invoices where moneda <> 'PES' and cotizacion <= 1`.
- [ ] CAEA: un borrador trabado con fecha dentro de una vigencia vencida
      frena el "sin movimiento" de su punto de venta hasta la fecha tope; hay
      que emitirlo o marcarlo fallido.
- [x] Auditoría w3: antes de pedir un número nuevo, un reintento vuelve a
      consultar el número que ya mandó si AFIP ya llegó a él (AFIP pudo
      registrar el pedido que se cortó entre la consulta y la lectura del
      último número).
- [x] Auditoría w3: después de un intento sin resultado, un rechazo de AFIP
      queda reintentable, así que `onFailure` deja el comprobante a
      `issue-invoice-reconcile` en vez de marcarlo fallido al instante.
- [x] Auditoría w3: si no se guarda el "sin movimiento" de un CAEA en
      `no_movement_pvs`, el paso falla y reintenta (la presentación a AFIP es
      idempotente).
- [x] Auditoría w3: el Libro IVA Ventas (pantalla, PDF y Excel) muestra el no
      gravado y el exento cada uno en su columna.

## Compras: total igual a la suma de las partes (2026-11-04, auditoría w3)

- [x] Una compra cuyo total no da neto + IVA + otros tributos + no gravado +
      exento se rechaza al crearla o al cambiarle un importe: en el formulario
      (sin "guardar igual" en modo encabezado; un botón pasa la diferencia a
      no gravado en una A fiscal o al neto en las demás), en Zod, en la acción
      y, para las fiscales, en la base (`guard_purchase_invoice_total`).
- [x] Editar una compra sin mandar un importe ya no lo pisa: el schema de
      edición no tiene defaults (neto, IVA, otros tributos, moneda, cotización
      e ítems quedaban en 0, PES, 1 y sin ítems).
- [x] Al editar desde la lista, los importes quedan deshabilitados con
      "Cargando el desglose de la factura…" mientras carga, y con el motivo si
      la lectura falla.
- Las compras existentes con diferencia y las B/C con IVA: en **Antes de
  promover**.
- [ ] Las compras internas no tienen el guard en la base (no generan asiento);
      la app las valida igual.
## Tesorería: auditoría w3 (2026-11-04)

- [x] **Cheque propio de una OP que rebota** (`20261104110600`): el rechazo
      devuelve en Caja el egreso de la OP (ingreso en el banco del cheque, en
      la fecha del rechazo, sin asiento propio). Antes, pagar la deuda con
      una OP nueva sacaba la plata del banco dos veces.
- [x] Una OP con un cheque propio anulado por fuera de ella no se anula ni
      se edita (la deuda volvería dos veces). Anular solo el cheque de una OP
      viva ya lo rechaza la base desde `20261102210000`.
- [x] El PDF, el detalle y la edición de una OP cuentan lo que imputó a
      cheques rechazados ("Cheque rechazado …"), y "A cuenta" lo excluye.
      Editar por debajo de eso se rechaza con un mensaje en castellano.
- [x] Pagar una cuota, registrar el desembolso y vincular un egreso a una
      cuota piden también `transactions:write`; sin él, el detalle del
      préstamo no muestra esos botones.
- [x] El dashboard muestra los cheques en cartera en USD aparte de los de
      pesos.
- [x] Conciliación: la explicación de la diferencia cuenta solo los
      movimientos de libros hasta la fecha del último saldo del extracto, y
      lo dice cuando esa fecha no es el fin del período.
- [x] El aviso de "Imputar" una OP o un recibo en USD dice US$.
- [ ] El movimiento que devuelve el egreso de un cheque propio rechazado,
      si se intenta borrar desde Caja, dice que es "el cobro de un cheque
      propio" (el guard de borrado nombra igual a los dos).
- [ ] Un cheque propio USD de una OP que rebota vuelve en Caja en dólares;
      Gestión en percibido valúa la OP a su cotización y el ingreso a la del
      día del rechazo, así que queda la diferencia entre las dos.
- [ ] No verificado contra una base real: la migración y su pgTAP
      (`issued_check_rejection`, `supplier_rejected_checks`).

## Tesorería: auditoría w2 (2026-11-04)

- [x] **Cheques en USD entregados a un proveedor** (`20261104101000`): el
      cobro, el rechazo y la anulación de un cheque propio de una OP, y el
      rechazo de un cheque endosado, asientan a la cotización de la OP (la
      misma con la que la OP los acreditó); `cheques_diferidos_emitidos` y
      proveedores se revierten exactos. Antes asentaban los dólares como
      pesos.
- [x] El rechazo de un cheque endosado asienta en la fecha del rechazo y el de
      un cheque propio en `rejected_at` (antes, el día de la carga).
      `reject_check` corre con `search_path = ''`.
- [ ] Diferencia de cambio del lado del banco al cobrar un cheque propio USD
      de una OP: el banco se acredita a la cotización de la OP, no a la del
      día del cobro.
- [ ] Asientos ya hechos de cheques USD de OP (cobro, rechazo, anulación) y
      de rechazos de endosados quedan con el importe viejo; re-asentarlos
      cambia períodos pasados: lo decide el owner.
- [x] **Cheque entregado que rebota** (`20261104101400`): la deuda vuelve a
      la cuenta corriente del proveedor (fila "Cheque rechazado" con el
      número de la OP), al aging, al flujo de caja y a las herramientas de
      IA de proveedores. Se paga con una OP nueva a cuenta e "Imputar" →
      "Cheques rechazados" (del más viejo). Los mensajes de anular y editar
      la OP dicen ese camino.
- [ ] Saldo de apertura de proveedor: el saldo real al corte no cuenta los
      cheques entregados rechazados.
- [ ] Un cheque rechazado USD pagado por una OP a otra cotización deja la
      diferencia en proveedores (sin `diferencia_cambio`).
- [ ] La OP nueva no imputa el cheque rechazado al crearla (solo a cuenta y
      después "Imputar"); las tareas automáticas no crean "Pagar" para un
      cheque rechazado.
- [x] **NC de compra sin origen** (`20261104101400`): el aging por documento
      reparte su crédito (mismo canal y moneda, del más vencido al más
      nuevo), así el flujo de caja y la IA ven lo mismo que los totales del
      aging. Ahora el crédito queda en su canal: una NC sin origen de un
      canal ya no baja la deuda de otro.
- [x] **Cuentas con movimientos** (`20261104101100`): moneda, tipo y saldo
      inicial quedan fijos (guarda en la base y campos deshabilitados en el
      formulario); el saldo se corrige con "Ajustar saldo".
- [x] **Préstamo en USD** (`20261104101300`): el capital de cada cuota baja
      `prestamos` a la cotización del desembolso y la diferencia va a
      `diferencia_cambio`. Un préstamo importado (sin movimiento de
      desembolso) asienta como antes; las cuotas ya pagadas conservan su
      asiento.
- [x] "Pagar" un impuesto pide también `transactions:write` (mueve Caja),
      como vincular y deshacer.
- [x] Transferir desde o hacia una cartera de cheques se rechaza en la base
      (`20261104101200`).
- [ ] `create_transfer` no tiene clave de idempotencia: un reintento crea
      otra transferencia.
- [x] Conciliación: la diferencia compara el saldo del extracto con el de
      libros a la fecha de ese saldo.
- [x] Tesorería muestra las carteras de cheques en USD aparte.
- [x] Deudas por cheques vendidos: todas las pendientes (sin tope de 200) y
      las últimas 100 pagadas (llegó con #348).
- [ ] Aprobar las migraciones `20261104101000`–`20261104101400` con el
      deploy.
- [ ] No verificado contra una base real: migraciones y pgTAP
      (`check_journal_op_rate`, `account_frozen_after_movements`,
      `transfer_check_cartera`, `loan_usd_capital_fx`,
      `supplier_rejected_checks`).

## Auditoría: IA, tareas y accesos (2026-11-04)

- [x] **Insights:** una lectura que falla conserva las tarjetas de su tipo
      (antes se borraban); flota y anomalías leen todas las filas (paginado;
      pasado el tope de drenado la corrida falla y las tarjetas quedan); las
      anomalías se comparan por moneda (ARS y USD por separado, con `US$`);
      la regeneración es una transacción (`regenerate_ai_insights`) con lock
      y un índice único por fingerprint vivo.
- [x] **Propuestas IA:** una aceptada sin resultado (el pedido murió) se
      cierra como fallida y se puede volver a preparar.
- [x] **Escaneo:** el control de duplicados compara también tipo y letra, y
      avisa si la búsqueda falló.
- [x] **Herramientas IA:** `limit` acotado en órdenes de pago, recibos y
      asientos; una página cortada avisa que hay más.
- [x] **Dashboard:** la agenda nombra las secciones cuya lectura falló en vez
      de decir "sin vencimientos". **Remitos:** el número escaneado se busca
      exacto en SQL antes del tope de 200.
- [x] **Tareas:** `tasks-daily` reclama vencidas y por vencer en pasos
      separados y asigna toda tarea automática abierta sin asignar, salvo
      la que alguien dejó sin responsables a mano; los comentarios e
      historial de una tarea restringida no se devuelven.
- [x] **Permisos:** `retentions:write` gatea cargar o cambiar retenciones de
      un recibo (sin él, ningún formulario de recibo muestra el editor) y
      `stock_movements:write` gatea entrar, despachar, borrar o mover un
      pallet. Salen de la matriz `channels:read`, `channels:write`,
      `files:admin`, `retentions:read`, `credit_debit_notes:read` y
      `stock_movements:read` (ningún gate los leía); un test exige que cada
      permiso se lea fuera de la matriz.
- Aprobación de `20261104096000` y `20261104096100`: en **Antes de
      promover**.
- [ ] pgTAP verde en CI (stack fresco); sin verificar contra datos de
      producción: las dos migraciones y el anti-join de tareas sin asignar.

- [ ] Aprobar `20261104096000` (insights) y `20261104096100` (denegaciones de
      permisos quitados) con el deploy. Sin la primera, el analista falla
      (no existe el RPC) y las tarjetas quedan como estaban.
- [ ] No verificado contra una base real: las dos migraciones, el pgTAP de
      `regenerate_ai_insights` y el anti-join de tareas sin asignar.

### Auditoría w2: IA, UI y adjuntos

- [x] **Insights:** la lista se lee entera, se filtra por dominio y se ordena
      por gravedad antes de mostrar 50 ("Mostrando 50 de N"); una lectura que
      falla se muestra como error, no como "No hay insights todavía". "Visto"
      sobre una tarjeta ya recalculada avisa en vez de dar éxito.
- [x] **Propuestas:** una aceptada que quedó sin resultado se muestra primero
      con "No se sabe si la acción se completó"; la nueva se arma al volver a
      abrir. Aceptar una propuesta refresca todo (como en el chat).
- [x] **Adjuntos:** una lectura que falla dice "No se pudieron leer los
      adjuntos" (antes: sin adjuntos y un reintento en bucle).
- [x] **Pallets:** los botones siguen los permisos de las acciones (crear,
      cargar varios, despachar y borrar piden `stock_movements:write`;
      editar y bloquear, `pallets:write`); sin `stock_movements:write` la
      edición traba depósito, estado, cantidad y fechas.
- [x] **Listas al facturar:** flete, liquidación y almacenaje refrescan
      también cuando la factura se emitió pero no se vinculó. Impuestos
      refresca Gestión y Conciliación; recategorizar, libros y Gestión.
- [x] **Nits:** cheque de una OP con monto, moneda y cuenta trabados; flete
      que no se borra si falla la lectura de la tarifa; historial de chat que
      descarta solo el mensaje inválido; deudas por cheques pendientes sin
      tope; Gestión parcial con filas de un bucket desconocido; búsquedas por
      nombre que toman `%` y `_` literal; cobranzas en riesgo que avisan si
      faltan los dólares; margen por cliente que falla pasado el tope del RPC;
      error de lectura de cuota y del catálogo de gastos; "Estimar" y "Pagar"
      solo con los permisos que piden; guía de `/aging/mora`; totales de la
      rendición en una columna en el celular; historial de bloqueos en hora
      argentina.
- [ ] No verificado en el navegador: los diálogos y paneles se probaron con
      tests de componentes (jsdom), no en la app.
## Auditoría RRHH y rendiciones (2026-11-04)

- [x] SAC de la liquidación final estable al reaplicar (`20261104095000`).
- [x] Embargo tipeado a mano en un borrador sobrevive a los cambios de
      embargos judiciales (`embargo_override`, `20261104095100`).
- [x] Compra a cargo de empleado: en canal fiscal se le carga el neto, igual
      que el asiento a anticipos al personal (`20261104095200`).
- [x] Extras de viajes: lecturas paginadas y marca de parcial real.
- [x] Rendiciones: "Resolver diferencia" a cargo del chofer (salda al
      cliente con un recibo y le carga un adelanto) o del cliente (queda
      abierta en su cuenta); quitar y cancelar lo deshacen; sin `hr:write` no
      se saca lo que está en la cuenta del chofer (`20261104095300`).
- [ ] Descuento de planilla sin plan ni cargo: queda saldo a favor del
      empleado (decisión en `docs/decisions.md`); si molesta, agregar un
      aviso al cerrar el período.
- Aprobación de `20261104095000`–`20261104095300` y revisión previa de
      `20261104095200`: en **Antes de promover**.
- [ ] Diferencias asentadas al chofer antes de `20261104095300`
      (movimiento `charge` o `payment` con `driver_settlement_id`): un
      faltante deja también la factura del cliente abierta y un sobrante queda
      a cuenta del cliente y acreditado al chofer, dos veces. No se reparan
      solos; en Rendiciones, "Quitar diferencia" y volver a resolverla los
      deja en una sola cuenta.
- [ ] Gestión percibido: el pago (OP) de una compra a cargo de empleado va
      entero a "Anticipos al personal" (`f_employee` en
      `management_pnl_lines`), pero al empleado ahora se le carga el neto: en
      canal fiscal el IVA queda en anticipos y no en el costo. Ajustar
      `f_employee` a la parte que se le carga (`amount / imp_total` del
      cargo) sobre la definición de `20261104092000`.
- [ ] No verificado contra una base real: las cuatro migraciones y los pgTAP
      `payroll_audit_fixes`, `driver_settlement_differences`,
      `driver_settlements`, `employee_accounts`, `payroll_receipt_sac`.

## Auditoría w2: RRHH, Gestión y rendiciones (2026-11-04)

- [x] Liquidación final de junio o diciembre: si la planilla del SAC del
      semestre ya tiene al empleado, el SAC proporcional sugerido es solo lo
      que falta (la tarjeta lo avisa y linkea esa planilla). Si ahí cobra el
      semestre entero de más, se ajusta a mano en esa planilla.
- [x] Liquidación final de alguien que entró ese mismo mes: el sueldo
      proporcional cuenta desde la fecha de ingreso.
- [x] Montos de RRHH (planilla, pagos, adelantos, planes, embargos, tarifas de
      viajes, liquidación final, alta del empleado) leen "150.000" como
      150000, como el resto de la app.
- [x] NC de una compra a cargo de empleado: baja el cargo y su neto vuelve a
      anticipos al personal (`20261104102300`, decisión en
      `docs/decisions.md`). El cargo conserva una descripción editada.
- [x] Gestión (`20261104102000`): "Diferencias de cambio" en costo
      financiero (decisión en `docs/decisions.md`); el interés de una cuota
      sin desglose de un préstamo con pasivo asentado es costo financiero y no
      capital, en las dos bases; un descuento de planilla o una condonación en
      USD sin cotización queda en "USD sin cotización"; el percibido valúa un
      recibo o una OP en USD a su cotización y redondea cada línea.
- [x] Rendición: cargar la diferencia al chofer, quitarla o cancelar la
      rendición que la tiene pide `hr:write` y `transactions:write`
      (`20261104102100` corrige el mensaje).
- [x] IA: `getDriverSettlements` devuelve `difference_kind`; una diferencia
      asentada al chofer antes de `20261104095300` (`charge`/`payment`) no
      dice que el cliente quedó saldado.
- [x] IA: `getPayrollSummary` con alcance muestra lo pagado por los otros
      canales (el saldo es siempre de todos).
- [x] Una DDJJ de IVA que solo deja saldo a favor no abre "Pagar IVA"
      (`20261104102400`).
- [x] **Decidido (owner, 2026-11-04):** todo lo de RRHH y cheques que mueve
      o borra tesorería pide también `transactions:write`: los pagos de
      planilla (individual y masivo, editar y borrar), borrar un movimiento de
      la cuenta corriente que tiene movimiento de caja
      (`deleteAccountMovementAction`) y pagar la deuda de un cheque vendido
      (`payCheckSaleDebtAction`). El botón queda oculto o deshabilitado con
      el motivo, con el mismo predicado que la acción (`HR_CASH_PERMISSIONS`,
      `CHECK_SALE_DEBT_PAY_PERMISSIONS`). La matriz no cambia: todo rol con
      `hr:write` o `cheques:write` (owner, admin, finance) ya tiene
      `transactions:write`; lo frena una denegación por usuario.
- La revisión previa de los cargos que baja `20261104102300` y de los
  planes de deuda que quedan por encima: en **Antes de promover**.
- [ ] **Después de promover** `20261104102300`, las NC de compras a cargo de
      empleado que quedaron con su asiento viejo por período cerrado (no
      quedan en `pending_journal_entries`: reabrir el período no las
      re-asienta solo): la consulta es la segunda del ítem siguiente.
      **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a
      2026-11-04).**
- [ ] Antes de aprobar `20261104102300`, el dueño revisa los cargos que baja
      el backfill (compras a cargo de empleado con NC):
      `select f.id, f.charged_employee_id, m.amount from purchase_invoices f
      left join employee_account_movements m on m.purchase_invoice_id = f.id
      where f.charged_employee_id is not null and exists (select 1 from
      purchase_invoices nc where nc.invoice_origin_id = f.id and nc.kind = 'nc'
      and nc.status = 'received');`. Y después, las NC que quedaron con su
      asiento viejo por período cerrado:
      `select nc.id from purchase_invoices nc join purchase_invoices f on f.id
      = nc.invoice_origin_id where nc.kind = 'nc' and nc.status = 'received'
      and f.charged_employee_id is not null and
      journal_entry_status('purchase_invoices', nc.id) = 'differs';`.
- [ ] Planes de deuda tipeados desde el total viejo de un cargo que bajó
      (al neto con `20261104095200`, o por una NC con `20261104102300`): la
      planilla sigue descontando hasta el total del plan. El dueño los
      revisa antes de promover (consulta en **Antes de promover**) y ajusta
      el plan a mano.
- [ ] Si el rol `diferencia_cambio` se asigna más adelante a otra cuenta,
      esa cuenta no tiene rubro de Gestión hasta que se lo den a mano.
- [ ] Una ND contra una compra a cargo de empleado no suma al cargo (va al
      gasto).
- [ ] Sin hacer (nits de la auditoría w1): el combustible importado no se
      liga a la factura del proveedor (W1 · S3 #20, sospecha); el embargo no
      entra en ninguna cifra de sueldos (#22, diseño); el percibido de una OP
      de compra a cargo de empleado sigue entero en anticipos aunque se le
      cargue el neto (ítem de arriba).
- [ ] Aprobar `20261104102000`–`20261104102400` con el deploy. Rollback: el
      código anterior lee los mismos datos; una rendición con el chofer se
      quita con `hr:write` solo y recibe el mensaje nuevo.
- [ ] No verificado contra una base real: las cuatro migraciones y los pgTAP
      `employee_charge_credit_notes`, `management_fx_loan_interest`,
      `tasks_iva_credit_only`, `driver_settlement_differences`.

## Auditoría w3: montos de RRHH y liquidación final (2026-11-04)

- [x] Todos los montos de RRHH (alta y edición del empleado: sueldo base,
      viático y retribución formal; celdas de la planilla; pagos individuales
      y masivos; adelantos y devoluciones; movimientos y planes de la cuenta
      corriente; embargos por monto; tarifas y extras de viajes; liquidación
      final) usan `MoneyInput` (`components/money-input.tsx`): texto con
      formato es-AR mientras se tipea, como recibos y OP. Un punto tipeado se
      ve descartado ("1500.50" se muestra 150.050) en vez de guardar 100
      veces el monto sin avisar, y el sueldo guardado se ve al editar.
      Cambiar un embargo entre monto y porcentaje vacía el valor ("1.500"
      son $1500 pero 1,5 %).
- [x] `parseArAmount` devuelve null ante basura ("12abc", "1e3"); todas sus
      llamadas ya trataban el null como inválido.
- [x] Liquidación final: el sueldo sale de `employee_salary_for_month` del mes
      de baja (un aumento cargado para el mes siguiente no cuenta). Sin sueldo
      base, usa la línea del mes anterior, nunca la del mes de baja que la
      propia liquidación pisa: volver a cargarla da las mismas cifras.
- [x] Impuestos: una DDJJ de IVA que solo deja saldo a favor no se marca
      Vencido (lista y calendario), no ofrece "Pagar" ni "Vincular movimiento
      existente", y la IA no la cuenta como vencida ni por vencer.
- [ ] Liquidación final de alguien sin sueldo base y sin planilla del mes
      anterior: sugiere $0 de sueldo, como antes; se tipea a mano.
- [ ] Sin migraciones. Rollback: el código anterior vuelve a los inputs sin
      formato y a leer la línea del mes de baja; no hay datos que deshacer.

## Saldos de apertura, aging y diferencia de cambio (2026-11-04, auditoría w1)

- [x] **Saldo de apertura de proveedor** (`20261104094100`): salda el saldo
      real al corte (facturas y ND − NC − OP emitidas, en pesos) menos el
      objetivo; el FIFO va sobre lo que dejan OP y NC. Antes ignoraba OP y NC.
- [x] **Saldo de apertura de cliente** (mismo archivo): el FIFO salta lo que ya
      acreditó una NC y los comprobantes USD no entran en un saldo en pesos.
- [ ] Los saldos de apertura ya cargados no se recalculan: el owner los vuelve
      a aplicar para corregirlos.
- [x] **NC sin origen en el aging** (`20261104094200`): su crédito se reparte
      sobre los comprobantes abiertos del cliente (mismo canal y moneda, del más
      vencido al más nuevo), así aging, saldo por ámbito, fotos del aging, mora,
      tareas y herramientas de IA coinciden con la cuenta corriente. El tope de
      una NC con origen lee `invoice_open_amount` (lo que debe ese comprobante).
- [ ] Mora: el crédito de una NC sin origen baja la base de todo el período
      (no desde su fecha). Cobra de menos, nunca de más.
- [ ] El crédito de NC sin origen que supera lo abierto no se muestra en el
      aging (la cuenta corriente sí lo muestra).
- [x] **Diferencia de cambio** (`20261104094000` + `094300`): recibo USD contra
      factura/ND USD, NC USD contra su origen y OP USD contra compra USD a otra
      cotización van a la cuenta con rol `diferencia_cambio` (4.2.x
      "Diferencias de cambio"); clientes y proveedores quedan en 0 en pesos.
      Sin cuenta activa con ese rol se asienta como antes.
- [ ] Diferencia de cambio pendiente: NC de compra USD a otra cotización que
      su factura, NC de venta sin origen, y documentos USD cuya cotización no se
      conoce (asentados 1:1). Los asientos en períodos cerrados conservan el
      asiento viejo (el backfill los cuenta en un NOTICE).
- [ ] Cambiar `invoice_origin_id` de una NC emitida no re-asienta su diferencia
      de cambio (hoy ningún flujo lo cambia).
- [ ] Resultado de gestión: la cuenta "Diferencias de cambio" no tiene caja
      asignada, así que aparece en "Sin clasificar" hasta que el owner la
      clasifique.
- Aprobación de `20261104094000`–`20261104094300` y vista previa del
      backfill de `094300`: en **Antes de promover**.

## Auditoría: liquidaciones y flete (2026-11-04)

- [x] **Contador externo (`fiscal_reader`):** en `/liquidaciones` ve solo las
      del lado fiscal (canal confirmado, o el del cliente en un borrador o
      una legacy): listado, detalle, PDF del R, datos para el email y la
      herramienta IA. No lee candidatas (cargas). Los datos del email de un
      comprobante (`getInvoiceEmailDefaultsAction`) validan el id y ocultan
      los internos.
- [x] **Una sola factura por liquidación o carga:** la factura se emite con
      una clave derivada de la liquidación o la carga
      (`lib/source-invoice-key.ts`); un "Facturar" después de que venció la
      reserva vincula la factura ya emitida en vez de emitir otra (en una
      carga, solo si sigue con el mismo cliente y flete). Cancelar una
      liquidación con una factura emitida y sin vincular se rechaza.
- [x] **Carga nueva:** el flete tomado de la tarifa sigue al cliente y a la
      fecha (se vacía si el nuevo no tiene tarifa); un flete tipeado queda.
      Editar una tarifa refresca la sugerencia y las candidatas.
- [ ] Las facturas emitidas antes de este cambio llevan una clave al azar: una
      liquidación o carga facturada así y nunca vinculada no se detecta.
- [ ] La clave se busca en las primeras 20 tentativas: con 20 facturas
      fallidas o anuladas, facturar de nuevo se rechaza (revisar a mano).
- [ ] La clave es por fuente: una carga facturada sola cuya factura no se
      vinculó vuelve a ser candidata cuando vence la reserva, y una
      liquidación la factura otra vez. Borrar esa carga deja la factura sin
      carga. Hace falta una marca en la base (la carga no lo sabe).

## Follow-ups de operaciones (2026-11-04, roadmap 4.x)

- [x] **Rendiciones:** varios medios de pago por carga; PDF interno de la
      rendición; listado paginado; "Asentar diferencia al chofer" (desde
      2026-11-04: "Resolver diferencia", ver arriba); marca de recibos anulados o editados en Recibos.
- [x] **Liquidaciones:** "Liquidar período" (una por cliente, en borrador o
      confirmadas por `confirm_freight_settlement_document`); envío del
      remito R por email (el X de Otras ventas va como su comprobante);
      la reserva para facturar se libera en el acto si la factura ya falló.
- [x] **Cheques vendidos:** anular una venta cargada por error (sin cheques
      movidos y con el período abierto); rechazo sin débito como deuda con el
      comprador que se paga después; pasivo contingente y deuda en Tesorería.
- [x] **Mora:** prorrateo de pagos y NC en el período (saldo diario); varias
      ND de una vez (cada una idempotente).
- [x] **Depósito:** tarifa general por área (precedencia en
      `20261104080400`); lote y área en el export y la trazabilidad;
      historial de bloqueos y desbloqueos con motivo.
- [x] **Cargas y tarifas:** búsqueda por remito; el escaneo de un remito
      muestra su carga; el flete de una carga nueva sale de la tarifa de flete
      del cliente; las tarifas de cliente de `storage_tariffs` que facturan
      igual pasan al tarifario.
- [x] **IA:** `getFreightSettlements` y `getDriverSettlements` (lectura).
- [ ] Aprobar las migraciones `20261104080000`–`20261104080500` junto con el
      deploy (después de `20261104030000`): sin ellas fallan el listado de
      rendiciones (columna `driver_settlement_id`), `/aging/mora`
      (`balance_days`), las ventas de cheques (`status`), las tarifas de
      almacenaje (`area_id`, `migrated_to_client_tariffs_at`), el historial de
      bloqueos y el envío de liquidaciones por email.
- [ ] pgTAP verde en CI (stack fresco: `driver_settlement_differences`,
      `check_sale_followups`, `late_interest_proration`, `deposit_followups`,
      `storage_tariffs_to_client_tariffs`); sin verificar contra datos de
      producción ni en el navegador: las migraciones y las pantallas.
- [ ] Rollback: el código anterior factura una tarifa general por área como
      general de todas las áreas (no cargarlas hasta que el deploy quede
      firme) y cobra la mora sobre el saldo de hoy. No edita las tarifas
      migradas ni cierra bien con "Aumentar %": ver "Límites de rollback".

## Tesorería: auditoría de cheques, OP y préstamos (2026-11-04)

- [x] Anular o editar una OP no devuelve a cartera un cheque endosado
      rechazado; se rechaza con mensaje.
- [x] Cuotas sin desglose bajan `prestamos` (capital primero) si el pasivo
      está asentado; anular un préstamo con plata se rechaza.
- [x] Cheque propio sin OP: el cobro asienta gasto, no reversa de pasivo; no
      cambia importe, moneda ni cuenta después de emitido; no se le liga OP.
- [x] Mora: el prorrateo cuenta solo NC emitidas.
- [x] Cheques y cheques propios: completos los abiertos, 500 recientes del
      resto con aviso; la guarda de cuentas de cheques falla cerrada.
- [x] UI: "Pagar" deuda de cheque vendido sin estado viejo; ND por mora
      refresca aunque falle el vínculo; resultados de varias ND con su
      comprobante.
- Aprobación de `20261104093000`–`20261104093400`: en **Antes de
      promover**.
- [ ] Filas existentes sin tocar: cuotas sin desglose ya pagadas y cheques
      propios sin OP ya cobrados conservan su asiento viejo hasta que algo los
      re-asiente (revisar `prestamos` y `cheques_diferidos_emitidos`). Lo
      mismo para una cuota sin desglose pagada antes de registrar el
      desembolso: queda en gasto y `prestamos` no llega a cero. Re-asentarlas
      cambia períodos pasados: lo decide el owner.
- [ ] `journal_missing_entries` no lista los asientos de cheques propios: un
      cheque propio en USD cobrado sin cotización ese día queda sin asiento
      y sin aviso en el paquete mensual.
- [ ] pgTAP verde en CI (stack fresco: `payment_order_rejected_endorsed_checks`,
      `loan_liability`, `issued_checks_manual_cashing`,
      `late_interest_emitted_nc`); sin verificar contra datos de producción:
      las migraciones.

## IA: propuestas e indicadores (2026-11-03, roadmap 6.3 + 6.4)

- [x] **Propuestas fuera del chat** (`ai_proposals`): preparar con los permisos de quien hace
      click, Aceptar / Descartar en un Dialog, aceptar idempotente (compare-and-set + guard),
      vencimiento a 24 h, auditoría de aceptar, fallar y descartar.
- [x] **Acciones proponibles nuevas:** tarea, tarifa de cliente, conciliar las sugerencias de un
      extracto y ND por mora (además de licencia, asiento, cotización, tarea IA y escaneo).
- [x] **Ocho indicadores** en el analyst (margen por cliente, costo por km, L/100 km, mora sin
      cobrar, extracto sin conciliar, rendiciones, cuotas de préstamos, caja contra
      financiamiento), con propuesta donde corresponde.
- [ ] Aprobar la migración `20261103180000_ai_proposals` junto con el deploy: sin ella falla el
      analyst (columna `ai_insights.proposal`) y las tarjetas nuevas no se ven para finance ni
      operations. pgTAP verde en CI (`ai_proposals_test.sql`); sin verificar
      contra datos de producción.
- [x] **Recategorizar un gasto** (cuenta de gasto y/o centro de costo de un egreso manual o de
      una compra): `recategorize_expense` + `lib/commands/recategorize-expense.ts`, Dialog
      "Recategorizar" en Caja y Compras, y la propuesta `proposeRecategorizeExpense`.
- [x] **Crecimiento de la mora:** foto diaria del aging (`aging_snapshots`, cron
      `aging-snapshot`) y la tarjeta `receivables_overdue_growth` ("la mora creció X % vs hace
      30 días"). La tarjeta aparece recién cuando hay 30 días de fotos.
- [x] **Conciliación desde el insight de extracto:** si la cuenta con más líneas atrasadas tiene
      sugerencias, la tarjeta propone `proposeBankMatches`; si no, la tarea de siempre.
- [x] **"N conciliadas" en la tarjeta del chat** (`ai_chat_confirmations.result_note`).
- [ ] Aprobar las migraciones `20261104060000_recategorize_expense`,
      `20261104060100_aging_snapshots` y `20261104060200_ai_chat_confirmation_note` con el
      deploy. pgTAP verde en CI (`recategorize_expense_test.sql`,
      `aging_snapshots_test.sql`); sin verificar contra datos de producción.
- [x] Recategorizar una factura de compra lleva el cambio a sus NC/ND vigentes que tenían el valor
      anterior (`20261104092300`); una NC/ND con cuenta o centro propios lo conserva, y una a
      cargo de un empleado conserva la cuenta. El audit lista las NC/ND que cambiaron.
- [ ] Las compras recategorizadas antes de `20261104092300` dejaron sus NC/ND en el rubro o
      centro anterior; no hay backfill (cambia datos de producción, lo decide el owner):
      recategorizar esas NC/ND una por una (el audit `expense.recategorized` dice cuáles compras).
- [ ] Una propuesta aceptada cuyo servidor cae entre el claim y la escritura se cierra como
      fallida al volver a prepararla (#346); en el chat queda `accepted` sin `result`.
- [ ] Los evals en vivo (`pnpm eval:ai`) de los casos nuevos no se corrieron (sin
      `ANTHROPIC_API_KEY` en el entorno del agente; los offline pasan).

## Guía del sidebar e impuestos como documento (2026-11-03, roadmap 6.5 + 6.6)

- [x] **Guía en el sidebar** (`features/guide`): ayuda corta de la pantalla
      actual (qué es, pasos y la sección del manual HTML que la cubre) y el
      checklist de **puesta en marcha** (cuentas, puntos de venta AFIP,
      importador, tarifas por cliente, saldos iniciales, ajuste inicial,
      usuarios, impuestos). Cada ítem se marca hecho desde los datos (hay al
      menos un registro) o a mano ("Ya está"); se ve solo con el permiso de
      su módulo, denegaciones por usuario incluidas. Plegable; el estado se
      guarda por usuario en `user_guide_states` (localStorage solo como
      pista del primer render).
- [x] **Impuestos** (Contabilidad › Impuestos, `/taxes`, `features/taxes`):
      `tax_documents` con tipo (IVA, IIBB, anticipo de Ganancias, SICORE,
      F931, monotributo, otro con nombre), período, vencimiento, importe
      (manual o estimado desde el libro IVA) y estado pendiente → liquidado
      → pagado / anulado; VEP o DDJJ como adjunto (`file_attachments.
    tax_document_id`); lista y calendario; "Preparar el mes" copia los del
      mes anterior. **Pagar** (`pay_tax_document`) registra el egreso en el
      canal fiscal como movimiento con dueño y su asiento Debe cuenta del
      impuesto / Haber caja o banco; rechaza un período cerrado. Tareas
      automáticas 7 días antes del vencimiento (`sync_automatic_tasks`,
      cron `tasks-daily`). `taxes:read` (owner, admin, finance,
      fiscal_reader) y `taxes:write` (owner, admin, finance).
- [ ] Aprobar las migraciones `20261103170000_tax_documents` y
      `20261103170100_user_guide_states` con el deploy (después de
      `20261103150000_ai_cross_queries`). Sin ellas falla `/taxes` y la guía
      del sidebar muestra solo la ayuda de la pantalla (la lectura del
      checklist falla). Rollback: el código anterior no lee las tablas
      nuevas; Caja (`v_transactions_tagged`) marca el pago de un impuesto con
      origen `tax_document` y la app vieja lo muestra como un movimiento con
      dueño (no editable), que es lo correcto.
- [ ] pgTAP verde en CI (stack fresco: `tax_documents_test.sql`); sin verificar contra datos
      de producción. La UI (guía, impuestos, calendario) no se probó en el
      navegador.
- [x] **Vincular movimiento existente** (`20261103190000`): un impuesto
      se paga con un egreso suelto ya cargado (pesos, canal fiscal, caja o
      banco activa, ±15 días del vencimiento, el importe más cercano
      primero) vía `link_tax_document_payment`, que le saca la cuenta de
      gasto y re-asienta contra la cuenta del impuesto; sirve también con un
      movimiento ya conciliado. En Conciliación › Crear movimiento, un
      débito en pesos puede ser "Pago de impuesto"
      (`create_bank_statement_line_tax_payment`: `pay_tax_document` con la
      fecha, cuenta e importe de la línea, y la concilia). Un importe
      distinto al del impuesto pide confirmación y queda en las notas.
- [ ] Aprobar la migración `20261103190000_tax_documents_link_movement` con
      el deploy. Rollback: el código anterior no llama a los RPC nuevos; un
      impuesto pagado así se ve como cualquier pagado.
- [ ] pgTAP verde en CI (stack fresco: `tax_documents_link_test.sql`); sin verificar contra
      datos de producción. Los diálogos (vincular, "Pago de impuesto") no se
      probaron en el navegador.
- [ ] Vincular un egreso de un canal no fiscal se rechaza: cambiarle el
      canal rompería su conciliación. Si hace falta, cargarlo en el canal
      fiscal o pagar con "Pagar".
- [x] Resultado de gestión percibido: el pago de un impuesto cae en el
      rubro de la cuenta `gastos` (como un egreso suelto sin cuenta de
      gasto), no en el de la cuenta del impuesto. En devengado, una cuenta
      de pasivo (IVA) no es resultado y no suma.
- [x] Estimado de IVA: descuenta las percepciones de IVA de las compras
      que las tienen repartidas (`imp_perc_iva`, `20261104096400`; las
      compras anteriores quedan como IIBB) y el saldo a favor del mes
      anterior.
- [x] El contador (`fiscal_reader`) ve los impuestos pero no sus adjuntos
      (no tiene `files:read`).
- [x] Herramienta del asistente IA para impuestos (vencimientos y estado).
- [x] El manual HTML no se sirve desde la app: la guía lo cita por nombre
      ("Manual: Contabilidad › Impuestos"), sin link.
- [x] **Deshacer un pago** (`20261104050100`, "Deshacer pago" en el
      impuesto pagado; `taxes:write` + `transactions:write`):
      `undo_tax_document_payment` devuelve el impuesto al importe y estado
      que tenía antes del pago (`payment_previous_amount`,
      `payment_previous_status`, `20261104092200`; un pago anterior a esa
      migración vuelve liquidado, o pendiente si el importe era estimado) y
      deja una línea en las notas. Si lo pagó "Pagar",
      borra el egreso con su asiento; si fue "Vincular", el movimiento queda
      en Caja suelto, con la cuenta de gasto que tenía
      (`tax_documents.payment_previous_expense_account_id`) y el asiento
      rehecho. Rechaza un período cerrado y un egreso de "Pagar" conciliado
      con el extracto (primero se desconcilia). Sin pago no hace nada.
- [x] **Gestión percibido** (`20261104050200`): el pago de un impuesto va
      al rubro de la cuenta del impuesto si está mapeada en
      `management_buckets`, si no a Costos operativos › Impuestos
      operativos. Devengado no cambia.
- [x] **Estimado de IVA**: las retenciones de IVA salen de los recibos
      emitidos (`issued`; antes filtraba un estado inexistente y daban 0),
      en pesos a la cotización del recibo; un recibo en dólares sin
      cotización frena el estimado. Una respuesta de "Estimar" que llega
      después de cambiar el documento, el período o cerrar el diálogo se
      descarta.
- [x] **IA, libros IVA**: `getLibroIvaVentas`/`getLibroIvaCompras` devuelven
      `totals` con signo (NC restadas, cada comprobante una vez) además de
      las filas.
- [x] **Estimado de IVA**: descuenta el saldo a favor técnico del IVA del
      mes anterior (`tax_documents.credit_balance`, `20261104050300`, se
      carga en el impuesto de IVA desde la DDJJ) y muestra aparte los otros
      tributos de las compras.
- [x] Estimado de IVA: las percepciones de IVA sufridas en compras se
      descuentan cuando la compra las reparte. `imp_trib` se reparte en percepción IVA, percepción IIBB,
      municipales e impuestos internos (`20261104096400`); cada parte va a
      su cuenta en el asiento y a su campo en el libro IVA y el TXT.
- [ ] Backfill de deshacer: los impuestos ya pagados toman su origen del
      log de auditoría (vinculado si está `tax_document.payment_linked`; si
      no, "Pagar"); la cuenta de gasto previa sale del último
      `transaction.created`/`transaction.updated` antes del vínculo, porque
      `repost_journal` borra el asiento reemplazado (no lo revierte). Sin
      rastro, deshacer deja el movimiento sin cuenta de gasto (va a
      `gastos`).
- [x] **Adjuntos para el contador** (`20261104050400`): quien tiene
      `taxes:read` ve los adjuntos de un impuesto (RLS de `file_attachments`
      y `files`, y las acciones de adjuntos) sin `files:read`; nada más del
      hub de archivos. En `/taxes`, el lector abre "Ver adjuntos".
- [x] **Herramienta IA** `getTaxDocuments` (`taxes:read`): vencidos, por
      vencer, pagados en un mes, estimados y, a pedido, el estimado de IVA.
- [ ] Aprobar las migraciones `20261104050100` a `20261104050400` con el
      deploy. Rollback: el código anterior no llama a `undo_tax_document_
      payment` ni lee las columnas nuevas; gestión percibido sigue en rubros
      que conoce; las policies nuevas solo agregan filas a un rol al que el
      código viejo no le pide adjuntos.
- [ ] pgTAP verde en CI (stack fresco: `tax_documents_undo_test.sql`); sin verificar contra
      datos de producción. "Deshacer pago", el saldo a favor y "Ver adjuntos"
      no se probaron en el navegador; los casos de ruteo nuevos no se
      corrieron en vivo.

## IA: consultas cruzadas y gráficos (2026-11-03, roadmap 6.1 + 6.2)

- [x] **Margen por cliente** (`getClientMargin`): ingreso neto facturado sin
      IVA menos costo de viajes y combustible imputado; costo directo sin
      cliente y flota no asignada aparte.
- [x] **Cobranza por cliente** (`getClientPaymentBehavior`): días promedio
      de cobro, deuda abierta y vencida, +90 días, cheques rechazados y a
      cuenta.
- [x] **Economía por vehículo** (`getVehicleEconomics`) y **actividad por
      chofer** (`getDriverActivity`): viajes, km (viajes y odómetro), litros,
      ingreso, costos, por km; extras, adelantos y saldo del empleado con
      RRHH. Viajes sin vehículo / sin chofer aparte.
- [x] **Ranking de costos** (`getTopCosts`) por rubro o centro de costo,
      desde el resultado de gestión.
- [x] **Gráficos:** barras apiladas, formato km, `dataset` para elegir la
      lista; `getManagementPnL` con `byMonth`.
- [ ] Aprobar la migración `20261103150000_ai_cross_queries` junto con el
      deploy: sin ella fallan `getClientMargin`, `getVehicleEconomics` y
      `getDriverActivity`.
- [x] **Costos de camión sin vínculo:** `getVehicleEconomics` suma el
      costo del centro de costo del camión (`get_vehicle_margin`,
      `20261104050000`); falta vincular cada camión con su centro (dato, ver
      "Margen por camión").
- [x] `ai_fleet_margin` cuenta viajes cancelados (su costo y su ingreso
      manual); las RPC nuevas de actividad los excluyen. Alinear.
- [ ] Rendiciones por chofer (diferencias de cobranza contra entrega) en
      `getDriverActivity`.
- [x] "Días de pago" va a `getClientPaymentBehavior`: `getClientSalesSummary` ya no
      ofrece días promedio de cobro en su descripción y deriva esas preguntas; casos de
      routing nuevos (días de pago, quién tarda más, facturado por cliente).
- [ ] Los evals en vivo (`pnpm eval:ai`) de esos casos no se corrieron (sin
      `ANTHROPIC_API_KEY` en el entorno del agente).
- [ ] Los evals en vivo (`pnpm eval:ai`) de los casos nuevos no se corrieron:
      `getClientSalesSummary` y `getClientPaymentBehavior` se pisan en "días
      de cobro".

## Importador, conciliación y manual: follow-ups (2026-11-04)

- [x] **Importador, más datos:** proveedores con categoría, cuenta de gasto
      y centro de costo por defecto (por nombre o código); choferes con
      número, categoría y vencimiento de licencia (el vencimiento es un
      documento `licencia` en Flota › Vencimientos); tarifas por área (columna
      Área, buscada por nombre dentro del Depósito). Una referencia que no
      existe o es ambigua deja la fila con error.
- [x] **Conciliación:** varias líneas contra un movimiento (el banco lo
      partió), con la suma exacta y nunca varias de cada lado; desconciliar
      una libera toda la conciliación. Caja marca los conciliados, filtra
      por conciliados o no, no ofrece borrarlos y bloquea monto y fechas en
      la edición con link a Conciliación; el mensaje de la base nombra
      Tesorería › Conciliación.
- [x] **IA:** el resumen de conciliación de un extracto escaneado lee las
      líneas ya importadas (`bank_statement_lines`) y su estado; solo el
      resto se compara contra Caja.
- [x] **Manual:** formato de cada planilla del importador y sección de
      Conciliación; servido en `/manual` con sesión iniciada; la guía del
      sidebar enlaza la sección de cada pantalla.
- [ ] Aprobar las migraciones `20261104070000_import_more_fields` y
      `20261104070100_bank_reconciliation_many_lines` con el deploy (después
      de las de 5.3/5.4; `promote-to-production.yml` las aplica antes del
      código). Sin la primera, la RPC vieja ignora las claves nuevas:
      proveedores y choferes entran sin sus datos nuevos y **una tarifa de
      área entraría como general**, así que no importar tarifas por área
      hasta aplicarla. Sin la segunda falla "Conciliar con varias líneas".
      Rollback del código: llama a las mismas RPC con su firma; una
      conciliación partida sigue bloqueando su movimiento y el código viejo
      la muestra contra una de sus líneas.
- [ ] pgTAP verde en CI (stack fresco: `import_more_fields_test.sql`,
      `bank_reconciliation_many_lines_test.sql`); sin verificar contra datos
      de producción. No se probaron en el navegador `/manual`
      (CSP con nonce), el filtro de Caja (filtro de nulos sobre el embed de
      `bank_statement_matches` en `v_transactions_tagged`) ni el diálogo de
      varias líneas.
- [ ] El importador no actualiza un proveedor o empleado que ya existe: los
      datos nuevos de la planilla solo entran con el alta.
- [ ] Las sugerencias de Conciliación siguen siendo uno a uno; las líneas
      partidas se eligen a mano.
- [ ] El manual servido usa la fuente del sistema (la CSP bloquea Google
      Fonts) y Mermaid por CDN con el nonce.

## Importador y sueldos y viajes históricos (2026-11-03, roadmap 5.1 + 5.2)

- [x] **Importador** (Admin › Importador, `/admin/imports`, owner y admin):
      .xlsx o .csv → tipo → columnas → vista previa con errores y avisos por
      fila → importar en una transacción. Clientes, proveedores, empleados
      (con su ficha de chofer si el puesto es chofer) y vehículos. Cada
      corrida queda registrada (archivo, hash, quién, filas importadas,
      salteadas y con error) y se puede **deshacer** si nadie editó ni usa
      sus filas. Reimportar el mismo archivo no duplica.
- [x] **Sueldos y viajes históricos**: tablas propias, solo de referencia, en
      las pestañas del importador. No generan asientos, pagos, cuenta
      corriente, extras de chofer ni facturas, y no entran en Gestión, libros
      fiscales, reportes ni IA.
- [ ] Aprobar la migración `20261103110000_import_runs` junto con el deploy
      (después de las de 4.4–4.6): sin ella falla la página del importador.
      Rollback: el código anterior ignora `import_run_id` y las tablas
      nuevas; lo importado queda como un alta normal.
- [ ] pgTAP verde en CI (stack fresco: `import_runs_test.sql`); sin verificar contra datos de
      producción.
- [x] Importar tarifas, préstamos, cheques en cartera, saldos iniciales de
      clientes y extractos (5.3, 5.4): ver la sección siguiente.
- [ ] Mostrar los históricos donde ayuden (ficha del empleado, del vehículo
      o del cliente) y sumarlos a Gestión como serie separada si hace falta;
      hoy solo se ven en el importador.

## Importes de arranque y conciliación bancaria (2026-11-03, roadmap 5.3 + 5.4)

- [x] **Importador, tanda 2**: tarifas por cliente (con vigencia, respeta la
      superposición), préstamos con sus cuotas pendientes, cheques de
      terceros en cartera, saldos iniciales de clientes (lo que debe cada
      uno al corte) y extractos bancarios. Cada corrida se deshace mientras
      nada la usó (cuota pagada, cheque movido, recibo nuevo del cliente,
      tarifa facturada, línea conciliada).
- [x] **Conciliación bancaria** (Tesorería › Conciliación,
      `/treasury/reconciliation`): por cuenta y mes, sugerencias por importe,
      fecha y referencia; conciliar una línea con uno o varios movimientos;
      desconciliar; "no corresponde" con motivo; crear el movimiento que
      falta (comisión, interés) con su cuenta de gasto. Saldo según extracto
      contra saldo según libros. Un movimiento conciliado no se edita ni se
      borra hasta desconciliarlo.
- [ ] Aprobar las migraciones `20261103140000_bank_reconciliation` y
      `20261103140100_import_opening_items` con el deploy (después de
      `20261103110000_import_runs`). Rollback: el código anterior no lee las
      tablas nuevas, saltea las corridas de tipos que no conoce y no las
      puede deshacer; el guard de conciliación sigue rechazando editar un
      movimiento conciliado.
- [ ] pgTAP verde en CI (stack fresco: `bank_reconciliation_test.sql`); sin verificar contra
      datos de producción. La UI no se probó en el navegador.
- [ ] Cobranzas históricas (recibos de antes del go-live) **no** se importan:
      moverían caja y asientos de períodos ya cerrados en papel. Va el saldo
      inicial por cliente; el detalle por factura queda para el ajuste
      inicial.
- [ ] Cheques importados: el ingreso a cartera se fecha hoy y acredita
      ajustes de caja (sin cliente). No cargar además el saldo inicial de la
      cuenta de cartera por esos cheques.

## Depósito por área, lote y bloqueo; mora y venta de cheques (2026-11-03, roadmap 4.4 + 4.6)

- [x] **Áreas del depósito** (Depósitos › Áreas): zonas por depósito; el
      pallet puede estar en un área de su depósito. **Tarifa por área** en el
      tarifario del cliente: pisa a la de todas las áreas para los pallets de
      esa área; sin área todo factura igual que antes.
- [x] **Lote y vencimiento** del pallet (alta, carga masiva y edición).
- [x] **Bloqueo** de un pallet en depósito con motivo y quién lo bloqueó: no
      se despacha ni se borra hasta desbloquearlo (guard en la base); el
      despacho masivo saltea los bloqueados y lo avisa.
- [x] **Intereses por mora** (`/aging/mora`): comprobantes vencidos con saldo,
      interés simple a la tasa mensual del cliente o la general; "Generar ND"
      emite una nota de débito por comprobante con el período cobrado. Un
      período no se cobra dos veces; una ND fallida o anulada lo libera.
- [x] **Venta de cheques** (Cheques › seleccionar › Vender): los cheques
      quedan vendidos, el neto entra en la cuenta y los intereses y comisiones
      van a Intereses pagados. Un vendido rechazado sale de la cuenta de la
      venta (o la elegida) y queda como deuda del firmante.
- [ ] Aprobar las migraciones `20261103100000_storage_areas_lots_blocks`,
      `20261103100100_late_interest` y `20261103100200_check_sales` junto con
      el deploy (después de las de 4.1–4.5): sin ellas fallan el listado de
      pallets (columnas nuevas), el tarifario, la facturación de almacenaje
      (`area_id`), `/aging/mora` y la venta de cheques.
- [ ] Rollback: el código anterior factura mal a un cliente con tarifas por
      área (las toma como si fueran de todas las áreas y se superponen), no
      lista los cheques vendidos (los descarta con un log) y no puede
      rechazar uno vendido. No cargar tarifas por área hasta que el deploy
      quede firme.
- [ ] Mora: tasa por comprobante o por condición de venta. Un comprobante
      que ya se pagó entero no aparece (sin saldo abierto): la mora de los
      días hasta ese pago no se puede cobrar desde `/aging/mora`.
- [ ] Deuda con el comprador de un cheque vendido rechazado: el libro mayor
      la asienta al pagarla (como el rechazo con débito inmediato); hasta
      entonces es pasivo operativo en Tesorería y Cheques, no una cuenta del
      plan. Una cuenta "Deudas por cheques vendidos" en el mayor necesita
      tocar `build_transaction_journal_lines`.
- [ ] "Percibido" del resultado de gestión: los intereses de la venta de
      cheques entran por su cuenta de gasto; el nominal transferido es neutro
      (como un depósito).

## Liquidación R y rendiciones (2026-11-03, roadmap 4.3 + 4.5)

- [x] **Liquidaciones** (`/liquidaciones`, `invoices:read`, edición con
      `invoices:issue`): cliente + período + cargas entregadas, a su flete o a
      la tarifa de **flete** del cliente (concepto nuevo del tarifario, por
      carga, en pesos). Borrador → confirmada (número `R-…`) → facturada con
      **una** factura por `issueFiscalInvoiceAction`. PDF del documento R. Una
      carga en una sola liquidación viva; mientras tanto no se factura sola.
      Factura fallida o anulada → vuelve a confirmada; cancelar una facturada
      pide la factura anulada o acreditada por NC por el total.
- [x] **Cobranza contra entrega** en la carga (`cod_amount`, en el diálogo
      de la carga) y **Rendiciones** (`/rendiciones`, `receipts:read`, edición
      con `receipts:write`): pendientes por chofer, rendición con lo entregado
      por carga (cuenta, importe, cheque) y diferencias; confirmar emite un
      recibo por cliente y canal (caja, bancos o cartera) imputado a la
      factura de cada carga. Idempotente; cancelar pide los recibos anulados.
- [ ] Aprobar las migraciones `20261103090000_freight_settlements` y
      `20261103090100_cod_driver_settlements` junto con el deploy (dependen de
      `20261103080000`/`20261103080100`, PR #318): sin ellas fallan el listado
      de cargas (`cod_amount`), `/liquidaciones` y `/rendiciones`.
- [ ] Un rollback a código anterior con tarifas de flete cargadas hace fallar
      la facturación de almacenaje de ese cliente (el código viejo rechaza un
      concepto que no conoce).
- [ ] Editar desde Recibos un recibo de una rendición no la actualiza: la
      rendición lo marca ("recibos cambiados en Recibos") y no deja asentar
      la diferencia; no se recalcula sola. Se detecta por el total del
      recibo: un cambio de cuenta con el mismo total no se marca.
- [x] El faltante asentado al chofer y la factura del cliente: desde
      `20261104095300` "a cargo del chofer" salda al cliente con un recibo
      (#345). Las diferencias asentadas antes quedan para reparar a mano: ver
      "Diferencias asentadas al chofer antes de `20261104095300`" en
      Auditoría RRHH y rendiciones.
- [ ] Liquidar período con "confirmar" deja las de Otras ventas confirmadas:
      el remito interno X se emite una por una (cada una es un comprobante).
- [x] **Remito R / remito interno X** (`20261104030000_freight_settlements_remito_r`):
      la liquidación sigue el lado del cliente. Ventas: confirmar emite el
      **Remito R** (`R9002-…`, correlativo propio) y después se factura la
      A/B. Otras ventas: "Emitir remito interno" confirma y emite el remito
      interno X (`X9001-…`), sin R. Las confirmadas antes conservan su `R-…`.
- [ ] El Remito R no imprime CAI ni su vencimiento (RG 1415, comprobante
      impreso): cargar el CAI del punto de venta 9002 cuando se tramite, y
      confirmar con el contador que 9002 es el punto de venta habilitado.
- [ ] Borrar `confirm_freight_settlement(uuid, uuid)` (numeración `R-…`) una
      vez que no quede código desplegable que la llame.

## Remitos únicos y tarifarios por cliente (2026-11-03, roadmap 4.1 + 4.2)

- [x] **Remito del cliente en la carga** (`shipments.remito_number`): único
      por cliente entre las cargas no canceladas, sin distinguir mayúsculas ni
      espacios (índice `shipments_client_remito_unique`). El diálogo de carga
      avisa mientras se escribe (`shipment_remito_conflict`) y no deja guardar
      un repetido; el índice lo rechaza igual. Una carga cancelada libera su
      número.
- [x] **Tarifario por cliente** (`client_tariffs`): concepto (almacenaje,
      carga, descarga), unidad, precio, ARS/USD y vigencia, sin superposición
      por cliente y concepto (guard `guard_client_tariff_overlap`); RPC
      `client_tariff_at(cliente, concepto, fecha)`. Pestaña **Tarifario** en el
      detalle del cliente (`storage_billing:read`, edición con
      `storage_billing:issue`).
- [x] **Facturación de almacenaje** usa el tarifario del cliente día por día
      (carga el día de ingreso, descarga el de egreso) y cae a
      `storage_tariffs` (la del cliente, después la general) en lo que no
      cubre. USD al oficial del último día del período (o el anterior); sin
      cotización la preview lo marca y la factura no se emite.
- [ ] Aprobar las migraciones `20261103080000_shipment_remito_number` y
      `20261103080100_client_tariffs` junto con el deploy: sin ellas fallan
      el listado de cargas (columna `remito_number`), la pestaña Tarifario y la
      facturación de almacenaje (lee `client_tariffs`).
- [ ] Tarifas de cliente en `storage_tariffs` que no pasaron al tarifario
      (más de una fila activa, con fin de vigencia o un cliente que ya tenía
      tarifario): pasarlas a mano revisando cada una
      (`20261104080500`). Las que pasaron quedan como respaldo congelado.
- [ ] Crear la carga desde un remito escaneado (hoy el escaneo muestra las
      cargas con ese remito y lleva a Cargas).

## Resultado de gestión v2 (2026-11-03, roadmap 3.7)

- [x] **Detalle de cada cifra:** cada número de la tabla mes a mes abre los
      documentos que lo forman (`get_management_pnl_documents`), con link a
      cada uno si el usuario lee su módulo; suma lo mismo que la cifra.
- [x] **Percibido:** cobros de bienes de uso, pagos de compras de flota,
      pagos de compras a cargo de empleados y adelantos fuera del margen
      operativo, según lo que imputó cada recibo / OP; cuotas con desglose
      en capital e intereses.
- [x] **Compras a cargo de empleados y adelantos** fuera del costo operativo
      en las dos bases (el costo entra con el descuento de planilla).
- [x] **Indicadores:** margen operativo %, resultado operativo (EBITDA
      aprox.), generación de caja y variación contra el mismo período del
      año anterior.
- [x] **Exportar CSV / Excel** de la tabla mes a mes (uso interno, auditado).
- [x] IA: `getManagementPnL` con indicadores y `getManagementPnLDocuments`.
- [x] **Cheques en percibido** (`20261104092000`): un cheque de terceros
      importado al arranque (`checks.import_run_id`) es una partida de
      apertura (su ingreso a cartera y su rechazo no cuentan); el egreso de
      un cheque rechazado (débito del banco, devolución al comprador) resta
      de Servicios lo que el cheque había sumado.
- [ ] **Cheque endosado rechazado, en percibido:** el rechazo no mueve caja, así que el cobro
      original sigue en Servicios y el pago con ese cheque en proveedores; cuando el cliente
      vuelve a pagar y se le vuelve a pagar al proveedor, los dos cuentan dos veces.
- [x] **Pendiente en USD, devengado:** un movimiento fiscal en dólares queda
      pendiente mientras no tiene asiento, aunque después se cargue una
      cotización con fecha anterior (antes no estaba ni en pesos ni en
      pendiente hasta re-asentarlo).
- [ ] Re-asentar solo los movimientos `sin_cotizacion` al cargar una
      cotización: hoy esperan al re-asiento del paquete mensual
      (`journal_missing_entries`), y mientras tanto Gestión los muestra
      pendientes.
- [ ] **Percibido a cuenta:** lo cobrado o pagado sin imputar va a servicios /
      pagos a proveedores aunque después se impute a un bien de uso o a una
      compra a cargo de un empleado.

## Margen por camión (2026-11-03)

- [ ] Aprobar la migración `20261104050000_vehicle_margin` junto con el
      deploy: sin ella fallan la sección "Margen por camión", el vínculo en
      Centros de costo y `getVehicleEconomics` con permiso de gestión. Rollback:
      el código anterior no lee `cost_centers.vehicle_id` ni llama a
      `get_vehicle_margin`.
- [ ] Vincular cada camión con su centro en Contabilidad › Centros de costo
      (dato, no código).
- [ ] Una carga de combustible que apunta solo al pago (OP) y no a la compra
      cuenta dos veces si la compra lleva el centro del camión; un
      `trips.cost` cargado también como compra con ese centro, igual.
- [x] Lo "Sin clasificar" cargado con el centro del camión entra en su costo
      de centro (`20261104092100`); antes no estaba en ninguna fila.
- [ ] El margen por camión es siempre devengado y nominal (no sigue la base ni
      el ajuste por inflación de la pantalla).
- [x] En devengado, un desembolso de préstamo en USD sin cotización ya no
      aparece en "USD sin cotización" (`20261104102000`); tampoco los
      movimientos de cheques, ajustes de saldo inicial ni pagos de impuestos.
- [ ] El "USD sin cotización" de un centro suma ingresos y costos pendientes
      juntos (`get_vehicle_margin`, columna `pending`); debería mostrar solo
      los costos.

---

## Contador, "Hoy y esta semana" y auditoría (2026-11-02, roadmap 1.9–1.11)

- [x] **Paquete del mes** (`/accounting/package`, `accounting:read`, también
      para `fiscal_reader`): checklist del período (cerrado, asientos
      pendientes y faltantes, comprobantes fiscales sin autorizar, CAEA sin
      informar, compras fiscales sin letra) y las descargas juntas: Libro IVA
      Ventas/Compras (PDF, Excel y TXT), libro diario, libro mayor y balance de
      sumas y saldos (PDF y Excel por `/api/export`). Tool
      `getMonthlyPackageStatus`.
- [x] **Dashboard "Hoy y esta semana"** (D12): vencimientos de Tareas, viajes
      de hoy y papeles por vencer, cada tile con su permiso. Tool
      `getTodayOverview`.
- [x] **Admin › Auditoría** (D13): lista, filtros, CSV, detalle con datos
      sensibles enmascarados, "Historial" en el detalle del comprobante,
      retención de 400 días (`audit-retention`), tool `getAuditEvents` y test
      de cobertura de `logAudit`.
- [ ] Aprobar la migración `20261103030000_audit_log` junto con el deploy: sin
      ella fallan el filtro de acciones, el "Historial" no tiene índice y el
      cron de retención falla.
- [ ] Tile de km mensual en "Hoy y esta semana" (la tabla
      `vehicle_km_readings` ya está en `main`).
- [ ] Un ZIP con todo el paquete (hoy son botones separados: no hay librería
      de zip en las dependencias de runtime).
- [ ] "Historial" en el resto de las páginas de detalle (recibos, OP,
      compras, clientes, proveedores): el componente `RecordHistory` ya está.

---

## Tareas (2026-11-02)

- [x] `/tasks`: manuales, recurrentes y automáticas desde compras, ventas
      vencidas, préstamos, cheques propios y documentos de flota y empleados;
      comentarios, historial, reasignar, marcar hecha; cron `tasks-daily` con
      avisos; tool `getTasks` para el asistente.
- [ ] Aprobar la migración `20261103000000_tasks` junto con el deploy: sin
      ella `/tasks` y el cron fallan (las tablas no existen).
- [ ] Push del aviso `task_due` (hoy solo in-app) y preferencia por tipo en
      `/profile`.
- [ ] Borrar una tarea manual creada por error (hoy solo se cierra).

---

## Compras y contabilidad — correcciones (2026-11-02)

- [x] **Número de compras internas.** El autonumerado del formulario llamaba a
      `next_internal_purchase_numero` desde el navegador (revocado para
      `authenticated` desde la auditoría T1a) y el error se tragaba. Ahora va
      por `nextInternalPurchaseNumeroAction` (service client, rechaza canales
      fiscales) y el RPC numera por proveedor + tipo + PV sobre todos los
      estados, como la clave única. Si falla, el formulario lo avisa.
- [x] **NC/ND de compra manual a la cuenta del origen.** Sin cuenta propia
      hereda la cuenta de gasto (y el centro de costo) de su comprobante de
      origen, en vez de revertir `compras`.
- [x] **Libro mayor con saldo anterior.** Con "Desde", el saldo acumulado
      arranca del saldo previo (fila "Saldo anterior") y el corte de PostgREST
      se detecta y se avisa como datos parciales.
- [x] **Fecha "hoy" en hora argentina.** Defaults y filtros de formularios y
      acciones usan `todayInAR()`: después de las 21 h ya no proponen el día
      siguiente (UTC).
- [x] **Contador (`fiscal_reader`) y asientos sin canal.** Ve los asientos
      manuales "fiscal general" (sin canal) y sus líneas; los internos siguen
      ocultos. El alcance "Solo fiscal" del libro diario también los incluye.
- [ ] Las NC/ND de compra cargadas antes de esta corrección siguen asentadas
      contra `compras` (no hay backfill). Desde 1.1/1.2 el formulario de
      edición cambia la cuenta de gasto (re-asienta en un período abierto):
      decidir si se corrigen una por una o con un backfill.

---

## Bases contables: costo con rubro y centro (roadmap 1.1 + 1.2 + 1.8, 2026-11-02)

- [x] **Compras con cuenta de gasto y centro de costo** (fiscal e interno, alta
      y edición). Default: el del proveedor; si no tiene, la sugerencia de la
      IA del escaneo. La base rechaza una cuenta que no sea hoja activa de
      resultado negativo.
- [x] **Proveedor con cuenta de gasto y centro de costo por defecto**, en su
      ficha.
- [x] **Egreso manual de caja con cuenta de gasto y centro** (alta y edición):
      asienta contra esa cuenta en vez de `gastos`; sin cuenta, igual que
      antes. Los movimientos de documentos no la llevan.
- [x] **Resultado de gestión por centro de costo:** filtro y tabla "Por
      centro de costo"; la herramienta de IA `getManagementPnL` también.
- [ ] **Centro de costo del camión en combustible y mantenimiento.** El
      camión ya tiene centro (`cost_centers.vehicle_id`, margen por camión);
      falta que vincular una carga o un service a una compra sin centro le
      ponga el del camión.
- [ ] **Percibido por centro para pagos con OP:** el movimiento de la OP no
      lleva el centro de las compras que paga (podría repartirse por
      imputación).
- [ ] **Compras y egresos cargados antes** quedan sin cuenta ni centro (van a
      `compras`/`gastos` y a "Sin centro"): no hay backfill; se corrigen
      editándolos en un período abierto.
- [ ] Cuenta de gasto por ítem de compra (hoy la compra entera va a una
      cuenta): solo si aparece un caso real.

---

## Accesos por usuario — follow-ups (2026-10-28)

- [ ] **Aprobar la migración `20261028140000_user_permission_denies`** apenas
      mergea el PR; después quitar la tolerancia de ventana de deploy en
      `lib/auth/denies.ts` (tabla faltante). La de `search_global` se fue con la
      búsqueda global (2026-11-04).
- [ ] **Denegaciones en la DB** (overlays RESTRICTIVE por tabla + storage + RPC
      DEFINER). Hoy la DB aplica solo el techo del rol; ver `docs/decisions.md`.
- [ ] Suite pgTAP rol × tabla contra `ROLE_PERMISSIONS` (y auditar el desvío
      `['owner','finance']` en RLS vs admin en TS).
- [x] `issue-invoice.ts`: "sin CAEA vigente" y "sin `cbte_tipo_afip`" fallan sin
      reintentos.
- [x] `issueFiscalInvoiceAction`: la `idempotency_key` la manda el formulario;
      un doble submit devuelve el mismo borrador.
- [ ] Datos de un módulo oculto que otro módulo muestra (facturas/recibos en la
      cuenta del cliente y el aging, saldos de cuentas en tesorería, libro IVA):
      decidir si se filtran por el permiso del recurso.
- [ ] Document Intelligence: el matching (`features/ai/document/store.ts`,
      `features/ai/reconciliation/gather.ts`) lee con service client sin filtrar
      por el acceso de quien subió el documento.
