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
- **Cifras del servidor, nunca del modelo.** Los totales salen de SQL (RPC/vistas); el JS solo combina
  agregados ya calculados. Cada resultado trae `meta: { sources, asOf, partial, currency?,
  exchangeRate?, note? }` y el prompt obliga a citarlo y a avisar si es parcial.
- **No es asesoramiento.** El asistente explica datos y trade-offs; no decide. Si le piden una
  recomendación, presenta opciones y cierra con un aviso fijo.

## Fase 1 — ve todo (hecha)

**Registry** (`features/ai/registry/`):

| Archivo | Qué tiene |
|---|---|
| `define.ts` | `defineAiAction({ name, domain, description, input, output?, permission, sideEffect, sources, run })` → gate de permisos → Zod → `run` → `meta`. Nunca lanza. |
| `catalog.ts` | `AI_ACTIONS`: todas las acciones, una vez. |
| `build.ts` | `buildAiTools(ctx)` (tools AI SDK filtrados por rol) y `buildCapabilitiesSummary(roles)` (una línea por acción, agrupado por área). |
| `actions/*.ts` | Las acciones por dominio. Las 31 tools anteriores migradas sin cambio de comportamiento. |

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
  de venta `ai_afip_last_numbers` y CAEA, sin llamar a AFIP), búsqueda global y adjuntos (solo
  metadatos).

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

| Acción | Permisos | Escritura al confirmar |
|---|---|---|
| `proposeLeave` | `hr:write` + `hr:read` | `lib/commands/create-leave.ts` |
| `proposeJournalEntry` | `accounting:write` + `accounting:read` | `lib/commands/create-manual-journal-entry.ts` |
| `proposeExchangeRate` | `accounting:write` | `lib/commands/upsert-exchange-rate.ts` |

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

## Fase 3 — muestra

- **Data parts en streaming** para gráficos y tablas: el servidor arma el spec Vega-Lite con los datos
  de las RPC y lo valida con Ajv contra el schema antes de mandarlo; el modelo elige el tipo de
  gráfico, nunca los números.
- **Bloque de actividad** (qué consultó, con qué filtros, cuánto tardó) plegable en cada respuesta.
- **Adjuntos** en el chat (reusa Document Intelligence para leerlos).
- **Exportar** una tabla a CSV/XLSX en Storage con link firmado.
- **Insights fijados**: guardar un resultado como tarjeta del dashboard que se recalcula.

## Fase 4 — trabaja solo

- **Flujos recurrentes** (cierre mensual, posición IVA, conciliación bancaria) definidos como plantillas
  y materializados a diario por una función Inngest en tareas con vencimiento.
- **Tareas de IA** que corren el agente con un objetivo y dejan resultado + propuestas pendientes de
  confirmación (nunca ejecutan escrituras sin confirmación).
- **Memoria entre corridas:** cada corrida guarda `previous_run_id` y un bloque de resumen; la tool
  `openEarlierRun` permite al agente revisar una corrida anterior.
- **Anomalías con precisión medida:** cada alerta se puede "arreglar" o "ignorar"; esas respuestas
  ajustan umbrales y miden precisión por detector.
- **Resumen semanal** redactado por el LLM sobre cifras calculadas.
- **Skills por tema** (IVA, cierre, cobranzas) inyectadas según la consulta, y **evals** con casos
  fijos por fase (cifras, permisos, rechazo de recomendaciones).
