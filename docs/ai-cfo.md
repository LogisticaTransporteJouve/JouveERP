# AI CFO de Jouve — diseño y plan por fases

El asistente de IA de JouveERP pasa de "chat con tools de lectura" a **AI CFO**: ve todo el negocio
(fase 1), pregunta y actúa con confirmación (fase 2), muestra con gráficos y tablas (fase 3) y trabaja
solo con flujos recurrentes (fase 4). Este documento fija el diseño y el orden; el detalle de la
infraestructura de chat, insights y Document Intelligence sigue en [`ai-overview.md`](./ai-overview.md).

## Principios

- **Una definición por acción.** Cada capacidad del asistente es un `defineAiAction` en
  `features/ai/registry/`. De ahí salen los tools del chat, el resumen de capacidades del system prompt y
  (en fases siguientes) las tarjetas de propuesta y los flujos programados.
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

## Fase 1 — ve todo (este PR)

**Registry** (`features/ai/registry/`):

| Archivo | Qué tiene |
|---|---|
| `define.ts` | `defineAiAction({ name, domain, description, input, output?, permission, sideEffect, sources, run })` → gate de permisos → Zod → `run` → `meta`. Nunca lanza. |
| `catalog.ts` | `AI_ACTIONS`: todas las acciones, una vez. |
| `build.ts` | `buildAiTools(ctx)` (tools AI SDK filtrados por rol) y `buildCapabilitiesSummary(roles)` (una línea por acción, agrupado por área). |
| `actions/*.ts` | Las acciones por dominio. Las 31 tools anteriores migradas sin cambio de comportamiento. |

`sideEffect` es `read | propose | execute`; en fase 1 todas son `read`.

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

## Fase 2 — pregunta y actúa

- **`askQuestions`**: tool de tarjeta con 1–8 preguntas (opción única, múltiple o texto). Corta el
  turno; las respuestas vuelven como un mensaje estructurado del usuario, no como texto libre.
- **Tools `propose`**: devuelven `{ requiresConfirmation, action, revisionKey, draft, summary rows,
  confirmLabel, declineLabel, inspect }`. El borrador se valida con **el mismo Zod que el formulario
  manual**; si falta o choca algo, la tool devuelve `issues` y `candidates` conversacionales (ej. dos
  clientes con nombre parecido) en vez de inventar.
- **`ai_chat_confirmations`** (RLS por `user_id`): una fila por propuesta con estado y `revisionKey`;
  confirmar es un compare-and-set (`pending → confirmed` solo si la revisión coincide), así un doble
  click o una tarjeta vieja no ejecuta dos veces.
- **Confirmar ejecuta el server action existente** (mismo `userCan`, mismo `logAudit`) con una clave
  de idempotencia derivada de la confirmación. Nada de escrituras propias del asistente.
- **Tarjetas reemplazadas:** una propuesta nueva sobre la misma entidad marca la anterior
  `superseded`; la UI la deshabilita.
- **Composer ocupado** mientras hay una tarjeta pendiente, y **frontera tool/texto**: el modelo no
  narra como hecho lo que todavía espera confirmación.

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
