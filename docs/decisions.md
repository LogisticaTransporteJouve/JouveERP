# Decisiones

Registro fechado, la más nueva arriba. Cada entrada: qué se decidió, por qué,
y qué se descartó.

## 2026-11-03 — Impuestos: deshacer un pago, gestión, IVA y contador

**Decisión.** (1) Un pago se deshace con `undo_tax_document_payment` según
cómo llegó (`tax_documents.payment_origin`, que ahora escriben
`pay_tax_document` y `link_tax_document_payment`): el egreso que creó
"Pagar" se borra (deja de tener dueño y el guard de movimientos lo suelta);
el vinculado vuelve a ser un egreso suelto con la cuenta de gasto que tenía
(guardada al vincular en `payment_previous_expense_account_id`) y
`repost_journal`. El impuesto vuelve a liquidado si su importe no es
estimado, si no a pendiente (no se guarda el estado previo al pago). Se
rechaza con `jouve_guard` un período cerrado (fecha o devengamiento) y un
egreso de "Pagar" conciliado; uno vinculado y conciliado se suelta porque
`expense_account_id` no es un campo bloqueado. Idempotente (sin pago,
ninguna fila) y auditado (`tax_document.payment_undone`). (2) En gestión
percibido el pago de un impuesto va al rubro de la cuenta del impuesto si
está mapeada, si no a `operating_cost` / `impuestos`, que el código viejo ya
conoce. (3) El estimado de IVA resta el saldo a favor técnico que el IVA del
mes anterior trae en `credit_balance` (cargado desde la DDJJ); si el mes no
tuvo nada que pagar, el impuesto se anula con su saldo y se lee igual. (4)
Quien tiene `taxes:read` lee los adjuntos de un impuesto por dos policies
SELECT nuevas (y `is_tax_document_file`), sin `files:read`. (5)
`getTaxDocuments` es la herramienta de lectura de impuestos del CFO IA.

**Por qué.** Sin deshacer, un pago mal cargado no tenía arreglo. Guardar el
origen evita adivinar si el movimiento era del usuario: borrar uno que el
usuario cargó perdería datos, así que ante la duda el backfill lo trata como
vinculado (se suelta, no se borra). El saldo a favor viene de la DDJJ, no de
encadenar estimados.

**Descartado.** Rearmar la cuenta de gasto desde el asiento revertido:
`repost_journal` borra el asiento reemplazado, no lo revierte; el backfill usa
el log de auditoría. Separar las percepciones de IVA de las de IIBB en
compras: `purchase_invoices` tiene un solo `imp_trib` y el asiento lo manda a
percepciones IIBB; queda como pendiente. Dar `files:read` al contador: abriría
todo el hub de archivos. Un estado nuevo para un IVA sin nada que pagar.

## 2026-11-03 — Letras de documentos no fiscales: R remito fiscal, X interno

**Decisión.** La **R** queda reservada al **remito fiscal**. La **X**
("documento no válido como factura") es la del **remito interno** y la del
**recibo de cobranza**: un recibo se numera `X0001-00000012` (antes
`R0001-00000012`). Cambia solo la letra; punto de venta y número siguen
iguales y no se reescribe ningún número guardado. En TS hay un solo
formateador, `formatReceiptNumber` (`features/receipts/schema.ts`, letra
`RECEIPT_LETTER`), que usan tabla, diálogos, PDF (recuadro "X" con la leyenda
"Documento no válido como factura"), email, exportaciones, cuenta corriente,
imputaciones y rendiciones. En SQL (`20261103210000_receipts_letter_x`) usan
X la descripción del asiento (`journal_document_entry`), la de los
movimientos de caja del recibo (`create_receipt` / `update_receipt`), la nota
del recibo que reemplaza a uno interno al facturar el remito
(`settle_billed_remito`) y el título del recibo en la búsqueda global.

**Lo ya guardado.** La descripción de un asiento se guarda al asentarlo: los
asientos ya contabilizados siguen diciendo "Recibo R…" (no se tocan), los
nuevos y los re-asentados dicen "Recibo X…". `journal_entry_status` no compara
descripciones, así que el cambio no re-asienta nada. Los movimientos de caja
de un recibo pasan a X cuando se edita el recibo. La búsqueda global indexa
las dos formas, X y R, para que un recibo impreso antes del cambio se siga
encontrando por su número R.

**Descartado.** Reescribir las descripciones de asientos contabilizados
(serían cambios masivos sobre períodos posiblemente cerrados, sin efecto en
saldos).
## 2026-11-03 — Impuestos: pagar con un movimiento ya cargado

**Decisión.** Un impuesto se suele pagar por transferencia, que ya está en
Caja (cargada a mano o desde el extracto). Dos entradas, sin duplicar el
egreso: (1) "Vincular movimiento existente" en el impuesto:
`link_tax_document_payment` adopta un egreso suelto (`transaction_is_loose`,
pesos, cuenta de caja o banco activa, canal fiscal) como el pago, igual que
`adopt_loan_installment_payment` y `record_loan_disbursement` en préstamos:
le borra la cuenta de gasto, marca el documento pagado con la fecha y el
importe del movimiento y llama a `repost_journal`, que reemplaza el asiento
(Debe la cuenta del gasto → Debe la cuenta del impuesto; Haber caja o banco
igual). (2) En Conciliación › Crear movimiento, un débito en pesos puede ser
"Pago de impuesto": `create_bank_statement_line_tax_payment` llama a
`pay_tax_document` con la fecha, la cuenta y el importe de la línea y la
concilia en la misma transacción; `create_bank_statement_line_transaction`
no cambió. Un importe distinto al del documento se rechaza salvo que el
usuario lo confirme (`p_allow_difference`); el pago queda por el importe
real y la diferencia en las notas. Vincular el mismo par dos veces devuelve
el mismo movimiento. Se rechaza: un movimiento con dueño, en otra moneda, de
un canal no fiscal o con fecha o devengamiento en un período cerrado; un
documento pagado con otro movimiento o anulado. Vincular exige
`taxes:write` y además `transactions:write` (cambia un movimiento de Caja);
el pago desde el extracto, `transactions:write` y `taxes:write`.

**Por qué.** Sin esto el usuario cargaba el pago dos veces (la transferencia
y el "Pagar") o dejaba el impuesto pendiente. El bloqueo de un movimiento
conciliado cubre monto, fecha, devengamiento, cuenta, tipo, moneda, canal y
par, no la cuenta de gasto, así que adoptar uno conciliado no toca nada
bloqueado; re-asentar reemplaza solo el asiento.

**Descartado.** Cambiar el canal del movimiento al fiscal al vincularlo
(rompe la conciliación y cambia un dato que el usuario eligió); aceptar
cualquier importe en silencio (un error de selección pagaría mal el
impuesto sin rastro); una opción nueva en
`create_bank_statement_line_transaction` (mezclaba dos contratos en una
firma); deshacer en este cambio (queda pendiente, igual que para "Pagar").

## 2026-11-03 — IA: propuestas para todo e indicadores (6.3 + 6.4)

**Decisión (6.3).** Las propuestas siguen siendo `defineAiProposal`, ahora con
`prepareDraft` separado de la tarjeta del chat. Las de fuera del chat (desde un
insight) se guardan en una tabla nueva, `ai_proposals` (`pending | accepted |
dismissed | failed | expired`, vence a las 24 h), y no en
`ai_chat_confirmations`, que está atada a sesión, tool call y revisiones y ya
está mergeada. Aceptar re-chequea `userCan`, re-valida con el Zod del
formulario y hace un compare-and-set; el trigger `guard_ai_proposal` refuerza
las transiciones en la base. El insight no prepara nada en segundo plano:
guarda `{ action, label, input }` y cada usuario lo prepara con sus permisos
al hacer click. Las escrituras nuevas (tarea, tarifa, conciliación, ND por
mora) pasaron a `lib/commands/` y el server action de cada feature llama a la
misma función; la ND recibe `issueFiscalInvoiceAction` inyectado, así `lib/`
no importa una action. La ND por mora se emite al aceptar (como "Generar ND")
y se rechaza si el interés cambió desde que se mostró.

**Decisión (6.4).** Ocho indicadores deterministas en el analyst, cada uno con
su permiso y su copy; los que apuntan a registros tienen fingerprint. Un
indicador cuyas lecturas fallan conserva su tarjeta anterior en vez de tumbar
la corrida o borrar la tarjeta. La visibilidad por tipo admite varios
permisos (se requieren todos), en sync con la política RLS.

**Por qué.** "Propuestas para todo" sin duplicar lógica de negocio ni cruzar
actions entre features; una tarjeta de insight necesita una propuesta sin
sesión de chat, y un doble click o una tarjeta vieja nunca deben ejecutar dos
veces.

**Descartado.** Generalizar `ai_chat_confirmations` (editar una tabla con
datos y semántica de revisiones). Preparar los borradores en el cron (correría
sin los permisos ni las denegaciones de quien acepta). Dejar la ND como
borrador sin emitir: no existe un borrador de ND en el ERP. Medir el
crecimiento de la mora sin fotos históricas del aging. Una propuesta de
"recategorizar gasto": no hay un server action puntual que envolver.

## 2026-11-03 — Guía del sidebar e impuestos como documento (6.5 + 6.6)

**Decisión (6.5).** Una sección "Guía" plegable al pie del sidebar
(`features/guide`): para la pantalla actual muestra qué es, los pasos
habituales y la sección del manual HTML (`docs/manual/<página>#<ancla>`)
que la cubre, citada por nombre porque el manual es un sitio estático que
la app no sirve. Debajo, el checklist de puesta en marcha: cuentas, puntos
de venta AFIP sincronizados, una corrida del importador, tarifas por
cliente, saldos iniciales, ajuste inicial (un asiento manual), más de un
usuario con rol, impuestos cargados. Cada ítem tiene el permiso de su
módulo (`userCanAll`), así una denegación por usuario lo oculta; se marca
hecho si hay al menos un registro (una lectura `limit 1` con el service
client, después del gate) o si el usuario lo marcó ("Ya está", deshacible).
El estado (plegado y marcados a mano) va en `user_guide_states`, una fila
por usuario con RLS propia, como `dashboard_layouts`; localStorage solo
evita el salto del primer render.

**Decisión (6.6).** Cada obligación es una fila de `tax_documents` (tipo,
título, jurisdicción, período, vencimiento, importe, estado, cuenta
contable, pago) con un estado pendiente → liquidado → pagado / anulado.
Pagar es un RPC propio (`pay_tax_document`) con el patrón de la cuota de
préstamo: un egreso en el canal fiscal desde una cuenta en pesos, dueño el
documento, re-asentado por `build_transaction_journal_lines` como Debe la
cuenta del impuesto (la deuda fiscal o el gasto, elegida en el documento) /
Haber caja o banco. El movimiento con dueño no se borra ni se edita desde
Caja, no lo adopta un préstamo (`transaction_is_loose`) y Caja lo marca
`tax_document`. Un pago con fecha en un período cerrado se rechaza con su
mensaje antes de postear. `guard_tax_document` deja un pagado con solo sus
notas editables, un anulado intocable y el estado pagado solo vía el RPC.
El IVA se estima en el servidor desde las acciones del libro IVA (débito −
crédito, NC restadas) menos las retenciones y percepciones de IVA sufridas
en recibos fiscales del período, y queda marcado como estimado. Las tareas
salen de `sync_automatic_tasks` (fuente `tax_documents`, 7 días antes), con
el techo de dinero de la RLS de tareas. Permisos nuevos `taxes:read`
(owner, admin, finance, fiscal_reader) y `taxes:write` (owner, admin,
finance): `accounting:*` no servía porque el contador lee contabilidad pero
no debe tocar pagos y finanzas paga sin ser contador.

**Por qué.** El arranque necesita saber qué falta cargar, y los impuestos
vivían en una planilla aparte: con fecha, importe y comprobante adentro del
ERP, vencen como tareas y el pago queda en caja y en el diario.

**Descartado.** Pagar con una orden de pago a un proveedor "ARCA" (asentaría
contra Proveedores, no contra la deuda fiscal, y obliga a un proveedor
ficticio); un asiento directo (salta el movimiento de caja y los guards de
movimientos con dueño); servir el manual HTML desde la app (CSP con nonce,
scripts y fuentes por CDN, empaquetado de `docs/`); calcular el vencimiento
por terminación de CUIT (cambia cada año por resolución: se carga y se copia
mes a mes); un catálogo configurable de tipos (alcanza "Otro" con nombre).

## 2026-11-03 — IA: consultas cruzadas y gráficos (6.1 + 6.2)

**Decisión (6.1).** Cinco tools de lectura del AI CFO
(`features/ai/registry/actions/cross.ts`) que cruzan dominios componiendo las
lecturas de cada feature: `getClientMargin`, `getClientPaymentBehavior`,
`getVehicleEconomics`, `getDriverActivity` y `getTopCosts`. Cada parte pasa
por el server action de su módulo (su `userCan` y RLS); si el usuario no lee
un módulo, esa parte vuelve `null` (no `0`) y la nota dice qué se omitió y
por qué permiso. Lo que faltaba en SQL va en tres RPC nuevas
(`20261103150000_ai_cross_queries`): `ai_client_net_revenue` (ingreso neto
sin IVA por cliente), `ai_vehicle_activity` y `ai_driver_activity` (viajes,
km, litros, odómetro, extras y adelantos), con flags `p_include_*` que el
server action prende según `userCan`. El margen por cliente es **de
contribución** (ingreso neto − costo de viajes y combustible imputado), y lo
dice: no descuenta sueldos, mantenimiento ni gastos generales, y separa el
costo directo sin cliente y el de flota que no se asigna. Cada tool pagina
(`limit`/`offset`), lee como máximo 500 filas por fuente y marca `partial`
si una fuente llegó a su tope.

**Decisión (6.2).** Los gráficos ya existían (Fase 3, `renderChart`); se
amplió el mismo artefacto: tipo `stacked` (barras apiladas, hasta 6 series,
positivos arriba y negativos abajo), formato `km`, `dataset` para elegir qué
lista del resultado graficar (ej. `byMonth` de `getManagementPnL`) y el anillo
de foco en `primary`. `getManagementPnL` suma `byMonth` y `getTopCosts`
trae `byMonth` + `seriesFields` listos para un apilado. Los nombres de campo
`*_ars` y `*_per_km_ars` se leen como pesos; `*_km` como km.

**Por qué.** Las preguntas de dueño ("¿qué cliente me deja más?", "¿cuánto me
cuesta el km de cada camión?") cruzan ventas, flota, combustible y RRHH; el
modelo no debe sumar cifras de varias tools, y cada parte tiene que respetar
el permiso de su pantalla.

**Descartado.** RPC `SECURITY DEFINER` solo para service role: saltean RLS
(un chofer vería todos los viajes, `fiscal_reader` vería canales internos) y
obligan a replicar el techo de rol en la app; se usó `SECURITY INVOKER` con
`search_path = ''` y `authenticated` como las demás `ai_*`. Un tool nuevo de
"comportamiento de pago" desde cero (se compone `ai_client_sales_summary` +
aging). Una librería de charts (sigue el SVG propio). Repartir mantenimiento
o gastos generales entre clientes (sería una regla de prorrateo inventada).

## 2026-11-03 — Importes de arranque y conciliación bancaria (5.3 + 5.4)

**Decisión (5.3).** Cada ítem de arranque entra por el mismo camino que su
alta a mano, dentro de `commit_import_run`, y lleva `import_run_id`:
**tarifas** como el tarifario del cliente (todas las áreas; el guard de
superposición aplica; mismo cliente, concepto e inicio = la misma tarifa);
**préstamos** como el alta de préstamo, con las cuotas **pendientes** al
arranque (capital pendiente en cuotas iguales o la cuota del archivo), sin
desembolso (la deuda entra con el ajuste inicial); **cheques en cartera**
como un cheque cargado a mano (`source_kind = manual`), así
`checks_manual_inflow` asienta el ingreso a cartera (Dr cartera / Cr ajustes
de caja, sin cliente); **cobranzas** como **saldo inicial por cliente**
(`client_opening_balances`, el camino de ajuste inicial documentado: sin
recibo, movimiento ni asiento, imputado FIFO a facturas anteriores al corte
por `apply_client_opening_balance_core`, el cuerpo del RPC del owner). Un
saldo, tarifa, préstamo o cheque repetido en el archivo es error en las dos
filas (saltear una perdería un importe); uno ya cargado se saltea. Deshacer
rechaza en cuanto hubo efectos: tarifa editada, usada en una liquidación o
en una facturación de almacenaje posterior; préstamo o cuota editados,
pagados o con desembolso; cheque editado o fuera de cartera (o su ingreso
conciliado o en período cerrado); recibo del cliente posterior al saldo.
Permisos: `imports:write` más el del módulo (`storage_billing:issue`,
`accounting:write`, `cheques:write`, `opening_balances:write` —solo owner—,
`transactions:write`).

**Decisión (5.4).** El extracto se importa con el importador (tipo
"Extracto bancario", cuenta elegida) a `bank_statement_lines`; cada línea se
deduplica por SHA-256 de su contenido y su repetición en el archivo, y
guarda su fila para ordenar el día. La conciliación es por cuenta y mes con
`transactions:read` / `transactions:write` (sin permiso nuevo): una línea se
concilia con uno o varios movimientos de su cuenta que suman exacto su
importe (`bank_statement_matches`, un movimiento con una sola línea); las
sugerencias son 1 a 1, mismo importe al centavo, ±5 días, primero las que
coinciden en referencia. "No corresponde" lleva motivo. El movimiento que
falta se crea como el manual (ingreso, o egreso con cuenta de gasto) y queda
conciliado en la misma transacción. `guard_transaction_reconciled` impide
borrar o cambiar monto, fecha, devengado, cuenta, tipo, moneda, canal o par
de un movimiento conciliado, sin excepción por stack (descripción y
etiquetas sí se editan). Diferencia = último saldo del extracto en el mes −
saldo según libros al fin del mes.

**Por qué.** El arranque necesita cargar lo vivo (tarifas, deudas, cartera,
saldos) sin saltear los asientos ni los guards de movimientos con dueño, y
conciliar el banco exige un vínculo línea ↔ movimiento que proteja lo ya
conciliado.

**Descartado.** Recibos históricos por `create_receipt` (moverían caja y
asientos de períodos viejos que el ajuste inicial ya resuelve); facturas
abiertas una por una (una fiscal necesita CAE); cheques con cliente (bajaría
un saldo inicial que ya los descuenta); marcar la conciliación en
`transactions` (columna nueva en una tabla que leen todos los reportes y el
código anterior); muchas líneas contra un movimiento (por ahora una línea,
uno o varios movimientos).

## 2026-11-03 — Desembolsos de préstamos en base caja → línea Financiamiento recibido

**Decisión.** En el Resultado de gestión percibido, el desembolso de un
préstamo (bancario o de financiera, `loans.disbursement_transaction_id`)
suma en una caja propia, `loan_disbursements`, con la línea **"Financiamiento
recibido"** debajo de "Generación de caja", y cierra **"Variación de caja"** =
generación de caja + financiamiento recibido, que concilia con lo que se movió
en las cuentas. El margen operativo, la generación de caja y su indicador no
cambian. Devengado: sin cambios (el desembolso no es resultado). Migración
`20261103130000`.

**Por qué.** Percibido restaba el capital de cada cuota pero ignoraba el
desembolso: era asimétrico, y la generación de caja de un mes con un préstamo
no explicaba el saldo del banco.

**Descartado.** Sumarlo en "Capital de préstamos" (mezclaría el repago con el
financiamiento y movería la generación de caja: un préstamo la haría ver
buena); incluirlo dentro de la generación de caja; mostrarlo en devengado.

## 2026-11-03 — Importador y sueldos y viajes históricos (5.1 + 5.2)

**Decisión (5.1).** Un importador genérico en Admin → Importador
(`/admin/imports`, `features/imports`, migración `20261103110000_import_runs`):
se sube un .xlsx (primera hoja) o .csv, se elige el tipo, se ajustan las
columnas (reconocidas por alias de encabezado, como el resumen de
combustible, con los helpers compartidos en `lib/tables/columns.ts`) y cada
fila se valida con el schema Zod del alta normal (`ClientCreateSchema`,
`SupplierCreateSchema`, `EmployeeCreateSchema`, `VehicleCreateSchema`) o uno
propio para los históricos. La vista previa muestra cada fila como lista, ya
cargada o con error, con sus avisos. Confirmar vuelve a leer el archivo en el
servidor (el navegador nunca manda filas) y `commit_import_run` inserta la
corrida y sus filas en una transacción, serializada por tipo con un lock. Las
filas con error quedan afuera y se cuentan. Cada corrida queda en
`import_runs`: quién, cuándo, tipo, nombre y SHA-256 del archivo, columnas,
filas importadas, salteadas y con error, y estado (`committed`/`undone`).
**Idempotente por clave natural:** cliente/proveedor por CUIT (o por nombre
entre los internos, sin CUIT), empleado por CUIL (sin CUIL, por nombre),
vehículo por patente (solo letras y dígitos), sueldo histórico por empleado +
mes + tipo, viaje histórico por el hash de su contenido y su repetición en el
archivo (dos viajes iguales del mismo día siguen siendo dos; el mismo archivo
otra vez no agrega nada). Reimportar el mismo archivo avisa la corrida
anterior. Cada fila importada lleva `import_run_id` (columna nueva en
clientes, proveedores, empleados, choferes y vehículos). Un empleado con
puesto chofer crea también su ficha de chofer, como el formulario.
**Deshacer** una corrida borra sus filas solo si ninguna se editó después
(`updated_at > created_at`) y ninguna fila fuera de la corrida las referencia
por alguna FK (se buscan en el catálogo, así una tabla nueva queda cubierta
sola); bloquea las filas antes de revisar, así nadie las referencia en el
medio. Permisos nuevos `imports:read` / `imports:write` (owner y admin);
importar o deshacer pide además el permiso de escritura del módulo destino
(`clients:write`, `suppliers:write`, `hr:write`, `vehicles:write`,
`trips:write`), así una denegación por usuario se respeta.

**Decisión (5.2).** Los sueldos y viajes históricos van a **tablas propias**
(`historic_payroll_entries`, `historic_trips`), no a `payroll_entries` /
`trips` con una marca: así no generan asientos, movimientos de caja, cuenta
corriente del empleado, extras de chofer, facturación ni rentabilidad, y no
pasan por los guards de movimientos con dueño ni de período cerrado (que no
los ven). Son **solo de referencia**: se ven únicamente en las pestañas
"Sueldos históricos" (por año, con totales por mes) y "Viajes históricos"
(por mes, con km y flete) del importador, con `imports:read` más `hr:read` o
`trips:read`. No entran en Gestión, flujo de caja, libro IVA, libro diario o
mayor, paquete del contador, reportes de RRHH o flota ni herramientas de IA.
Un sueldo histórico necesita el empleado cargado (por CUIL o nombre único);
avisa si ya hay una planilla real de ese mes. Un viaje guarda el texto de la
patente, chofer y cliente y, si los encuentra, su id. Las filas históricas no
se editan ni se borran sueltas (`guard_historic_row`): se deshace la corrida
y se reimporta. Las diferencias de saldos de antes del go-live se corrigen
con el ajuste inicial (decisión del usuario), no con estos datos.

**Por qué.** El arranque necesita cargar maestros y el historial de planillas
sin tipear fila por fila, sin duplicar al reintentar y sin que datos viejos
inconsistentes muevan la contabilidad.

**Descartado.** Filas históricas en `payroll_entries`/`trips` con una marca
(cada lector actual — asientos, extras de chofer, rentabilidad, IA — tendría
que aprender a excluirlas, y el código anterior en un rollback no lo sabe);
mandar las filas validadas desde el navegador (se vuelve a leer el archivo);
guardar el archivo en Storage (alcanza el hash y el nombre); deshacer
borrando en cascada; una dependencia de planillas (el lector de xlsx propio
alcanza). Fuera de alcance: cobranzas, tarifas, préstamos, cheques y
extractos bancarios (5.3, 5.4).

## 2026-11-03 — Depósito por área, lote y bloqueo; mora → ND; venta de cheques (4.4 + 4.6)

**Decisión (4.4).** Las **áreas** son una tabla propia (`storage_areas`, por
depósito); el pallet tiene `area_id` opcional con FK compuesta
`(area_id, warehouse_id)`, así el área siempre es de su depósito. La tarifa
por área es una dimensión opcional de `client_tariffs` (`area_id`, null =
todas las áreas): para un pallet de un área, la tarifa de esa área pisa a la
de todas las áreas en los días (y la carga/descarga) que cubre, y lo que
ninguna cubre sigue cayendo a `storage_tariffs`. El guard de superposición
pasa a ser por cliente, concepto **y área**; `client_tariff_at` devuelve solo
la de todas las áreas (el flete no tiene área). Las filas existentes (sin
área) facturan exactamente igual. **Lote** y vencimiento son columnas del
pallet. El **bloqueo** son columnas del pallet (`blocked_at`, `blocked_by`,
`block_reason`), no un estado nuevo, para que el código anterior siga leyendo
`status`: `guard_pallet_blocked` impide que un pallet bloqueado salga
(despachado o fecha de salida) o se borre, y que se bloquee uno que ya salió.
El despacho masivo saltea los bloqueados y lo avisa. Permisos existentes:
`warehouses:write` (áreas), `pallets:write` (lote, bloqueo),
`storage_billing:issue` (tarifas por área).

**Decisión (4.6 — mora).** Interés simple sobre el saldo abierto, tasa
**mensual** prorrateada /30 por día, desde el día siguiente al vencimiento (o
al último día ya cobrado) hasta la fecha elegida, ambos inclusive. Tasa del
cliente (`clients.late_interest_monthly_rate`) o la general
(`finance_settings`). Nunca automático: en `/aging/mora` el usuario genera
**una ND por comprobante vencido** por `issueFiscalInvoiceAction` (origen = el
comprobante, IVA 21% en Ventas, misma moneda y cotización del día si es en
dólares). `late_interest_charges` guarda el período cobrado y la base; el
guard rechaza un período superpuesto a otro vivo del mismo comprobante,
intereses sobre una ND de intereses y cualquier edición. La ND lleva el id
del cargo como `idempotency_key`: un reintento devuelve la misma ND y, si se
pierde el vínculo, el período sigue tomado mientras la ND exista. Una ND
fallida o anulada libera su período. Permisos: emitir con `invoices:issue` +
`credit_debit_notes:issue`; tasa general con `credit_debit_notes:issue`;
tasa del cliente con `clients:write`.

**Decisión (4.6 — venta de cheques).** `check_sales` registra la venta
(comprador, cuenta, canal, nominal, intereses, comisiones, neto) y los
cheques pasan a `vendido` (estado nuevo, el texto del check se amplió). Por
cheque, una transferencia de su nominal de la cartera a la cuenta (como un
depósito: Dr banco / Cr cheques en cartera); por venta, un egreso de
intereses y otro de comisiones en esa cuenta imputados a **Intereses
pagados** (Dr intereses / Cr banco). La cuenta queda con el neto. Todos los
movimientos llevan `check_sale_id` y son "con dueño" (no se editan ni borran
desde Caja). `sell_checks` es idempotente por clave del diálogo, bloquea los
cheques en orden y rechaza uno fuera de cartera, otra moneda u otro canal, o
un costo que iguale el nominal. **Rechazo de un vendido:** `reject_check`
acepta `vendido`; el comprador lo devuelve desde la cuenta de la venta (o la
que elija el usuario) y se asienta como Deudores por cheques rechazados,
igual que uno depositado. Permiso: `cheques:write`.

**Descartado.** Área como estado o como tarifa general sin cliente
(`storage_tariffs` sigue sin área); estado `bloqueado` (rompería el parseo
estricto de `status` del código anterior); interés compuesto o con días
corridos sobre el saldo de cada día (se usa el saldo abierto al generar);
una ND por cliente con varios comprobantes (la ND tiene un solo origen);
generación automática por cron; contabilizar la venta como préstamo
(pasivo) hasta el vencimiento; la deuda con la financiera que no debita la
cuenta como pasivo pendiente (queda como follow-up).

## 2026-11-03 — Liquidación R y rendición de cobranza contra entrega (4.3 + 4.5)

**Decisión (4.3).** La liquidación de fletes es una entidad propia
(`freight_settlements` + `freight_settlement_items`): un cliente, un período
y sus cargas **entregadas** en ese período (por fecha de entrega, o la
programada si no tiene). Borrador → confirmada → facturada; cancelada libera
las cargas. Cada carga va a su flete o, si no tiene, a la tarifa de **flete**
del cliente vigente el día de entrega (concepto nuevo `freight` en
`client_tariffs`, unidad "por carga", solo en pesos). El precio se recalcula
al confirmar; confirmada queda congelada (cargas, total y flete de sus
cargas). La "R" es el documento interno de la liquidación: número `R-00000012`
(correlativo propio, se asigna al confirmar), PDF con recuadro "R" y la
leyenda "Documento no válido como factura" (`/api/freight-settlements/[id]/pdf`).
Se factura con **una** factura (una línea por carga, IVA 21% en Ventas;
remito interno en Otras ventas) por `issueFiscalInvoiceAction`, con el mismo
reclamo/liberación que "Facturar flete", y `link_freight_settlement_invoice`
deja cada carga apuntando a esa factura y le pone como flete el precio
facturado (así cuenta en la rentabilidad del viaje). Una carga está en una
sola liquidación viva (índice único parcial + guard) y mientras tanto no se
factura sola. Una factura fallida o anulada devuelve la liquidación a
confirmada (`invoices_release_freight_settlement`, como
`release_invoice_billing_links` con las cargas); una facturada solo se
cancela con la factura anulada o acreditada por NC emitida por el total.
Permisos: los de facturación (`invoices:read` / `invoices:issue`), sin
permiso nuevo; RLS de lectura owner/admin/finance, escrituras por RPC con
service role.

**Decisión (4.5).** `shipments.cod_amount` marca la carga contra entrega con
lo que el chofer cobra. La rendición (`driver_settlements` + items por carga

- líneas de lo entregado: cuenta, importe y cheque) es de un chofer (el del
  viaje de la carga) y guarda esperado, entregado y diferencia por carga.
  Confirmar (`confirm_driver_settlement`, bajo lock, idempotente) emite **un
  recibo por cliente y canal** con `create_receipt`: el recibo es dueño de sus
  movimientos de caja y de los cheques que entran a cartera (patrón de
  movimientos con dueño), y se imputa a la factura de cada carga hasta su
  saldo; el resto queda a cuenta. Un segundo confirm devuelve los mismos
  recibos. Confirmada queda congelada; se cancela solo con sus recibos ya
  anulados (en Recibos, con sus guardas). La diferencia se registra, no se
  asienta. Permisos: `receipts:read` / `receipts:write`.

**Descartado.** Liquidación con precio manual por carga (se corrige el flete
o la tarifa); tarifa de flete en USD; asentar la diferencia de la rendición
contra la cuenta corriente del chofer (queda pendiente); un recibo por
carga (muchos recibos para un mismo cliente); permisos nuevos por módulo.

## 2026-11-03 — Remitos únicos y tarifarios por cliente (4.1 + 4.2)

**Decisión (4.1).** El remito del cliente vive en la carga
(`shipments.remito_number`), no en una entidad aparte. Es único por cliente
entre las cargas no canceladas, comparado sin mayúsculas ni espacios en los
bordes, con un índice único parcial: la columna es nueva, así que no hay
duplicados previos que limpiar. Una carga cancelada libera el número (puede
volver en la carga que la reemplaza); sacarla de cancelada mientras otra
tiene su número falla. El formulario consulta `shipment_remito_conflict`
mientras se escribe, muestra la carga que ya lo tiene y no deja guardar.

**Decisión (4.2).** Tabla nueva `client_tariffs` (concepto almacenaje/carga/
descarga, unidad, precio, ARS/USD, vigencia inclusive) en lugar de agregar
columnas a `storage_tariffs`: un precio por concepto deja cambiar solo la
descarga sin duplicar el resto. Sin superposición por cliente y concepto, con
un trigger guard bajo lock (no `exclude using gist`, que pide `btree_gist`).
La facturación de almacenaje cobra cada día con la tarifa del cliente vigente
ese día (y carga/descarga con la del día de ingreso/egreso) y usa
`storage_tariffs` para el resto, así un cambio de precio a mitad de mes se
prorratea. USD se convierte al oficial del último día del período facturado o
el anterior; sin cotización no se factura. Permisos: los de almacenaje
(`storage_billing:read`/`issue`, RLS owner/admin/finance), sin permiso nuevo.

**Descartado.** Migrar las tarifas de `storage_tariffs` con cliente al
tarifario en esta tanda (cambia lo que se factura sin que nadie lo cargue);
concepto flete (el flete de la carga sigue a mano); cobrar con la general
los días de una tarifa en USD sin cotización.

## 2026-11-03 — Gestión v2: detalle, percibido por imputación, indicadores (3.7)

**Decisión.** El resultado de gestión se arma por documento en una sola
función (`management_pnl_lines`) que suman la cifra (`get_management_pnl`) y
su detalle (`get_management_pnl_documents`): lo que abre un número siempre
suma ese número. En **percibido**, un recibo o una orden de pago se reparte
según lo que imputó: la parte cobrada de ventas de bienes de uso va a "Venta
de bienes de uso", la pagada de compras con cuenta de flota a "Inversión en
flota" y la de compras a cargo de un empleado a "Anticipos al personal". El
adelanto y el pago del empleado también van a "Anticipos al personal" (antes
contaban como sueldos pagados): queda debajo del margen operativo y dentro
de la generación de caja, y el descuento de planilla o la condonación pasan
ese importe a sueldos internos de su mes, igual que en devengado. Una cuota
con desglose paga capital y el resto (interés, cargos, IVA y percepción) es
costo financiero. Indicadores: margen operativo %, resultado operativo
(EBITDA aprox.) y generación de caja contra los mismos meses del año
anterior. La tabla mes a mes se exporta a CSV/Excel con la leyenda "Uso
interno", armada en el navegador y auditada; no entra en el paquete del
contador.

**Descartado.** Repartir lo cobrado o pagado a cuenta (no se sabe a qué va
hasta imputarlo); armar la exportación en una ruta de `/api/export` (es la
misma tabla que ya está en pantalla); margen por camión con los datos de hoy
(los costos no llevan el camión: queda pendiente).

## 2026-11-03 — Cuenta corriente del empleado, aumentos en % y extras de viajes (3.3–3.6)

**Decisión (D1).** Adelantos, compras a cargo de un empleado y deudas son un
crédito contra el empleado, no costo: cuenta COA nueva "Anticipos al personal"
(rol `anticipos_personal`, activo) y una cuenta corriente por empleado
(`employee_account_movements`, ARS/USD, acreedor empresa o socio) con planes de
devolución (`employee_debt_plans`: total, cuota, activo/pausado/cancelado/
condonado). La planilla toma como Deudas la cuota de los planes activos en
pesos; editarla a mano la fija para ese mes (`deudas_override`) y se puede
volver a la cuota. Cerrar el período escribe el descuento en la cuenta y
reabrirlo lo saca; los períodos cerrados antes no escriben nada. "Adelanto a
empleado" en Tesorería y Caja es un egreso que pertenece al adelanto
(`record_employee_account_cash`) y se asienta contra el anticipo. Una compra
fiscal "a cargo de empleado" sigue en el Libro IVA, pero su neto va al
anticipo (fuera del costo operativo de Gestión) y su total a la cuenta del
empleado. En Gestión el costo aparece cuando se descuenta en planilla (o se
condona una deuda con la empresa), como sueldos internos de ese mes.

**Decisión (3.6).** Los aumentos se aplican en % por grupo (todos, puesto o
convenio) desde un mes; cada cambio del sueldo base queda en
`employee_salary_changes` y la planilla de un mes siembra el sueldo vigente en
ese mes. Las planillas en borrador desde ese mes que tenían el sueldo anterior
se actualizan; un sueldo editado a mano se respeta.

**Decisión (3.5).** Los extras de chofer se **sugieren** desde los viajes
completados del mes (jornadas, km, descargas × tarifas de la ficha) y se
agregan como extras comunes, editables; no se escriben solos.

**Descartado.** Seguir con Deudas como importe libre sin saldo; asentar el
descuento de planilla en el diario fiscal (lo cancela el asiento de sueldos
del liquidador); descontar planes en USD en la planilla (en pesos); escribir
los extras de viajes automáticamente (las tarifas y los viajes cargados tarde
los harían cambiar bajo los pies).

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

## 2026-11-02 — Dashboard "Hoy y esta semana" (D12)

**Decisión.** Arriba de los widgets del dashboard, una sección fija (no
personalizable) con tres tiles, cada uno solo para quien lee su módulo:

- **Vencimientos** (`tasks:read`): las tareas abiertas vencidas o que vencen en
  los próximos 7 días, de Tareas (que ya junta pagos a proveedores, cobranzas,
  cuotas, cheques propios y documentos con las manuales y recurrentes). Una
  tarea de un módulo que el usuario no lee no se muestra.
- **Viajes de hoy** (`trips:read`): los no cancelados de la fecha, con camión,
  chofer, clientes de sus cargas y estado.
- **Papeles por vencer** (`fleet_documents:read` para camiones y choferes,
  `hr:read` para empleados): vencidos o que vencen en 30 días, agrupados por
  titular. Un papel ya renovado (otro más nuevo del mismo tipo y titular) no
  cuenta, igual que en Tareas.

Un tile que no se pudo leer lo dice; no se muestra vacío. El asistente lo lee
con `getTodayOverview` (vencimientos con `getTasks`).

**Por qué fija.** Es lo primero que se mira al entrar; como widget, quien ya
guardó su layout no la vería hasta agregarla a mano.

**Pendiente.** El tile de km mensual pendiente espera a `vehicle_km_readings`,
que todavía no está en `main`.

## 2026-11-02 — Auditoría (D13)

**Decisión.** Pantalla Admin › Auditoría (`/admin/audit`, `features/audit`,
migración `20261103030000_audit_log`) sobre `audit_events`, con `audit:read`
(owner y admin, el mismo techo que la policy de la tabla). Lista fecha, quién
(usuario; "Asistente IA (por X)" cuando `actor_type = 'ai-agent'`, con X el
usuario que lo pidió o aprobó; "Sistema"), acción (`event_type`), módulo (la
primera palabra del `event_type`), link al registro y un resumen del payload
(`before`/`after`, `from`/`to` o los primeros campos). Filtros por fechas,
usuario, módulo y acción; "Ver detalle" muestra el payload completo; exportar
CSV (hasta 10.000 filas, queda auditado como `audit.exported`). El detalle del
comprobante tiene su "Historial" con el componente compartido
`RecordHistory`. Tool `getAuditEvents` para el asistente con el mismo permiso.

**Enmascarado.** En el servidor, por nombre de clave y a cualquier
profundidad: CBU, CVU y CUIL quedan con los últimos 4 caracteres; token,
secret, password, key, cert, credentials y firmas se reemplazan enteros. El
navegador nunca recibe el valor.

**Retención.** 400 días: el cron diario `audit-retention` (03:41 AR) llama a
`purge_audit_events()`, que tiene el corte fijo adentro y solo borra
`audit_events`. Los documentos contables no se tocan.

**Cobertura.** `lib/actions/audit-coverage.test.ts` falla si un archivo
`"use server"` de `features/` escribe (insert/update/upsert/delete o un RPC de
escritura) y nunca llama a `logAudit`, salvo los exentos listados con su
motivo (preferencias propias, chat, notificaciones, caché de padrón). Se
cerraron los huecos de adjuntos (`file.attached` / `file.detached`, sobre el
registro adjuntado) y de saldos iniciales de clientes y proveedores.

**Descartado.** Triggers de auditoría genéricos en la base (duplican lo que ya
registra cada acción y no saben quién aprobó en nombre de la IA); un historial
por registro en todas las páginas de detalle en este PR (queda el componente).

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
