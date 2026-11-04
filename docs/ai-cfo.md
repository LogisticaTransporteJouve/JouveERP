# AI CFO de Jouve — diseño y plan por fases

El asistente de IA de JouveERP pasa de "chat con tools de lectura" a **AI CFO**: ve todo el negocio
(fase 1), pregunta y actúa con confirmación (fase 2), muestra con gráficos y tablas (fase 3) y trabaja
solo con flujos recurrentes (fase 4). Este documento fija el diseño y el orden; el detalle de la
infraestructura de chat, insights y Document Intelligence sigue en [`ai-overview.md`](./ai-overview.md).

## Principios

- **Una definición por acción.** Cada capacidad del asistente es un `defineAiAction` (o
  `defineAiProposal`) en `features/ai/registry/`. De ahí salen los tools del chat, el resumen de
  capacidades del system prompt, las tarjetas de propuesta y (en fases siguientes) los flujos
  programados.
- **Mismos permisos que la app.** Una acción declara sus permisos (`lib/auth/permissions.ts`). El chat
  solo genera los tools que el usuario puede usar —el modelo ni siquiera ve, por ejemplo, los tools de
  sueldos si el rol no tiene `hr:read`— y cada ejecución vuelve a chequear el permiso. Debajo, cada
  acción llama a un server action con `requireUserContext()` + `userCan()` y las RPC son `SECURITY
INVOKER`, así que RLS aplica igual que en la app.
- **Cada módulo tiene su tool de lectura.** Toda feature nueva suma al registry al menos un tool
  `read` con el mismo permiso que su página (ej. `getTasks` con `tasks:read` sobre `/tasks`), que
  envuelve el server action de lectura de la feature y hereda su gate.
- **Cifras del servidor, nunca del modelo.** Los totales salen de SQL (RPC/vistas); el JS solo combina
  agregados ya calculados. Cada resultado trae `meta: { sources, asOf, partial, currency?,
exchangeRate?, note? }` y el prompt obliga a citarlo y a avisar si es parcial.
- **No es asesoramiento.** El asistente explica datos y trade-offs; no decide. Si le piden una
  recomendación, presenta opciones y cierra con un aviso fijo.

## Fase 1 — ve todo (hecha)

**Registry** (`features/ai/registry/`):

| Archivo        | Qué tiene                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `define.ts`    | `defineAiAction({ name, domain, description, input, output?, permission, sideEffect, sources, run })` → gate de permisos → Zod → `run` → `meta`. Nunca lanza. |
| `catalog.ts`   | `AI_ACTIONS`: todas las acciones, una vez.                                                                                                                    |
| `build.ts`     | `buildAiTools(ctx)` (tools AI SDK filtrados por rol) y `buildCapabilitiesSummary(roles)` (una línea por acción, agrupado por área).                           |
| `actions/*.ts` | Las acciones por dominio. Las 31 tools anteriores migradas sin cambio de comportamiento.                                                                      |

`sideEffect` es `read | propose | execute`; en fase 1 todas eran `read` (fase 2 suma `propose`).

**Lecturas nuevas con agregados** (migración `20261016090000_ai_cfo_read_aggregates.sql`, todas
`SECURITY INVOKER`, solo `authenticated`), cada una detrás de un server action en su feature:

- **Sueldos / RRHH** (`hr:read`): totales por mes o empleado (`ai_payroll_summary`), por concepto
  incluidos extras/horas extra (`ai_payroll_concepts`), extras de choferes por mes
  (`ai_driver_extras`), saldo de vacaciones con días por vencer (`ai_vacation_overview`), licencias
  (`ai_leaves_summary`) y asistencia (`ai_attendance_summary`). La planilla guarda montos **netos**:
  no hay sueldo bruto ni cargas sociales en la base (el resultado lo aclara).
- **Contabilidad** (`accounting:read`): EERR y balance con comparación entre períodos
  (`ai_account_type_totals`), resultados por centro de costo (`ai_cost_center_breakdown`), gasto por
  categoría y mes (`ai_expense_by_category`); además préstamos y cotizaciones.
- **Flota** (`trips:read`): margen por viaje, chofer, vehículo o cliente con combustible y
  mantenimiento imputados como en el reporte de rentabilidad (`ai_fleet_margin`).
- **Clientes** (`clients:read` + `invoices:read` + `receipts:read`): facturado en ARS, cobrado por
  moneda, días promedio de cobro y deuda abierta/vencida (`ai_client_sales_summary`).
- **Proveedores** (`suppliers:read` + `purchase_invoices:read` [+ `payment_orders:read`]): compras y
  pagos por proveedor, próximos vencimientos y evolución de precios por proveedor, categoría o ítem.
- **Dominios sin cobertura previa:** pagos recurrentes, depósito (stock de pallets
  `ai_pallets_summary`, depósitos, productos, tarifas y facturación de almacenaje), cargas
  (`ai_shipments_summary`), choferes, categorías de proveedor, AFIP (`afip:admin`: numeración por punto
  de venta `ai_afip_last_numbers` y CAEA, sin llamar a AFIP) y adjuntos (solo metadatos). La búsqueda global
  (`searchGlobal`) se retiró el 2026-11-04.

**System prompt:** persona "AI CFO de Jouve" en español rioplatense con voseo, solo lectura, resumen de
capacidades del usuario, "nunca inventes cifras; citá fuente y fecha; si un resultado es parcial,
decilo", datos como datos (anti-injection) y la regla de no-asesoramiento con aviso fijo.

## Fase 2 — pregunta y actúa (hecha)

**Preguntas (`askQuestions`).** Tool sin `execute` (`features/ai/registry/ask-questions.ts`): el
modelo pide 1–8 preguntas (`single`, `multi`, `text`; opciones `{ value, label }`, `allowOther`
suma "Otro"). La llamada corta el turno y el chat muestra una tarjeta. Al responder, el cliente pone
las respuestas como output del tool (`addToolOutput`) y manda `{ sessionId, questionAnswers }`; el
route valida las respuestas contra la tarjeta (`features/ai/lib/questions.ts`: cada pregunta una vez,
solo opciones de la tarjeta, texto acotado), las guarda como resultado del tool en el mensaje
persistido con un compare-and-set (solo si la parte sigue `input-available` en la base; un segundo
envío recibe 409 y el chat recarga la conversación) y agrega un turno fijo del usuario (oculto en la UI) para que el modelo siga en un turno
nuevo. "Omitir" responde `{ skipped: true }`. Una tarjeta respondida queda de solo lectura con las
respuestas.

**Propuestas (`sideEffect: "propose"`).** `defineAiProposal` (`features/ai/registry/propose.ts`):
`prepare` resuelve lo que dijo el modelo (nombres, códigos) con las acciones de lectura de cada
feature, valida el borrador con **el mismo Zod del formulario manual** y lo guarda como revisión
pendiente; no escribe nada de negocio. Devuelve `{ requiresConfirmation, confirmationId, action,
revisionKey, revision, title, draft, summary: [{ label, value }], confirmLabel, declineLabel }`, o
`{ requiresConfirmation: false, issues, candidates }` si falta o choca un dato (el prompt obliga a
preguntar con `askQuestions` en vez de elegir). Las specs de cada propuesta (schema, campos
editables, resumen, textos) están en `features/ai/lib/proposal-specs.ts`, compartidas por servidor y
tarjeta.

| Acción                | Permisos                               | Escritura al confirmar                        |
| --------------------- | -------------------------------------- | --------------------------------------------- |
| `proposeLeave`        | `hr:write` + `hr:read`                 | `lib/commands/create-leave.ts`                |
| `proposeJournalEntry` | `accounting:write` + `accounting:read` | `lib/commands/create-manual-journal-entry.ts` |
| `proposeExchangeRate` | `accounting:write`                     | `lib/commands/upsert-exchange-rate.ts`        |

Las escrituras viven en `lib/commands/` (sin gate propio, `server-only`, cliente con la sesión del
usuario, así RLS aplica, y `logAudit` adentro); el server action del formulario manual y el
ejecutor de la propuesta llaman a la misma función después de su propio gate. Así ninguna acción
de escritura cruza features.

**`ai_chat_confirmations`** (migración `20261016110000_ai_chat_confirmations.sql`): una fila por
revisión con `status` `pending | confirmed | declined | superseded | failed`. RLS: `authenticated`
solo lee sus filas (`user_id = (select auth.uid())` y rol con `ai:chat`); toda escritura va por el
service client después del gate y filtrando por el usuario (`features/ai/lib/confirmations.ts`).
Un índice único parcial permite una sola revisión `pending` por `(session_id, revision_key)`.

- **Confirmar** (`confirmAiProposalAction`): `ai:chat` + los permisos de la propuesta → re-valida el
  borrador con el schema del formulario → compare-and-set `pending → confirmed` (UPDATE con
  `status = 'pending'` en el WHERE) → ejecuta → guarda `result_id` o pasa a `failed` → `logAudit`
  (`ai.proposal.confirmed | failed`). Un doble click o una tarjeta vieja no ejecuta dos veces.
- **Descartar**: compare-and-set `pending → declined` + `logAudit`.
- **Modificar**: Dialog centrado con los campos editables de la spec, validado con el schema en el
  cliente y de nuevo en el servidor (`reviseAiProposalAction`, mismos permisos). Solo se toman los
  campos editables (no se puede cambiar el empleado o las cuentas desde el diálogo); la edición es
  la revisión siguiente de la misma tarjeta y reemplaza a la anterior. El reemplazo es por id y solo
  si esa revisión sigue `pending`: si un Confirmar ganó la carrera, la edición falla y no reabre una
  propuesta ya ejecutada. La cotización se edita con hasta 6 decimales, como en el formulario manual.
- **Reemplazadas**: el modelo revisa una propuesta pasando su `revisionKey`; la revisión pendiente
  anterior pasa a `superseded` (por id, solo si sigue `pending`) y su tarjeta dice "Reemplazada". Un
  `revisionKey` de otra acción se rechaza.
- **Fallidas**: si la escritura falla al confirmar, la revisión queda `failed` y no se reintenta;
  hay que volver a proponerla.
- El estado de las propuestas de la sesión entra cada turno como bloque de sistema ("Propuestas en
  esta conversación"), desde la base: el modelo sabe qué confirmó, descartó o editó el usuario.

**Chat.** Las partes del mensaje se renderizan en orden: texto en burbujas y tarjetas
(preguntas/propuestas) como bloques propios, así el texto posterior a una tarjeta aparece debajo.
El composer se bloquea mientras hay preguntas sin responder (salvo que la tarjeta no se pueda
mostrar); con una propuesta pendiente solo muestra un aviso, porque se le puede pedir un cambio al
asistente.

**Límites.** El diálogo de Modificar edita los campos simples (fechas, tipo, notas, descripción,
cotización); las líneas de un asiento se cambian pidiéndoselo al asistente. Si el servidor cae entre
el claim y la escritura, la fila queda `confirmed` sin `result_id`.

## Fase 3 — muestra (hecha)

**Artefactos** (`features/ai/artifacts/`): gráficos y tablas que el servidor arma con los datos de
una consulta del registry. El modelo elige la consulta, su input y la forma; nunca los números.

| Archivo     | Qué tiene                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spec.ts`   | Schemas Zod estrictos: configuración de gráfico (`bar`, `stacked`, `hbar`, `line`; `dataset`, `x`, hasta 3 series —6 en `stacked`—, orden, límite, formato) y de tabla (título, `dataset`, columnas), el artefacto que viaja al cliente y el pedido de fijado. Sin valores en ninguna configuración.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `build.ts`  | Arma el artefacto desde las filas: copia los valores (los `numeric` de Postgres pasan a número), rechaza una `x` repetida en vez de sumar, corta en 60 puntos (30 en `hbar`) o 300 filas × 12 columnas (y ~100 KB por artefacto) y lo marca como cortado. Cada columna toma su formato del nombre, con reglas en orden (`rows.ts`): códigos e identificadores (`*_code`, `*_number`, `numero`, CUIT, CBU) quedan como texto; `*_pct` es porcentaje; `*_count`, `qty`, `cantidad`, días y `total_<sustantivo>s` son cantidades; `*_usd`/`foreign` van en US$; el resto de montos en la moneda del resultado. Un campo inexistente devuelve un error con los campos que sí sirven, para que el modelo corrija. |
| `run.ts`    | `runArtifact(ctx, pedido)`: busca la acción entre las de lectura que el rol puede usar, valida el input con su schema y la ejecuta con el mismo gate que el tool (`requireUserContext` + `userCan` + RLS adentro).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tools.ts`  | Tools `renderChart` y `renderTable`. Mandan el artefacto como data part `data-artifact` (id = toolCallId) y al modelo le devuelven un resumen con `meta` de la consulta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `sink.ts`   | El puerto por el que los tools escriben al stream; el route lo conecta al writer. Sin sink (p. ej. una corrida en background) estos tools no se ofrecen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `export.ts` | CSV del artefacto desde las filas que ya están en pantalla (`lib/export/csv.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Stream.** El route envuelve `toUIMessageStream` en `createUIMessageStream` y conecta el sink al
writer; el mensaje persistido guarda la data part, así que el gráfico vuelve al recargar.
`convertToModelMessages` ignora las data parts: el modelo no relee los datos en el historial. Un turno
manda hasta ~400 KB de artefactos; pasado eso el tool devuelve un error y el modelo lo explica.

**Gráficos.** SVG propio y monocromo (sin librería de charts): barras con el extremo redondeado,
líneas de 2 px, series distinguidas por intensidad y trazo, leyenda desde 2 series, tooltip por
punto y vista de tabla. Números en es-AR. El único color es el anillo `primary` del punto con foco.

- **Apiladas (`stacked`, 6.2):** las partes de un todo por mes o categoría (costos por rubro por
  mes); positivos hacia arriba y negativos hacia abajo desde cero, solo el segmento externo
  redondeado, el tooltip suma el total y `sort` ordena por el total.
- **Unidades:** `valueFormat` `money` (la moneda del resultado), `usd`, `percent`, `count`, `km`,
  `number`. Por nombre de campo: `*_ars` y `*_per_km_ars` son pesos, `*_km` km, `*_count` cantidad.
- **`dataset`:** cuando el resultado trae varias listas, el modelo elige cuál graficar (ej.
  `getManagementPnL` → `byMonth`, `getTopCosts` → `byMonth`); sin `dataset`, la primera lista como
  antes, así los fijados viejos no cambian. Una lista inexistente devuelve un error con las que hay.

**Bloque de actividad.** Las consultas de cada respuesta ya no van como texto suelto: un bloque
plegable lista cada tool (estado, filas, fecha de cálculo, parcial o con error) y cada paso abre la
vista previa con las fuentes (`features/ai/lib/activity.ts`, `components/activity-block.tsx`).

**Exportar.** CSV en el cliente con las filas ya cargadas: comillas RFC 4180 y prefijo `'` en
celdas de texto que empiezan con `=`, `+`, `-`, `@`, tab o retorno (inyección de fórmulas); los
números siguen siendo números. No hay XLSX: no hay librería en las dependencias.

**Fijados** (`/ai/pinned`). "Fijar" manda solo la consulta, su input y la configuración, nunca
filas. `pinAiArtifactAction` (`ai:chat` + permisos de la consulta) la vuelve a correr, guarda el
input ya parseado y la configuración resuelta, y audita (`ai.artifact.pinned`). Al ver un fijado,
`loadAiPinnedArtifactAction` la recalcula como quien mira, con los permisos de ese momento: si los
perdió, la tarjeta dice que ya no tiene acceso y no trae datos. Hasta 30 por usuario y sin duplicados,
los dos controlados en la base (índice único por usuario + consulta + configuración, y un trigger con
lock por usuario que cuenta antes de insertar).

**`ai_pinned_artifacts`** (migración `20261016120000_ai_pinned_artifacts.sql`): `kind`, `title`,
`action`, `input`, `config`. RLS: `authenticated` solo lee sus filas (`user_id = (select
auth.uid())` y rol con `ai:chat`); las escrituras van por el service client después del gate y
filtrando por el usuario (`features/ai/lib/pinned-artifacts.ts`).

**Adjuntos.** El usuario adjunta PDF, imágenes, CSV o XLSX a un mensaje (clip, arrastrar, pegar o
cámara en el celular). El modelo recibe PDF e imágenes como archivos y las planillas como filas de
texto, todo como dato no confiable y dentro de un presupuesto por turno; los mensajes guardados
muestran chips con vista previa. Si un adjunto parece un comprobante, `proposeDocumentScan`
(`ai:chat` + `ai:read` + `files:write`) propone mandarlo a Documentos: al confirmar corre el mismo
pipeline de Document Intelligence (`features/ai/document/start.ts`) y el borrador se revisa en
`/documentos`. El contenido completo va en el turno en que se adjunta; después el modelo lo relee
con `openAttachment` si lo necesita, y un archivo que la API rechaza se deja afuera con un aviso.
Detalle de storage, RLS y límites en
[`files-patterns.md` §14](./files-patterns.md#14-adjuntos-del-chat-de-ia-y-página-files-2026-10-16).

## Consultas cruzadas (roadmap 6.1, hecha)

Tools de lectura que cruzan dominios (`features/ai/registry/actions/cross.ts`). Cada una compone los
server actions de lectura de cada módulo, así cada parte pasa por su `userCan` y RLS; lo que el
usuario no puede leer vuelve `null` (nunca `0`) y la nota del resultado dice qué se omitió y qué
permiso falta. Las cifras salen de SQL; el JS solo une y pagina. Todas paginan (`limit` hasta 100,
`offset`), leen como máximo 500 filas por fuente y marcan `partial` cuando una fuente llegó al
tope.

| Tool                       | Permiso para verla                       | Responde                                                                                                                                                                                                                                                                                                                                                       | Partes con permiso propio                                                           |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `getClientMargin`          | `clients:read` + `invoices:read`         | Margen de contribución por cliente: ingreso neto facturado (sin IVA ni tributos, facturas y ND − NC, USD a la cotización del comprobante o la oficial de su fecha; sin cotización, aparte) − costo de viajes y combustible imputado (repartido por flete). Separa el costo directo sin cliente y la flota no asignada (combustible sin viaje + mantenimiento). | Costos: `trips:read` + `shipments:read`                                             |
| `getClientPaymentBehavior` | `clients` + `invoices` + `receipts:read` | Días promedio de cobro del rango, cobrado por moneda, deuda de hoy (pesos, dólares y equivalente al último oficial), vencida, +90 días, comprobante más viejo, cheques rechazados y a cuenta. Ordenado por vencido.                                                                                                                                            | —                                                                                   |
| `getVehicleEconomics`      | `trips:read`                             | Por vehículo: viajes (no cancelados), km de viajes y de odómetro, litros y L/100 km, ingreso, costos de viaje, combustible y mantenimiento, neto, margen % e ingreso/costo por km (odómetro si están las dos lecturas; si no, km de viajes, marcado). Viajes sin vehículo aparte.                                                                              | Ingresos y costos: `shipments:read`; litros: `fuel:read`; odómetro: `fleet_km:read` |
| `getDriverActivity`        | `trips:read`                             | Por chofer: viajes, km, ingreso, costo y neto; del empleado vinculado, extras de planilla de los meses del rango, adelantos del rango y saldo de su cuenta. Viajes sin chofer aparte.                                                                                                                                                                          | Ingresos y costos: `shipments:read`; empleado: `hr:read`                            |
| `getTopCosts`              | `management:read`                        | Ranking de costos (uso interno) por rubro o centro de costo, devengado o percibido, con % y el resto en una fila, más `byMonth` y `seriesFields` para un gráfico apilado. Sin clasificar y USD sin cotización aparte.                                                                                                                                          | —                                                                                   |

RPC nuevas (migración `20261103150000_ai_cross_queries.sql`, `SECURITY INVOKER`, `search_path =
''`, solo `authenticated` y `service_role`): `ai_client_net_revenue`, `ai_vehicle_activity` y
`ai_driver_activity`. Las dos de actividad reciben flags `p_include_fuel | km | revenue | hr` que
el server action prende con `userCan`, así una denegación por usuario deja la columna en `NULL`
aunque RLS la permita. `getManagementPnL` suma `byMonth` (servicios, costos, margen, costo
financiero y generación de caja por mes) y marca `partial` si la lectura paginada llegó a su tope
(50.000 filas).

**Límites.** Margen por cliente: ingresos por fecha de comprobante y costos por fecha de viaje;
no reparte sueldos, mantenimiento ni gastos generales. Por vehículo, con `management:read`,
`getVehicleEconomics` suma el costo operativo del centro de costo vinculado al camión
(`get_vehicle_margin`, por meses completos) y trae aparte el costo sin camión; sin ese permiso,
seguros, patentes, cubiertas y compras cargadas solo con centro no entran. `getDriverActivity` trae
las rendiciones de cobranza contra entrega con `receipts:read`. `ai_fleet_margin` no cuenta viajes
cancelados.

**Impuestos** (`getTaxDocuments`, `features/ai/registry/actions/taxes.ts`, `taxes:read`, así que
también lo usa el contador): envuelve `listTaxDocumentsAction` y separa los impuestos vencidos,
los que vencen en los próximos `dueWithinDays` días (15 por defecto), los pagados en `period`
(por fecha de pago) y los abiertos con importe estimado; los anulados no cuentan y un impuesto
sin importe no suma (el resumen dice cuántos). Con `ivaPeriod` agrega el estimado de IVA de
`getIvaPositionEstimateAction`, que tiene su propio gate (`taxes:write` + `accounting:read`): si
lo rechaza, el resultado sale `partial` con la nota del motivo.

## Propuestas para todo, siempre con aceptación (roadmap 6.3, hecha)

El AI CFO propone escrituras y **nunca** las ejecuta sin que el usuario acepte. Es el mismo
`defineAiProposal` de la fase 2, ahora también fuera del chat.

**Mecanismo.** Cada propuesta es una acción `propose` del registry con su spec
(`features/ai/lib/proposal-specs.ts`: el Zod del formulario manual, el título, el resumen y los
campos editables). `defineAiProposal` expone `proposal.prepareDraft(ctx, input)` (resuelve
nombres con las lecturas de cada feature y valida el borrador, sin guardar nada) y
`proposal.executeDraft(ctx, draft)` (vuelve a parsear y escribe). Hay dos lugares donde se guarda
una propuesta pendiente:

- **En el chat**, `ai_chat_confirmations` (fase 2): revisiones por sesión y tool call, con
  Confirmar / Modificar / Descartar en la tarjeta. Lo que informa la escritura confirmada
  ("12 conciliadas; 1 salteada…") queda en `result_note` y la tarjeta lo muestra.
- **Fuera del chat** (hoy, desde una tarjeta de insight), `ai_proposals` (migración
  `20261103180000_ai_proposals.sql`): `action`, `input`, `draft`, `labels`, `summary`, `title`,
  `status` `pending | accepted | dismissed | failed | expired`, `result` (`{ id, note? }`),
  `error`, `expires_at` (24 h), quién (`user_id`) y cuándo (`created_at`, `decided_at`), más el
  insight de origen. RLS: `authenticated` solo lee sus filas y solo con un rol que tenga
  `ai:read`; toda escritura va por el service client después del gate.

**Aceptar** (`acceptAiProposalAction`, `features/ai/actions/proposal-actions.ts`): `ai:read` + los
permisos de la acción (los mismos del formulario manual) → vencida, se cierra como `expired` →
re-valida el borrador con el schema del formulario → compare-and-set `pending → accepted` con
`expires_at > now()` (el UPDATE toma el lock de la fila y re-chequea el predicado) → ejecuta →
guarda `result` o pasa a `failed` → `logAudit` (`ai.proposal.accepted | failed`). El trigger
`guard_ai_proposal` (hint `jouve_guard`) rechaza cualquier otra transición, aceptar una vencida,
cambiar lo que el usuario vio o guardar un resultado antes del claim: un doble click ejecuta una
sola vez. **Descartar** es el compare-and-set `pending → dismissed` + `ai.proposal.dismissed`.

**Desde un insight.** El analyst guarda en `ai_insights.proposal` `{ action, label, input }`. La
tarjeta muestra el botón solo si el usuario puede correr esa acción; al hacer click,
`prepareInsightProposalAction` relee el insight con su sesión (RLS + permiso de la tarjeta),
prepara el borrador **con los permisos de quien hace click** y lo guarda. El mismo insight
clickeado otra vez devuelve la propuesta pendiente (o la ya aceptada), no una segunda. Un Dialog
centrado muestra el resumen con **Aceptar / Descartar**. Nada se prepara en segundo plano.

**Acciones proponibles** (todas sobre escrituras que ya existían):

| Acción                          | Permisos                                                           | Escritura al aceptar                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `proposeLeave`                  | `hr:write` + `hr:read`                                             | `lib/commands/create-leave.ts`                                                                                                 |
| `proposeJournalEntry`           | `accounting:write` + `accounting:read`                             | `lib/commands/create-manual-journal-entry.ts`                                                                                  |
| `proposeExchangeRate`           | `accounting:write`                                                 | `lib/commands/upsert-exchange-rate.ts`                                                                                         |
| `proposeAiWorkflow`             | `ai:chat`                                                          | tarea IA recurrente                                                                                                            |
| `proposeDocumentScan`           | `ai:chat` + `ai:read` + `files:write`                              | pipeline de Document Intelligence                                                                                              |
| `proposeTask` (nueva)           | `tasks:write` + `tasks:read`                                       | `lib/commands/create-task.ts` (asignada a quien acepta)                                                                        |
| `proposeClientTariff` (nueva)   | `storage_billing:issue` + `storage_billing:read` + `clients:read`  | `lib/commands/create-client-tariff.ts` (guard de superposición)                                                                |
| `proposeBankMatches` (nueva)    | `transactions:write` + `transactions:read`                         | `lib/commands/match-bank-line.ts`: las sugerencias de Conciliación de una cuenta y período (hasta 30), cada línea por separado |
| `proposeLateInterestNd` (nueva) | `invoices:issue` + `credit_debit_notes:issue` + `invoices:read`    | `lib/commands/issue-late-interest-nd.ts` con `issueFiscalInvoiceAction` inyectado                                              |
| `proposeRecategorizeExpense`    | `transactions:write` + `purchase_invoices:write` + las dos `:read` | `lib/commands/recategorize-expense.ts` (`recategorize_expense`): cuenta de gasto y/o centro de costo de un egreso o una compra |

La ND por mora se **emite** al aceptar (con CAE en el canal fiscal), igual que "Generar ND" en
Intereses por mora; la propuesta guarda el interés que mostró y, si el saldo cambió, no emite. Las
dos últimas no tienen campos editables: un cambio invalidaría lo que el servidor vuelve a chequear.
Nueva lectura: `getLateInterestCandidates` (`invoices:read`).

**Recategorizar** (`proposeRecategorizeExpense`): el modelo pasa el gasto (`source`
`transactions` con el id de `getTransactions`, o `purchase_invoices` con el de
`getPurchaseInvoices`) y la cuenta y/o el centro por código o nombre (`ninguna` = la cuenta por
defecto, `ninguno` = sin centro); `prepare` los resuelve contra las opciones de los pickers y
pregunta si hay más de uno. La tarjeta muestra antes → después y no tiene campos editables. Es la
misma escritura que el Dialog "Recategorizar" de Caja y Compras: re-asienta, respeta el período
cerrado y el dueño del movimiento, y sirve sobre un movimiento conciliado (el bloqueo no cubre
esas columnas).

**Cómo sumar una.** (1) Mover la escritura del server action de la feature a
`lib/commands/<x>.ts` (sin gate propio; la action queda gate + parse + comando). (2) Spec en
`proposal-specs.ts` con el Zod del formulario y sumarla a `PROPOSAL_SPECS`. (3)
`defineAiProposal` en `features/ai/registry/actions/` con los permisos del formulario más las
lecturas de `prepare`, y agregarla a `AI_ACTIONS`. (4) Etiqueta en `tool-renderers.tsx`. (5) Para
ofrecerla desde un insight, el detector devuelve `proposal: { action, label, input }`.

## Indicadores e insights (roadmap 6.4, hecha)

Nueve indicadores deterministas en el analyst (`features/ai/insights/indicators/`:
`detect.ts` puro, `gather.ts` con el service client). Las cifras salen de SQL (RPC `ai_*`,
`late_interest_candidates`, `account_movement_totals`); el JS compara y aplica umbrales. Cada
uno tiene fingerprint (los registros a los que apunta; las tarjetas agregadas no tienen) y se ve
según su permiso (`INSIGHT_KIND_PERMISSION`, ahora con varios permisos por tipo, y la política
`ai_insights select` de la misma migración). Si las lecturas de un indicador fallan, se loguea y
el analyst **conserva su tarjeta anterior** en vez de borrarla; los demás siguen.

| Tipo                         | Se ve con                                          | Qué mide                                                                                                                                                                                                               | Propuesta                                                                                                               |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `client_margin_drop`         | `management:read` + `invoices:read`                | Margen de contribución por cliente (como `getClientMargin`) que cayó 10 puntos o más, últimos 90 días contra los 90 anteriores, con ≥ $100.000 de ingreso en cada uno                                                  | —                                                                                                                       |
| `vehicle_cost_per_km`        | `trips:read` + `fuel:read` + `maintenance:read`    | Costo por km (viajes + combustible + mantenimiento / km de odómetro o de viajes) que subió 20 % o más, con ≥ 1.000 km por período                                                                                      | —                                                                                                                       |
| `fuel_consumption_outlier`   | `fuel:read` + `trips:read`                         | L/100 km por encima de Q3 + 1,5 IQR de la flota (≥ 4 vehículos con ≥ 500 km), últimos 90 días                                                                                                                          | —                                                                                                                       |
| `late_interest_uncharged`    | `invoices:read`                                    | Interés por mora sin facturar (pesos y dólares aparte); sin tasa cargada, una tarjeta informativa                                                                                                                      | Generar ND por mora (la mayor en pesos)                                                                                 |
| `unreconciled_bank_lines`    | `transactions:read`                                | Líneas de extracto pendientes hace más de 15 días                                                                                                                                                                      | Conciliar con las sugerencias de la cuenta con más líneas (`proposeBankMatches`); sin sugerencias, tarea para conciliar |
| `pending_driver_settlements` | `receipts:read`                                    | Cargas contra entrega entregadas hace más de 3 días sin rendir y rendiciones en borrador de más de 7                                                                                                                   | Tarea de rendición                                                                                                      |
| `loan_installments_due`      | `accounting:read` + `accounts:read`                | Cuotas pendientes vencidas o que vencen en 14 días (préstamos activos)                                                                                                                                                 | Tarea de pago                                                                                                           |
| `cash_vs_financing`          | `accounts:read` + `accounting:read`                | Variación de la caja en pesos de 30 días contra desembolsos de préstamos y cuotas pagadas en esas cuentas; solo si entraron préstamos                                                                                  | —                                                                                                                       |
| `receivables_overdue_growth` | `clients:read` + `invoices:read` + `receipts:read` | "La mora creció X % vs hace 30 días": deuda vencida de clientes de la última foto de `aging_snapshots` contra la de 30 días antes (pesos y dólares aparte), con +15 % y ≥ $500.000 o US$1.000 más; crítica desde +50 % | Tarea de cobranza                                                                                                       |

Se mantienen las decisiones de UI: **Fijados** sigue igual y el dashboard no tiene Recalcular
(solo el panel de insights del asistente).

**Fotos del aging.** El cron `aging-snapshot` (diario, 05:37 AR) llama a
`capture_aging_snapshot`, que guarda en `aging_snapshots` el aging de clientes de hoy (todos los
canales, tramos, total abierto y vencido, pesos y dólares aparte); una segunda corrida el mismo día
reemplaza la fila. La tarjeta de mora aparece recién con 30 días de fotos, y no sale si la última
foto tiene más de 3 días o si hace 30 días no había deuda vencida (no hay porcentaje).

**Conciliación desde el insight.** El detector corre `suggestMatches` (el de la página de
Conciliación) sobre las líneas atrasadas de la cuenta con más líneas y los movimientos de esa cuenta
a ±5 días; con sugerencias, la tarjeta propone `proposeBankMatches` para el período de esas líneas
(hasta un año), que al hacer click vuelve a armar las sugerencias con los permisos del usuario. Si
esa lectura falla, la tarjeta sale con la tarea.

**Límites.** Margen y costo por km usan `ai_fleet_margin`, que cuenta viajes cancelados y lee
hasta 500 grupos. `cash_vs_financing` mira solo cuentas en pesos. La conciliación desde el insight
mira solo la cuenta con más líneas atrasadas.

## Fase 4 — trabaja solo (hecha)

**Correr como el usuario, sin sesión.** Los jobs de fondo no tienen cookie, así que
`lib/auth/acting-user.ts` guarda en un `AsyncLocalStorage` al usuario por el que se actúa y un token
de acceso corto (HS256, 15 min, `role: authenticated`, `sub` = el usuario) firmado con
`SUPABASE_JWT_SECRET`. Dentro de `runAsHeadlessUser` (`lib/auth/headless-user.ts`),
`createClient()` manda ese token en vez de leer cookies y `requireUserContext()` resuelve a ese
usuario con los roles que su propio cliente lee: cada acción del registry conserva su `userCan` y RLS
ve al usuario, igual que en el navegador. Antes de actuar, `resolveHeadlessUser` relee la cuenta
(baneada, borrada, sin email) y los roles **en el momento de correr**; sin `ai:chat`, deshabilitado
o sin el secreto configurado, no corre (falla cerrado). El token nunca sale del proceso. Antes del
trabajo real se prueba el token con una lectura mínima: si PostgREST lo rechaza (401, `PGRST30x`,
error JWT/JWS), la corrida o el resumen quedan `skipped` con `headless_unavailable`. **Depende del
secreto JWT legacy (HS256):** rotarlo o revocarlo, o un proyecto que solo verifique claves
asimétricas, deshabilita estos jobs hasta configurar el secreto vigente.

**Tareas IA recurrentes** (`features/ai/workflows/`, migración
`20261016130000_ai_workflows.sql`):

- `ai_workflows`: pedido en lenguaje natural + horario (`daily | weekly | monthly`, hora en grilla de
  15 min, día ISO o día 1–28) en hora de Buenos Aires (UTC-3 fijo, sin horario de verano) y
  `next_run_at`. Máximo 10 activas por usuario, controlado por un trigger con lock por usuario al crear
  o reanudar (dos pedidos simultáneos no pueden pasar el tope). Se crean desde la tarjeta `proposeAiWorkflow`
  (`defineAiProposal`, permiso `ai:chat`: "todos los lunes resumime cobranzas vencidas") o desde el
  Dialog de **Tareas IA** (`/ai/tasks`); el mismo Zod (`AiWorkflowDraftSchema`) valida ambos.
- `ai_workflow_runs`: una fila por ocurrencia, única por `(workflow_id, scheduled_for)`, con
  `status` `queued | running | succeeded | failed | skipped`, `output`, `summary`, `previous_run_id`
  y `skip_reason`.
- RLS: `authenticated` solo lee sus filas (`user_id = (select auth.uid())` + roles con `ai:chat`);
  toda escritura va por el service client después del gate del server action o desde Inngest,
  filtrando por el dueño.
- **Inngest:** `ai-workflows-materialize` (cada 15 min) toma las tareas vencidas, inserta la corrida
  (upsert que ignora duplicados), avanza `next_run_at` con compare-and-set (ocurrencias perdidas se
  juntan en una sola corrida) y manda un evento por corrida en cola con `id` = la corrida; cierra como
  `expired` las que llevan más de 23 h en cola (contadas desde que se encolaron, así la corrida de
  recuperación después de una caída larga sí corre). `ai-workflow-run` (idempotente por `run_id`,
  concurrencia 3 y 1 por usuario): _claim_ (tarea pausada, usuario sin acceso o tope de fondo →
  `skipped` con motivo; si no, `queued → running`), _execute_ (relee al usuario, corre el agente con
  `generateText` y solo tools `read` del usuario + `openEarlierRun`, sin propuestas, artefactos ni
  `askQuestions`, auditando cada tool como `ai-agent`) y _notify_ (notificación in-app
  `ai_workflow_run`). Si todas las consultas de la corrida fallaron, queda `failed` ("Ninguna
  consulta devolvió datos.") y no se notifica. Un error transitorio de Auth al releer al usuario
  reintenta en vez de marcarlo deshabilitado. El dueño sale de la fila, nunca del evento. El uso va
  a `ai_usage` como `workflow_run` una sola vez, después del compare-and-set que guardó el resultado.
- **Tope para jobs de fondo:** las tareas y el resumen semanal frenan al
  `AI_BACKGROUND_CAP_FRACTION` (70%) del tope diario de tokens (`checkAiDailyCap({ background:
true })`), así el chat siempre conserva margen.
- **Memoria:** la corrida guarda un `RESUMEN:` corto (última línea de la respuesta). La siguiente
  recibe `previous_run_id`, el resumen y el comienzo de la respuesta anterior, más un índice de hasta
  8 corridas previas (todo como dato, con `wrapUntrusted`); `openEarlierRun` abre una de esas, del
  mismo usuario y tarea, por id.
- **UI:** `/ai/tasks` lista las tareas (pausar/reanudar, borrar, nueva) y el historial de corridas
  con estado, resumen y la respuesta completa.

**Anomalías: ignorar o resolver.** Cada tarjeta de insight tiene **Resolver con IA** (abre el chat
con la alerta, sus cifras y los ids de los registros) e **Ignorar** (`ai:admin`, Dialog con motivo
obligatorio). Ignorar guarda `dismissed_reason`, `dismissed_by` y `dismissed_at` en `ai_insights`;
el `fingerprint` (tipo + hash de los registros) hace que el analyst no vuelva a crear ese mismo
hallazgo (busca solo los fingerprints de esa corrida, por tandas). Las tarjetas agregadas (caja, cobranzas) no tienen fingerprint: ignorarlas oculta solo esa
corrida. "Visto" sigue igual; descartar sin motivo ya no se puede.

**Resumen semanal** (`features/ai/weekly/`): lunes 07:50 (AR) `ai-weekly-summary-fan-out` manda un
evento por usuario con `ai:chat` que entró en los últimos 30 días; `ai-weekly-summary` (idempotente
por usuario + semana) corre como ese usuario las lecturas fijas que su rol permite (caja, cobrar,
pagar, vencimientos a 14 días, ventas y margen de flota de la semana, sueldos del mes anterior,
documentos por vencer) y una sola llamada al modelo, sin tools, redacta el resumen sobre esos
resúmenes calculados (nunca filas). Respeta el tope de fondo, se guarda en `ai_weekly_summaries`
(uno por usuario y semana) y se muestra arriba de los insights del dashboard.

**Evals** (`features/ai/evals/`): `routing-cases.ts` tiene preguntas en es-AR con la tool y los
argumentos esperados (sueldos de octubre 2025 → `getPayrollSummary` 2025-10; extras de choferes →
`getDriverExtras`; vacaciones; proveedores; margen de viajes; caja; una tarea recurrente →
`proposeAiWorkflow`; "días de pago" y "quién tarda más en pagar" → `getClientPaymentBehavior`,
"cuánto le facturamos a cada cliente" → `getClientSalesSummary`; recategorizar un gasto →
`proposeRecategorizeExpense`) y casos de permiso (operations no ve sueldos ni caja ni
recategoriza). `routing.test.ts` corre
sin red: un modelo guionado hace la llamada esperada y se verifica que el rol la tenga, que pase el
schema y el gate, y que llegue al server action con esos argumentos. `pnpm eval:ai` corre
`routing.live.test.ts` contra el modelo real (requiere `ANTHROPIC_API_KEY`; las tools devuelven un
stub, no tocan la base).

**Límites.** Sin `SUPABASE_JWT_SECRET` (o con el secreto legacy rotado) las tareas y el resumen
semanal se saltean (`headless_unavailable`). Si una corrida falla a mitad del modelo o se reintenta,
el uso del intento que no guardó resultado no queda registrado. Las respuestas
de las corridas no se exportan ni generan propuestas (solo lectura). La precisión por detector
(cuántas alertas se ignoran por tipo) todavía no se mide, ni hay plantillas de flujos (cierre
mensual, posición IVA, conciliación) ni evals de cifras o de rechazo de recomendaciones.
