# Decisiones

Registro fechado, la más nueva arriba. Cada entrada: qué se decidió, por qué,
y qué se descartó.

## 2026-11-03 — Pagar y cobrar desde Tesorería; préstamos conectados (Fase 2)

**Decisión (D2).** "Cobrar a cliente" y "Pagar a proveedor" abren el mismo
formulario de recibo / orden de pago (mismas actions y RPC `create_receipt` /
`create_payment_order`) desde Tesorería, Caja, el detalle de un comprobante
(precargado con su saldo) y como aviso en un ingreso o egreso manual. En
Tesorería y Caja se elige el lado (fiscal o interno). La imputación es
explícita: automática (FIFO, los más viejos primero), elegida o "a cuenta"
(`allocation_mode`; sin el campo rige el contrato anterior: sin imputaciones
= FIFO). Lo que quedó a cuenta se imputa después con "Imputar"
(`allocate_receipt` / `allocate_payment_order`): agrega imputaciones a
comprobantes sin tocar líneas de pago, movimientos ni cheques (editar el
recibo los reconstruye y falla si un cheque ya salió de cartera); la
imputación a comprobantes no entra en el asiento. El aging muestra lo cobrado
o pagado a cuenta aparte (`v_receipt_unapplied`, `v_payment_order_unapplied`,
columna "A cuenta" y el neto en el total), sin restarlo de los tramos; el
flujo de caja lo descuenta de lo proyectado a cobrar / pagar de ese lado en
el primer mes proyectado, sin pasar de lo proyectado.

**Decisión (D3).** Una cuota puede desglosarse en capital, interés, IVA,
percepción y otros cargos (sellos, punitorios); el desglose suma el importe de
la cuota y se paga por ese importe. Con desglose el pago asienta Debe
`prestamos` (capital, pasivo nuevo "Préstamos financieros" 2.1.x), Debe
`intereses_pagados` (5.4.1; interés + otros cargos), Debe `iva_credito`, Debe
`percepciones_iibb_pagadas`, Haber banco; sin desglose, igual que antes (Debe
gastos). Un egreso manual ya cargado puede tomarse como pago de una cuota
("Vincular egreso", `adopt_loan_installment_payment`): no se duplica el
movimiento, pasa a ser de la cuota y se re-asienta. El desembolso se registra
(o se toma un ingreso ya cargado del mismo importe) con
`record_loan_disbursement`: Debe banco / Haber `prestamos`. La ficha muestra
el saldo de capital (una cuota sin desglose cuenta entera como capital, como
la lee Gestión).

**Descartado.** Duplicar la lógica de recibos y OP en Tesorería; restar el a
cuenta de los tramos del aging (escondería a quién hay que imputar); un rol
por componente de cargos (sellos y punitorios van con el interés).

## 2026-11-02 — Km mensual por vehículo e importación de combustible

**Decisión.** Flota → Km mensual (`/vehicle-km`, `features/vehicle-km`,
migración `20261103020000_vehicle_km_and_fuel_import`): una lectura del
odómetro por vehículo y mes (`vehicle_km_readings`, único por vehículo y
`period`), permiso `fleet_km:read`/`fleet_km:write` para owner, admin y
operations. Los acoplados y semis no llevan km. Un km menor que el del mes
anterior se guarda igual (odómetro cambiado) y la pantalla lo marca. El
recordatorio es una fuente más de las tareas automáticas (`vehicle_km`): una
tarea "Cargar km de <mes>" por mes, vence el día 5 (el aviso de vencimiento de
`tasks-daily` sale ese día), se abre el día 1 mientras falte algún vehículo y
se cierra sola cuando están todos. Un mes que termina incompleto cierra su
tarea al empezar el siguiente; el faltante queda a la vista en la pantalla.

Combustible suma "Importar resumen": un .xlsx o .csv de YPF en Ruta, Axion
Card u otra planilla, con las columnas reconocidas por alias de encabezado por
proveedor (`features/fuel/lib/import.ts`, editables en el diálogo), vehículo
por patente o por la nueva `vehicles.fuel_card` (una tarjeta enmascarada se
reconoce por los últimos 4 dígitos si es única) y duplicados marcados (mismo
vehículo, día, importe y litros); nada se guarda hasta confirmar, y la
confirmación vuelve a saltear los duplicados que el usuario no eligió. Cada
carga acepta el ticket o remito como adjunto (`file_attachments.fuel_load_id`,
listado en Archivos).

**Por qué.** El km por camión no se registraba y las cargas de las tarjetas se
tipeaban una por una.

**Descartado.** Una tarea recurrente manual para el km (no sabe si ya se cargó)
y un formato fijo por proveedor (no tenemos un resumen real de cada uno: los
alias se amplían cuando llegue).

## 2026-11-02 — Tareas (D11)

**Decisión.** Módulo `/tasks` (`features/tasks`, migración `20261103000000_tasks`):
tareas manuales, recurrentes (todos los meses el día N, recortado al último día
del mes) y automáticas desde documentos: compras con saldo que vencen en 7 días,
ventas vencidas con saldo, cuotas de préstamo, cheques propios emitidos que
vencen en 7 días y documentos de flota o de empleados que vencen en 30 días. Una
automática es única por `(source_table, source_id, kind)` y se cierra sola
cuando el documento se salda; el cron diario `tasks-daily` (06:17 AR) crea,
actualiza y cierra, materializa las recurrentes, asigna las nuevas automáticas a
quien puede actuar sobre el documento y avisa a los responsables el día del
vencimiento y una vez vencida. `tasks:read`/`tasks:write`: owner, admin,
finance, operations, warehouse.

**Por qué.** Lo pendiente vivía en la cabeza de cada uno; los documentos ya
saben qué vence.

**Reglas.** Una tarea que un usuario cerró no se reabre sola; un vencimiento que
un usuario movió le gana al del documento. Quien no lee el módulo de origen ve
"Tarea de un módulo sin acceso" y no puede editarla; la RLS además oculta la
fila a los roles fuera del techo de ese módulo. El aviso de vencida solo sale
en la semana posterior al vencimiento, para no inundar con lo viejo al
lanzar.

## 2026-11-02 — Gestión ≠ EERR; uso interno; sueldos por mes de liquidación

**Decisión.** El Resultado de gestión (`/management`, permiso
`management:read`: owner, admin y finance; **nunca** `fiscal_reader`) suma
los asientos fiscales y los documentos internos calculados al vuelo con
`journal_document_entry`, sin escribir asientos: el EERR, el Balance y el
Libro IVA siguen siendo los del contador. La pantalla dice "Uso interno" y no
exporta nada para terceros; la herramienta de IA (`getManagementPnL`) lo
repite en su descripción. Sueldos se muestra en dos líneas, "Sueldos" (canal
fiscal, del asiento) y "Sueldos internos (extras)" (canal interno), por **mes
de liquidación** (`accrual_month`), no por fecha de pago, para que un pago
atrasado no infle otro mes. Cada cuenta del plan va a una caja
(`management_buckets`, editable por owner/admin); una cuenta de resultado sin
caja aparece como "Sin clasificar" y suma en el margen operativo. Un ítem
vendido puede marcarse como venta de bien de uso (`invoice_items.revenue_kind`)
y sale del margen operativo. Moneda: todo en pesos con la cotización del
documento o la del día; un movimiento USD sin cotización no se suma (queda
aparte, en dólares).

**Por qué.** El dueño necesita saber si la operación deja plata con lo fiscal
y lo interno juntos, sin tocar la contabilidad que se presenta a terceros.

**Descartado.** Asentar lo interno en el libro (mezclaría las dos cajas) y
mostrar Gestión dentro del EERR (se confundiría con el fiscal).

## 2026-11-02 — Movimientos de caja en USD

**Decisión.** Un movimiento lleva la moneda de su cuenta (guard en la base) y
uno en USD se asienta en pesos a la cotización de su fecha
(`get_exchange_rate`); sin cotización no asienta y queda listado como
`sin_cotizacion` en `journal_missing_entries()`. Detalle en
`docs/accounting-patterns.md` §3.5.

**Descartado.** Guardar una cotización por movimiento: ningún escritor salvo
recibos y OP (que ya asientan con la suya) la conoce hoy.

## 2026-10-29 — Promoción manual a producción y CI como Plant

**Decisión.** Producción se actualiza solo con `promote-to-production.yml`
(workflow manual desde `main`, sin entorno de staging): CI verde en el SHA →
aprobación → migraciones → deploy de Vercel → sync de Inngest → smoke test →
tag `production-latest`. Vercel deja de publicar `main` (`vercel.json`). CI
suma el job `e2e` (Playwright) y pentests por rol contra PostgREST
(`tests/security`), con expectativas sacadas de `ROLE_PERMISSIONS`.

**Por qué.** Antes Vercel publicaba el código antes de que se aprobaran sus
migraciones, y nada probaba la app levantada ni la RLS por rol. Los grants de
tabla pasan a ser explícitos (`20261029120000_public_table_grants`): las
imágenes nuevas de Supabase no los dan por default y una base nueva no
cargaba ninguna página.

**Descartado.** Un entorno de staging como el de Plant (pedía otro proyecto
de Supabase y cambiar la rama de producción de Vercel).

## 2026-10-28 — Accesos por usuario: denegaciones en la app, techo en la DB

**Decisión.** Cada usuario tiene roles más una lista de permisos denegados
(`user_permission_denies`). `resolveAccess(roles, denied)` arma el `Access`
(tipo marcado, solo se construye ahí — cercado por ESLint) y todo gate usa
`userCan(ctx.access, …)`. Denegar `<recurso>:read` oculta el módulo entero
(sus pantallas, acciones, búsqueda, IA y adjuntos); datos de ese recurso que
otro módulo muestra con su propio permiso (p. ej. facturas en la cuenta del
cliente, saldos en tesorería) siguen visibles. Excepción: en `ai`, `ai:read`
y `ai:chat` se deniegan por separado. El
owner no se puede denegar. Solo `users:manage_access` (owner) edita
denegaciones; `users:assign_role` (owner y admin) edita roles. Roles y
denegaciones se guardan juntos con `set_user_access` (SECURITY DEFINER,
service_role), que rechaza editar los propios accesos (UA001), escrituras sobre
un estado viejo (UA002), roles fuera del alcance del actor (UA003) y dejar la
empresa sin owner (23514).

**Por qué.** El owner necesita ocultar módulos a una persona sin inventar un
rol por usuario. Aplicarlo en la app reutiliza los gates que ya existen en
actions, páginas, sidebar, herramientas de IA, jobs headless, búsqueda y
alertas.

**Descartado.** Overlays RESTRICTIVE de RLS por tabla: rompen los triggers en
cascada INVOKER, los embeds de PostgREST, las policies de storage y los RPC
DEFINER, y exigen verificar cada módulo. La DB sigue aplicando el techo del
rol; una denegación no se aplica a un acceso directo con el JWT del usuario.
Queda como follow-up.

**Ventana de deploy.** Vercel publica antes de que se apruebe la migración:
sin la tabla, `loadDenies` lee "sin denegaciones"; la búsqueda reintenta la
firma vieja de `search_global`; editar accesos responde "Actualización
pendiente". Esas tolerancias se quitan cuando la migración esté en producción.
Un rollback de Vercel a un build anterior ignora las denegaciones guardadas
(siguen en la tabla y vuelven a regir al volver a desplegar).

## 2026-10-28 — Tooling importado de las apps de referencia

**Decisión.** Se adoptan: guard de migraciones con squawk y header `SET LOCAL`
(Plant), gates de workflows y skills en CI, pgTAP en CI, re-propuesta
de migraciones no desplegadas (Plant), cercas de seams en ESLint, hooks de
git, `pnpm preflight`, y las skills de lentes (reach, outcomes, effects,
claims, data-integrity, deploy-safety, ui-state) adaptadas a JouveERP.

**Descartado.** Skills atadas a la infraestructura de la otra app (sync, integraciones contables,
evals propios) y las que suponen bots de review que Jouve no tiene.
