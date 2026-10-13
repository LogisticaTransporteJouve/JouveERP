# JouveERP — IA Intelligence: resumen de diseño (Fase 0)

> **Estado:** **IMPLEMENTADO (AI.0–AI.8).** El código vive en `features/ai/`
> (60+ archivos: `agent.ts`, 25 tools de lectura, chat + historial, insights
> proactivos, Document Intelligence, reconciliación bancaria, skills). Este
> documento fue el plan de Fase 0 y se conserva como diseño de referencia; el
> estado real y lo pendiente están en `docs/pendientes.md`. Este es el plan de
> la feature de IA Intelligence: un agente LLM con acceso de lectura a todo el
> negocio, expuesto tanto como chat on-demand como insights proactivos que se
> surfacean automáticamente.
>
> Se apoya estrictamente en patrones que ya están en el repo (server actions +
> `ActionResult`, `userCan`/RLS, Inngest, TanStack Query, shadcn, Zod) y en la
> referencia de diseño de [`docs/ai-patterns.md`](./ai-patterns.md). No agrega
> infraestructura nueva más allá del SDK del LLM.

---

## 0. Reality check — qué es realmente este codebase

El brief original planteaba JouveERP como un ERP de transporte/camiones y pedía
IA centrada en flota (rentabilidad por viaje, utilización de camiones,
vencimiento de VTV/seguro). **El repo tal como está hoy es un ERP de
contabilidad/finanzas puro.** Inventario verificado:

- **30 dominios de feature, 0 dominios de transporte.** No existe ningún
  `viajes/trips`, `camiones/trucks`, `vehicles`, `drivers`, `fuel`, `routes` ni
  `maintenance`. El roadmap ubica **flota y viajes en Fase G** y la **IA en Fase
  I** (`docs/roadmap.md` §5) — ambas sin construir. Las claves de permiso
  `drivers:*`, `vehicles:*`, `trips:*`, `fuel:*`, `maintenance:*` ya existen en
  `lib/auth/permissions.ts` pero son placeholders reservados sin tablas detrás.
- Lo que **sí** existe end-to-end: ventas (comprobantes), compras, recibos,
  órdenes de pago, cuenta corriente de clientes y proveedores + aging, cheques
  (recibidos y emitidos), accounts/treasury/transactions, contabilidad completa
  (plan de cuentas, asientos, libro mayor, libro IVA ventas/compras, balances,
  inflación, centros de costo) y RRHH (empleados, sueldos, asistencia,
  vacaciones, documentos de empleado).

**Decisión tomada en este plan:** la IA ve y razona sobre los dominios que
existen. El catálogo de insights se rearma alrededor de
contabilidad/finanzas/RRHH (§5). Los insights de transporte del brief quedan en
una sección **diferida** claramente etiquetada, gateada a que se shippee la Fase
G. Si flota se construye primero, el mismo patrón de tools/insights se extiende
sin cambio arquitectónico.

Otros deltas respecto de `ai-patterns.md` y el brief, confirmados contra el
código:

| Item | Brief / `ai-patterns.md` asumía | Realidad | Plan |
|---|---|---|---|
| SDK del LLM | "ya targeteado" | `ai`, `@ai-sdk/*`, SDKs de anthropic/openai **no instalados** | Agregar en Fase 1 (`pnpm add`) |
| Vector store | pgvector "ya está" | **Sin extensión `vector`, sin embeddings** en ningún lado | **Descartado** (decisión 2026-07-04): FTS (`search_global`) cubre free-text; no se agrega infra de embeddings |
| `audit_events` | "tipo de actor IA" | la tabla **no tiene columna `actor_type`** | Agregar columna `actor_type` en migración de seguridad |
| Tablas de chat | `chat_sessions`/`chat_messages` | esos nombres son del **chat humano** | Usar `ai_chat_sessions` / `ai_chat_messages` |
| Multi-tenancy | `business_unit_id` en tablas de IA | la app es **single-CUIT** (`dz_sons`), decisión #1/#10 | Omitir `business_unit_id`; scope por `user_id` + RLS |
| Permisos IA | `ai:chat`/`ai:write`/`ai:admin` | no existen | Agregar `ai:chat`, `ai:read`, `ai:admin` (+ reservar `ai:write`) |

---

## 1. Stack (reuse-first)

| Tema | Elección | Por qué |
|---|---|---|
| Agent / tool loop | **Vercel AI SDK** (`ai`) `Experimental_Agent` + `stepCountIs(N)` | Restricción del brief; matchea `ai-patterns.md` §5 |
| Modelo | **Claude Sonnet 5.5** (`claude-sonnet-5-5`) para chat + extracción | Mejor tool-use/costo. Opus 5.5 (`claude-opus-5-5`) queda como escalado opcional futuro. Ojo: Sonnet 5.5 rechaza `tool_choice` forzado → la extracción usa `generateStructured` (tool con `auto`), no `generateObject` jsonTool |
| Modelo barato | **Claude Haiku 5.5** (`claude-haiku-5-5`) | Títulos de chat, clasificación de documentos/gastos, reparación de tool calls |
| Cadena de fallback | Gemini + GPT vía `@ai-sdk/google`, `@ai-sdk/openai` | Resiliencia a outage single-vendor |
| Background / proactivo | **Inngest** cron (existente `lib/inngest/`) | Restricción del brief; template = `aging-weekly-summary.ts` |
| Streaming | UI stream del AI SDK, in-process desde un route handler de Next | Sin Redis/relay (single app) |
| Acceso a datos | **Tool-calling sobre los server actions existentes** | Reusa `userCan` + `ActionResult`; determinístico, auditable |
| Agregación ad-hoc | Tool **SQL read-only** guard-railed | Cubre queries que los tools tipados no cubren |
| Búsqueda free-text | RPC FTS existente `search_global` | RAG con pgvector **descartado** (2026-07-04) |
| Persistencia | Tablas Supabase + RLS | Reusa auth; sin store separado |
| UI | shadcn + Tailwind v4 monocromo | Design system existente |
| Validación | Zod 4 (`schema.ts`) | Convención existente |

> Pricing (2026-10, por MTok; fuente única en `features/ai/lib/pricing.ts`):
> Sonnet 5.5 $2/$10 (lectura cacheada $0.20, escritura $2.50), Haiku 5.5
> $0.10/$0.50 (prompts ≤100K). El
> prompt caching de Anthropic sobre bloques estáticos del prompt es obligatorio
> cuando el system prompt crezca (`ai-patterns.md` §10): lectura cacheada ~0.1×
> input (−90%).

---

## 2. Arquitectura

### 2.1 Acceso a datos — tool-calling sobre la capa de lectura tipada (primario)

El agente nunca toca la base directamente para queries normales. Cada tool es un
wrapper fino y tipado sobre un **server action de lectura existente**:

```
LLM tool call ── features/ai/tools/<domain>/<tool>.ts
                   │  Zod inputSchema  (.describe() legible por el modelo)
                   ▼
                 action de lectura existente (ej. listInvoicesAction)
                   │  requireUserContext() + userCan(ctx.roles, "invoices:read")
                   │  getServiceClient() query → ActionResult<T>
                   ▼
                 el tool devuelve { ok, summary, data } al modelo
                              + (opcional) payload de artifact a la UI
```

Por qué esta forma:

- **Permisos gratis.** Cada action de lectura ya gatea con
  `userCan(ctx.roles, "<perm>:read")` y devuelve el envelope `ActionResult`.
  Envolverlos significa que el agente nunca puede leer lo que el usuario que
  llama no puede. Los tools se ejecutan bajo el `UserContext` del que llama,
  nunca con una identidad de servicio privilegiada propia.
- **Determinístico y auditable.** Un tool ≈ un action ≈ una query conocida. Sin
  acceso libre a la DB en el hot path.
- **Sin duplicación.** Donde un action devuelve exactamente lo necesario, el
  tool son ~15 líneas. Donde una lectura todavía no está cubierta, agregamos un
  action de lectura chico en la feature dueña (no en `features/ai/`), respetando
  el límite del slice.

> Nota sobre el patrón service-client: los actions de lectura existentes chequean
> `userCan` **y después** consultan con `getServiceClient()` (service role) — el
> chequeo de permiso a nivel action es el gate, RLS es defensa en profundidad.
> Los tools heredan esto exactamente; no agregan ningún bypass nuevo. (Es una
> desviación consciente del ideal de `ai-patterns.md` §23 de "nunca service role
> para lecturas", porque es el patrón establecido en los ~60 actions de lectura
> existentes.)

### 2.2 Escape hatch — tool SQL read-only (diferido)

> **Sin CLI, sin sandbox.** La implementación de referencia resuelve las queries
> ad-hoc con un CLI que corre dentro de un sandbox (Modal) y pega contra una API
> HTTP separada, con minteo de JWT, Redis y un relay SSE. Para JouveERP eso es
> infra de más — somos una sola app Next.js + Supabase + Inngest (decisión #8 del
> roadmap, "sin servicios extra hasta que duela"). No copiamos el CLI/sandbox: el
> agente llega a los datos solo por los tools tipados (§2.1), igual que el camino
> primario de la propia implementación de referencia (acciones de recurso
> read-only, sin SQL crudo).

Los tools tipados cubren todo el uso real (25 tools de lectura shipped), así
que el tool SQL quedó **descartado** (decisión 2026-07-04, junto con los
write-tools §4.7): el agente es read-only vía tools tipados y no ejecuta SQL
arbitrario. Si a futuro se revierte la decisión, el diseño guardado era:
`runReadOnlySql` in-process con denylist TS + transacción `read only` +
`statement_timeout` vía RPC `security definer`.

### 2.3 RAG (pgvector) — descartado

Decisión 2026-07-04: no se agrega pgvector ni proveedor de embeddings (infra
paga nueva sin caso de uso que lo justifique). La búsqueda free-text queda
cubierta por la RPC FTS existente `search_global`.

### 2.4 El agente

Un único `Experimental_Agent` tool-loop del AI SDK (`features/ai/agent.ts`):

- `stopWhen: stepCountIs(N)` — límite duro al loop.
- `callOptionsSchema` (Zod) — opciones por request (`route`, `surface`,
  `forceTool`, `skillIds`).
- `prepareCall` arma el system prompt (base + contexto por dominio, después +
  skills seleccionadas por keyword) y filtra `activeTools` por route para nunca
  volcar el catálogo completo al modelo.
- **Fallback de proveedor** vía un único `buildModel()` central
  (`lib/model-fallback.ts`).

**Dónde corre:**

- **Chat (interactivo):** `app/api/ai/chat/route.ts` — route handler de Next,
  `maxDuration = 300`, streamea el UI message stream del AI SDK in-process.
  Espeja la convención de route-handler existente (auth vía
  `requireUserContext()` + `userCan`, ej. `app/api/receipts/[id]/pdf/route.ts`).
- **Proactivo (background):** una función Inngest cron
  (`lib/inngest/functions/ai-insights-*.ts`) corre el mismo agente en modo
  "analyst", siguiendo el template `aging-weekly-summary.ts`, y escribe filas en
  `ai_insights`. Registrada en `app/api/inngest/route.ts`.

---

## 3. Catálogo de tools (tools de lectura por dominio real)

Cada tool envuelve el action existente nombrado. `*` = action de lectura nuevo y
fino a agregar en la feature dueña (todavía no existe una lectura adecuada).
Todos gateados al permiso listado.

### Ventas / Cuentas por cobrar
| Tool | Lee | Action backing | Perm |
|---|---|---|---|
| `getInvoices` | comprobantes (factura/NC/ND), filtrar/paginar | `listInvoicesAction` | `invoices:read` |
| `getInvoiceDetail` | un comprobante + items | `getInvoiceDetailAction` | `invoices:read` |
| `getReceipts` | recibos + cliente | `listReceiptsAction` | `receipts:read` |
| `getClientAging` | buckets de aging (`v_client_aging`) | `getAgingSummaryAction` | `receipts:read` |
| `searchClients` / `getClients` | lookup de cliente | `searchClientsAction` / `listClientsAction` | `clients:read` |
| `getLibroIvaVentas` | IVA débito por período/canal | `listLibroIvaVentasAction` | `accounting:read` |

### Compras / Cuentas por pagar
| Tool | Lee | Action backing | Perm |
|---|---|---|---|
| `getPurchaseInvoices` | facturas de compra, filtros ricos | `searchPurchaseInvoicesAction` | `purchase_invoices:read` |
| `searchSuppliers` / `getSuppliers` | lookup de proveedor | `searchSuppliersAction` / `listSuppliersAction` | `suppliers:read` |
| `getSupplierAging` | aging de proveedor (`v_aging_documents`) | `*` lectura nueva (ruta `aging-suppliers` existe) | `purchase_invoices:read` |
| `getPaymentOrders` | OPs + líneas | `listPaymentOrdersAction` | `payment_orders:read` |
| `getIssuedChecks` | cheques propios emitidos | `listIssuedChecksAction` | `issued_checks:read` |
| `getLibroIvaCompras` | IVA crédito por período/canal | `listLibroIvaComprasAction` | `accounting:read` |

### Caja / Tesorería
| Tool | Lee | Action backing | Perm |
|---|---|---|---|
| `getAccounts` | cuentas + saldo inicial | `listAccountsAction` / `getAccountOpeningBalanceAction` | `accounts:read` |
| `getTransactions` | movimientos etiquetados (`v_transactions_tagged`) | `listTransactionsAction` | `transactions:read` |
| `getTreasurySummary` | saldos + cheques por vencer | `getTreasurySummaryAction` | `accounts:read` |
| `getChecks` / `getChecksInPortfolio` | cheques recibidos, en cartera | `listChecksAction` / `listEnCarteraChecksAction` | `cheques:read` |

### Contabilidad
| Tool | Lee | Action backing | Perm |
|---|---|---|---|
| `getChartOfAccounts` | plan de cuentas | `listChartOfAccountsAction` | `accounting:read` |
| `getJournalEntries` | asientos + líneas | `listJournalEntriesAction` | `accounting:read` |
| `getLedger` | libro mayor (`get_ledger`) | `getLedgerAction` | `accounting:read` |
| `getTrialBalance` | balance de saldos / EERR (`get_account_balances`) | `getAccountBalancesAction` | `accounting:read` |
| `getCostCenters` | dimensiones | `listCostCentersAction` | `accounting:read` |
| `getInflationAdjustments` | ajustes RG 4667 | `listInflationAdjustmentsAction` | `accounting:read` |

### RRHH
| Tool | Lee | Action backing | Perm |
|---|---|---|---|
| `getEmployees` / `searchEmployees` | nómina de empleados | `listEmployeesAction` / `searchEmployeesAction` | `hr:read` |
| `getPayrollPeriod` | período de sueldos + entries | `getPayrollPeriodAction` / `listPayrollPeriodsAction` | `hr:read` |
| `getAttendance` | asistencia mensual | `getAttendanceMonthAction` | `hr:read` |
| `getEmployeeLeaves` | saldos de vacaciones/licencias | `listEmployeeLeavesAction` | `hr:read` |
| `getExpiringDocuments` | docs de empleado por vencer (`v_documents_expiring`) | `listExpiringDocumentsAction` | `hr:read` |

### Transversales
| Tool | Lee | Action backing | Perm |
|---|---|---|---|
| `searchGlobal` | FTS sobre clientes/proveedores/comprobantes/etc. | `searchGlobalAction` | `ai:read` |
| `getChannels` | canales de facturación (para scope) | `listInvoicingChannelsAction` | `ai:read` |
| `runReadOnlySql` *(descartado, §2.2)* | — | — | — |

> Los tools devuelven un **resumen compacto + IDs clave** al modelo (disciplina
> de tokens, `ai-patterns.md` §23), y el payload más completo a la UI como
> artifact donde una tabla/chart ayuda. Los params de fecha aceptan lenguaje
> natural ("mayo 2026", "Q1 2026", "últimos 30 días") parseado server-side
> (`ai-patterns.md` §29).

---

## 4. La página de IA — chat + insights (Fase 2/3, UI)

Ruta `app/(dashboard)/ai/page.tsx` (server component, prefetch de insights +
sesiones con Hydrate, patrón `receipts/page.tsx`). Entrada en el sidebar, grupo
propio **"Inteligencia"**. Streaming desde `app/api/ai/chat/route.ts` vía
`useChat`. Diseño monocromo oklch + shadcn (roadmap §1); severidad por **icono +
copy**, nunca color (decisión #13).

### Layout (desktop)

```
┌─ Inteligencia ──────────────────────────── [120K/500K hoy ▮▮▯] [+ Nuevo] ┐
├───────────────┬──────────────────────────────────────────────────────────┤
│ Historial     │  Insights (grid de cards, colapsable)                      │
│ ───────────   │  ┌─ Cash-flow ──┐ ┌─ Cobranzas ─┐ ┌─ … ─┐                  │
│ Hoy           │  │ ⚠ déficit    │ │ 3 a +90d    │ │     │                  │
│ · Caja marzo  │  │ -$420k el 28 │ │ [Preguntar] │ │     │                  │
│ · Deuda Acme  │  │ [Preguntar]  │ └─────────────┘ └─────┘                  │
│ Ayer          │  └──────────────┘                                          │
│ · …           │ ──────────────────────────────────────────────────────────│
│               │  Conversación                                              │
│               │   user: ¿cuánto me debe Acme?                              │
│ [+ Nuevo chat]│   tool: 🔍 Buscando facturas… → ✓ aging cargado            │
│               │      [artifact: tabla de aging]                            │
│               │   assistant: Acme debe $1.2M, $400k a +90 días…            │
│               │  ┌─ Escribí tu pregunta… ────────────────────── [Enviar ⏎]┐│
└───────────────┴──────────────────────────────────────────────────────────┘
```

- **Izquierda — Historial** (drawer en mobile): sesiones agrupadas por día
  (Hoy/Ayer/…), título autogenerado (Haiku, 1er turno). Click = retomar.
  `[+ Nuevo chat]`. `ai:admin` tiene toggle "todos los chats".
- **Arriba derecha — Insights**: grid de cards (§5), colapsable. "Preguntar sobre
  esto" abre chat pre-sembrado con el contexto del insight.
- **Centro — Conversación**: mensajes + tool cards + artifacts inline.
- **Header — medidor de tokens**: chip "consumido hoy: 120K / 500K" + barra. Al
  tope: input deshabilitado + aviso "Límite diario alcanzado, vuelve mañana".

### Componentes (portar de ai-patterns §13)

- `Conversation` — render de mensajes, scroll virtual.
- `Response` — markdown + highlight.
- `Reasoning` — bloque colapsable para extended thinking (si se usa).
- `Shimmer` — "Claude está pensando…" antes del 1er chunk.
- `ToolCallRenderer` — card por tool-call: icono + label (de `tool-renderers.ts`),
  estado running/done/error.
- `Artifact*` — tabla/chart inline cuando el tool devuelve datos renderizables.

### Insight cards (detalle)

Cada card: icono de severidad (info/warning/critical → `Info`/`TriangleAlert`/
`OctagonAlert` lucide, monocromo), **título**, **hallazgo de 1 línea**, **números
de soporte** (Geist Mono), acción **"Preguntar sobre esto"** y descartar (→
`status='acknowledged'`/`'dismissed'`). Orden por severidad.

### Estados de streaming (ai-patterns §27)

| Estado | UI |
|---|---|
| idle | input vacío |
| submitting | spinner en botón Enviar |
| streaming-text | texto char-by-char + cursor |
| tool-running | card "Cargando…" con icono |
| tool-complete | card colapsa, artifact se monta |
| tool-error | card con borde gris, el modelo explica |
| complete | mensaje cerrado, input habilitado |
| error | toast + botón reintentar |

### Empty state

Sin chats → prompts sugeridos clickeables: "¿Cómo viene la caja?", "¿Quién me
debe más?", "¿Qué tengo que pagar esta semana?", "IVA del período".

### Mobile

Historial → drawer. Insights → colapsable/carrusel. Chat full-width, input sticky
abajo.

---

## 5. Motor de insights proactivos — Fase 3

Una función Inngest programada (cron, template `aging-weekly-summary.ts`) corre
el agente en modo analyst sobre el negocio, emite tarjetas de insight a
`ai_insights`. La página de IA las renderiza como un dashboard de tarjetas:
título, hallazgo de una línea, números de soporte, severidad, y una acción
**"preguntar sobre esto"** que abre el chat pre-sembrado con el contexto del
insight.

**Prerrequisito (no-IA): pagos recurrentes.** Para que el cash-flow proyectado
sea real falta una feature CRUD normal — `recurring_payments` (alquiler,
servicios, préstamos, impuestos fijos, sueldos fijos, etc.: descripción, monto,
moneda, frecuencia, próximo vencimiento, fin opcional, cuenta, canal, centro de
costo, activo). **No es IA; es su insumo.** Debe shippear antes de AI.5.
(Extensión opcional: ingresos recurrentes — contratos fijos — para el lado de
cobros.) Va al roadmap como feature propia, fuera de `features/ai/`.

**Catálogo de insights MVP (sobre dominios reales):**

1. **Cash-flow proyectado — insight estrella.** Proyecta el saldo de caja hacia
   adelante (semanas/meses) combinando: cobros esperados (aging de cliente,
   timing por bucket) + pagos comprometidos (aging de proveedor + órdenes de pago
   + cheques propios por vencer) + **pagos recurrentes** (feature de arriba) +
   sueldos esperados (RRHH/payroll) + saldo de tesorería actual → alerta de
   déficit proyectado y cuándo cae. Es el caso que motiva la IA: ninguna pantalla
   hoy arma esto.
2. **Cambios en cobranzas (delta).** No re-muestra buckets (eso ya vive en
   `/aging`); solo el cambio: clientes que cruzaron a 90+, saltos de bucket,
   nuevos en riesgo, límite de crédito superado. Alimenta el "a quién llamar" y
   el lado de cobros del cash-flow (#1).

**Backlog de insights (AI.6+):** pagos a proveedores (a quién pagar / descuento
pronto pago), transacciones anómalas (movimientos atípicos / fuera de rango),
tendencias de margen por canal y centro de costo, riesgo de cartera de cheques,
outliers de sueldos / riesgo de saldo de vacaciones, vencimiento de documentos
(extender `document-expiry-alerts`).

**Quitados del plan (decisión 2026-06-16):** posición de IVA y facturas
duplicadas/anómalas — sin valor suficiente por ahora.

**Diferido — gateado a Fase G (flota), no construido hoy:** rentabilidad por
viaje, utilización de camiones, vencimiento de documentación de vehículos (VTV /
seguro / licencia). El mismo patrón de tool + insight aplica cuando esas tablas
existan.

---

## 5-bis. Document Intelligence — escaneo + OCR + extracción (roadmap I.2)

Adjuntar o **escanear** un archivo (factura de compra/venta, recibo, orden de
pago, remito, cheque, extracto, NC/ND) → la IA **detecta qué es**, **extrae
todos los datos** y, si es factura, **genera los ítems**. El usuario revisa y
confirma → se crea la entidad con los server actions de alta existentes.

Se apoya en infra ya construida: subsistema **files** (K.10 — upload, bucket
privado, `FileDropzone` con `capture="environment"` para cámara mobile, preview),
tablas de ítems (`purchase_invoice_items` K.8, `invoice_items`), y el spec de
**quick-OCR** (`docs/files-reference.md`).

### Cómo entendemos "qué quiere el usuario" (UX)

Dos modos, mismo pipeline:
- **(a) Contextual** — el usuario está en un alta ("nueva factura de compra") y
  sube/escanea. El **tipo ya se conoce** → se saltea la clasificación, se extrae
  directo con el schema de ese tipo. Camino más confiable, el preferido.
- **(b) Bandeja / escaneo genérico** — sube sin declarar tipo (ej. foto a un
  papel). La IA **clasifica**, propone tipo + confianza y rutea al alta
  pre-llenada. Si la confianza es baja o ambiguo → le pregunta al usuario qué es
  (chips: "¿Factura de compra? ¿Recibo? ¿Remito?").

El **contexto sesga la clasificación**: subir desde `/purchases` ⇒ bias a factura
de compra (análogo al "focal firm context" de la implementación de referencia).
Single-CUIT ⇒ la empresa foco siempre es DZ & Sons; lo que se infiere es la
**contraparte** (proveedor/cliente) y el **rol** (compra vs venta).

### Pantallas (UI)

**Entrada (a) — contextual (preferida).** En los diálogos de alta (Nueva factura
de compra, Nuevo recibo, Nueva OP) se suma una zona **"Escanear / adjuntar"**
(reusa `FileDropzone` de K.10b con `capture="environment"` → cámara mobile).
Flujo: subir/sacar foto → spinner "Leyendo documento…" → el formulario abierto se
**autocompleta**. Tipo ya conocido → sin clasificación.

**Entrada (b) — bandeja / escaneo genérico.** Ruta `app/(dashboard)/documentos/`
(o pestaña en `/files`): subir N o escanear → lista de extracciones pendientes.

```
┌─ Documentos ─────────────────────────── [Escanear 📷] [Subir] ┐
│ Pendientes de revisar                                         │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 📄 factura_acme.pdf   [Factura compra · 92%]   Revisar → │ │
│ │ 📄 foto_recibo.jpg    [Recibo · 78%]           Revisar → │ │
│ │ 📄 scan_03.pdf        [❓ Tipo dudoso]          ¿Qué es?→ │ │
│ └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```
Badge = tipo + confianza. Confianza baja/ambiguo → "¿Qué es?" con chips (Factura
compra / Recibo / OP / Remito / Cheque / Otro).

**Pantalla de revisión (la clave) — split preview + formulario.**

```
┌─ Revisar: factura_acme.pdf ─────────────────────────────────┐
│ Tipo: [Factura de compra ▾]  conf. 92%          [Descartar]  │
├──────────────────────────┬───────────────────────────────────┤
│  PREVIEW                 │  Datos extraídos (editable)         │
│  [PDF/imagen, zoom,      │  Proveedor: Acme SA  ✓ encontrado   │
│   páginas, rotar]        │  CUIT: 30-12345678-9                │
│                          │  Nº: 0001-00012345   Fecha: 12/03   │
│                          │  Neto 100.000 · IVA 21.000 · Tot …  │
│                          │  ⚠ Nº baja confianza (revisar)      │
│                          │  Ítems (tabla editable):            │
│                          │   desc | cant | p.u | alíc | total  │
│                          │  ⚠ Posible duplicado: 0001-12345    │
│                          │              [Cancelar] [Crear ✓]   │
└──────────────────────────┴───────────────────────────────────┘
```
- **Preview** izquierda (reusa `FilePreviewDialog` K.10b); **formulario
  pre-llenado** derecha = el mismo form de alta del dominio.
- **Match**: CUIT matchea proveedor → "✓ encontrado: Acme SA"; si no → "Crear
  proveedor nuevo" inline.
- **Baja confianza**: campos resaltados (borde + `TriangleAlert`) a verificar
  antes de crear.
- **Duplicado**: si el número ya existe → aviso; el usuario decide.
- **Tipo editable**: si la clasificación erró, cambia el dropdown → re-mapea.
- **[Crear]** → llama al server action de alta existente. Nada se crea sin click.

**Mobile**: split → apilado (preview arriba, form abajo); cámara desde el día 1.

### Pipeline (Inngest + Claude — cero infra nueva)

Adapta el patrón de 2 etapas de la implementación de referencia (clasificar →
extraer), pero en una **función Inngest** con `step.run` (no Temporal, no Modal,
no workers de consenso, no PGMQ):
1. **Upload** → bucket `files` (flujo K.10 existente).
2. **Clasificar** (etapa 1, solo modo b): Claude **Haiku 4.5** (vision/PDF) →
   `{ tipo, confianza, moneda, pistas }`. tipo ∈ `factura_compra | factura_venta
   | recibo | orden_pago | remito | cheque | extracto | nc_nd | otro`.
3. **Extraer** (etapa 2): Claude **Sonnet 4.6** con **structured outputs**
   (`output_config.format`, JSON schema Zod **por tipo** — schema angosto = menos
   alucinación). Para facturas incluye `items[]`.
4. **Post-inferencia determinística** (TS, sin LLM): triángulo de montos
   (neto/IVA/total — si hay 2, calcular el 3°), IVA por alícuota argentina
   (21/10.5/27/0/exento), vto desde condiciones de pago. Rellena lo que el doc no
   imprimió.
5. **Match / dedupe**: CUIT extraído → proveedor/cliente existente
   (`searchSuppliers`/`searchClients`, pg_trgm); número de comprobante → ¿ya
   cargado? (flag duplicado).
6. **Guardar borrador** en `ai_document_extractions` (estado `pending_review`).

PDF como input nativo de Claude (`type:"document"`, base64); imágenes como
`type:"image"` (shapes exactos en `files-reference.md §1.4`). Validación Zod del
output + retry (≤2) si no matchea schema.

### Revisar y crear (clave — distinto de la implementación de referencia)

La implementación de referencia hace OCR **sobre asientos ya cargados** (backfill,
sin review; las anomalías se marcan después). Acá es **carga de datos nuevos** →
**siempre hay paso de revisión antes de crear**:
- UI: alta **pre-llenada** con los campos extraídos, **lado a lado con el
  preview** del archivo. Campos de baja confianza resaltados.
- El usuario edita/confirma → se llama al **server action de alta existente**
  (`createPurchaseInvoice` + ítems, `createReceipt`, etc.). La extracción solo
  **pre-llena**; no inventa entidades.
- Auditoría: la extracción se loguea en `audit_events` con `actor_type='ai-agent'`;
  el alta es acción del usuario (su `actor_id`).

### Esquema de ítems (factura)

Por línea: `descripcion`, `cantidad`, `unidad`, `precio_unitario`, `bonif_%`,
`importe_neto`, `alicuota_iva` (21/10.5/27/0/exento), `importe_iva`,
`importe_total`. Una fila por línea visible; saltear subtotales/totales y filas
padre jerárquicas. Mapea a `purchase_invoice_items` (K.8) / `invoice_items`.

### Modelos + costo

- **Clasificar:** Haiku 4.5 ($1/$5) — tarea factual corta, ~10× más barato.
- **Extraer:** Sonnet 4.6 ($3/$15) — precisión en montos/ítems importa. Consenso
  multi-modelo (la ref corre 2 en paralelo + desempate) queda como mejora
  posterior; MVP = 1 call Sonnet + validación Zod + retry.
- Costo por documento ≈ **$0.02–0.08** según tamaño/páginas. Rate-limit
  `files:ocr` por usuario (ya sugerido en `files-reference.md`) para capear.

### Relación con quick-OCR (`files-reference.md`)

Complementarios, no duplicar:
- **quick-OCR** = insight ≤500 chars en **cada** upload, para **matching/búsqueda**
  (Haiku, barato).
- **Document Intelligence** = extracción estructurada completa, **on-demand**
  cuando el usuario quiere **crear** una entidad desde el doc.
- Pueden compartir la pasada de vision (un call que devuelve insight + extracción).

### Infra

Cero servicios nuevos: Inngest, Claude vía `@ai-sdk/anthropic` (AI.0), bucket
`files` (K.10), Supabase. **Sin Temporal, sin Modal, sin worker de consenso, sin
PGMQ** (eso es de la implementación de referencia y no aplica a una sola app
Next.js).

---

## 6. Tablas nuevas, RLS, auditoría

Migraciones: `YYYYMMDDHHMMSS_<scope>.sql` con timestamp en `supabase/migrations/`,
RLS en la misma migración, tipos regenerados después. RLS usa el helper
existente `public.user_has_role(text[])`.

```sql
-- ai_chat_sessions
create table public.ai_chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text,
  message_count int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- RLS: dueño de la fila, o ai:admin (owner/admin) ve todo.
--   select/insert/update/delete using (user_id = auth.uid()
--     or public.user_has_role(array['owner','admin']))

-- ai_chat_messages (cascade desde sessions)
create table public.ai_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.ai_chat_sessions(id) on delete cascade,
  role        text not null check (role in ('user','assistant','tool')),
  content     jsonb not null,
  tool_calls  jsonb,
  tokens_in   int,
  tokens_out  int,
  created_at  timestamptz not null default now()
);
-- RLS: vía pertenencia de la session padre / ai:admin.

-- ai_insights
create table public.ai_insights (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,             -- 'receivables_risk' | 'cashflow' | 'iva' | ...
  severity     text not null check (severity in ('info','warning','critical')),
  title        text not null,
  finding      text not null,             -- una línea
  metrics      jsonb not null default '{}'::jsonb,   -- números de soporte
  source_refs  jsonb not null default '[]'::jsonb,   -- {table,id} links para drill-in
  period       text,                      -- 'YYYY-MM' cuando es por período
  status       text not null default 'open' check (status in ('open','acknowledged','dismissed')),
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
-- RLS: read para holders de ai:read; write por service role (cron) / ai:admin.
-- severity maneja icono + copy, nunca color (diseño #13).

-- ai_usage (tracking de tokens/costo)
create table public.ai_usage (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid references public.ai_chat_sessions(id) on delete set null,
  user_id           uuid references auth.users(id) on delete set null,
  model             text,
  prompt_tokens     int,
  completion_tokens int,
  cached_tokens     int,
  cost_usd          numeric(10,6),
  tool_names        text[],
  created_at        timestamptz not null default now()
);
-- RLS: filas crudas solo ai:admin. El medidor del día (página IA, visible a
-- ai:read) lee un agregado vía RPC `ai_usage_today()`; el tope diario se
-- enforcea con un bucket de rate-limit aparte (`ai:tokens:daily`).

-- ai_document_extractions (Document Intelligence, §5-bis)
create table public.ai_document_extractions (
  id             uuid primary key default gen_random_uuid(),
  file_id        uuid not null references public.files(id) on delete cascade,
  detected_type  text,                  -- 'factura_compra' | 'recibo' | 'orden_pago' | ...
  confidence     numeric(4,3),          -- 0..1 de la clasificación
  payload        jsonb not null default '{}'::jsonb,  -- datos extraídos por tipo + items[]
  matches        jsonb not null default '{}'::jsonb,  -- {supplier_id?, client_id?, duplicate_of?}
  status         text not null default 'pending_review'
                   check (status in ('pending_review','confirmed','discarded','failed')),
  created_entity jsonb,                 -- {table, id} tras confirmar
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- RLS: borradores propios o ai:admin. Disparar extracción = ai:read + files:write;
-- confirmar = permiso de alta del dominio destino (p.ej. purchase_invoices:write).
```

**Auditoría:** agregar `actor_type text not null default 'user' check (actor_type
in ('user','ai-agent','system'))` a `audit_events` (hoy no tiene ninguna). El
agente es **read-only** vía tools tipados (SQL arbitrario y tools de escritura:
descartados, decisión 2026-07-04) — las creaciones desde Document Intelligence
las confirma un humano y se auditan con el flujo normal.

---

## 7. Permisos

Agregar a `lib/auth/permissions.ts` (y extender el test de matriz con 100% de
cobertura `lib/auth/permissions.test.ts`):

| Permiso | Significado | Roles |
|---|---|---|
| `ai:chat` | usar la superficie de chat | owner, admin, finance, operations |
| `ai:read` | leer insights, tool FTS | owner, admin, finance, operations |
| `ai:admin` | ver todos los chats, usage/costos, gestionar insights | owner, admin |
| `ai:write` *(descartado 2026-07-04)* | tools que mutan — no se implementan; el agente queda read-only | — |

Nota: los tools de datos gatean al permiso del **dominio** (ej. `invoices:read`),
así que un usuario solo ve datos que podría ver en la UI; `ai:chat`/`ai:read`
gatean el *acceso a la superficie*, no los datos.

---

## 8. Seguridad, costo, límites (Fase 4)

- **Agente read-only.** Tools de escritura y NL→SQL descartados (2026-07-04) —
  las escrituras pasan siempre por los flujos normales con confirmación humana.
- **Higiene anti prompt-injection.** Texto de la DB (`legal_name` del cliente,
  notas, etc.) envuelto en delimitadores y declarado como no confiable al modelo
  (`ai-patterns.md` §24). Params de ID validados como UUID vía Zod.
- **Rate limiting** vía el `enforceRateLimit()` existente (`lib/rate-limit.ts`,
  Postgres-backed, fail-closed): ej. 30 turnos/hora/usuario, un tope diario de
  tokens.
- **Tracking de costo** por turno → `ai_usage` + `logger.info("ai.turn",…)`
  estructurado.
- **Loop acotado** (`stepCountIs`) y **fallback de proveedor** para resiliencia.

### Costos aproximados (pricing 2026, por MTok) — todo Sonnet

| Modelo | Input | Output | Uso |
|---|---|---|---|
| Claude Sonnet 5.5 | $2 | $10 | chat + extracción de documentos |
| Claude Haiku 5.5 | $0.10 | $0.50 | títulos, clasificación, reparación de tool calls |

Prompt caching: lectura cacheada ~0.1× input (−90%), escritura 1.25× (TTL 5
min). Dos breakpoints: el system prompt (tools + prompt base) y el último
mensaje de cada paso del loop (`withTailCacheBreakpoint`), así el historial
también se relee desde caché. `estimateCostUsd` cobra lecturas/escrituras de
caché a su tarifa. Todo consumo (chat, títulos, Document Intelligence,
reparación) se registra en `ai_usage` con `kind` y cuenta para el tope diario.

> Las estimaciones de abajo son de la época Sonnet 4.6 ($3/$15); con 5.5 el
> costo por token es ~33% menor.

Estimaciones (supuestos, ajustables):
- **Chat:** ~$0.05–0.10 por turno (loop con 1–3 tool calls, system cacheado).
  5 usuarios × ~20 turnos/día × 22 días ≈ **~$150/mes**.
- **Insights:** ~$0.30–0.45 por generador por corrida. 2 insights → semanal
  ≈ **~$10–18/mes**; diario ≈ **~$40–70/mes**.
- **Total:** **~$160–220/mes** a uso moderado — lo domina el volumen de chat, no
  el modelo de insights.
- Sensibilidad: 2 users × 10 turnos/día → **~$40–60/mes**; 10 users × 40 → el
  chat escala a ~$600/mes (ahí el tope corta).

### Tope diario + medidor de tokens

- **Tope: 500K tokens/día/org** (config, ajustable; ≈ techo ~$90/mes de chat).
  Al alcanzarlo el chat devuelve 429 hasta el reset (medianoche ART).
- Enforce vía `enforceRateLimit()` sobre un bucket diario de tokens
  (`ai:tokens:daily`), Postgres-backed, fail-closed (`lib/rate-limit.ts`).
- **Medidor visible:** cada turno escribe tokens/costo en `ai_usage`; la página
  de IA muestra el consumo del día contra el tope ("consumido hoy: 120K / 500K"),
  leído por RPC agregada `ai_usage_today()`. `ai:admin` ve el desglose completo
  (por usuario, modelo, costo).

---

## 9. Plan de entrega (tamaño PR, MVP primero)

Cada PR: focalizado, migraciones + `database.types.ts` regenerado + tests donde
los patrones lo piden; lint/typecheck/test en verde. PRs abiertos como **draft**.

- **AI.0 — deps + permisos + audit actor_type.** `pnpm add ai @ai-sdk/anthropic`
  (+ google/openai); agregar `ai:chat`/`ai:read`/`ai:admin` + test de matriz;
  migración que agrega `audit_events.actor_type`. Todavía sin agente. *(chico)*
- **AI.1 — capa de acceso a datos.** Registry `features/ai/tools/`; ~8–10 tools
  de lectura de mayor valor (invoices, aging de cliente, treasury, transactions,
  facturas de compra, aging de proveedor, libro IVA, mayor) + los pocos actions
  de lectura nuevos; unit tests de tools. (Tool SQL diferido, §2.2.) *(mediano)*
- **AI.2 — agente + route de chat.** `agent.ts`, `lib/model-fallback.ts`,
  `app/api/ai/chat/route.ts` con streaming, system prompt base. *(mediano)*
- **AI.3 — página de IA + historial.** `app/(dashboard)/ai/page.tsx`, superficie
  `useChat`, render de tool-calls, `ai_chat_sessions`/`ai_chat_messages` + RLS +
  persistencia. *(mediano)*
- **AI.4 — tools restantes + artifacts.** Completar el catálogo; artifacts inline
  de tabla/chart. *(mediano)*
- **PRE — feature pagos recurrentes (no-IA).** Tabla `recurring_payments` + RLS
  + CRUD + permiso; insumo del cash-flow. Fuera de `features/ai/` → va al roadmap
  como feature propia. **Prerrequisito de AI.5.**
- **AI.5 — insight cash-flow proyectado.** Tabla `ai_insights` + RLS; job Inngest
  cron analyst que arma el cash-flow (cobros + pagos + recurrentes + sueldos +
  caja) + delta de cobranzas; tarjetas de insight + "preguntar sobre esto".
  *(grande)*
- **AI.6 — costo/límites/medidor.** `ai_usage` + RLS + **medidor de tokens** (RPC
  `ai_usage_today` + UI: consumo del día vs tope); rate limiting con **tope diario
  500K tok/org** (`ai:tokens:daily`); generadores de insight restantes; extender
  `document-expiry-alerts`. *(mediano)*
- **AI.8 — Document Intelligence (roadmap I.2, §5-bis).** Tabla
  `ai_document_extractions` + RLS; función Inngest clasificar→extraer (Haiku +
  Sonnet, structured outputs, schema por tipo); post-inferencia + match/dedupe;
  UI revisar-y-crear (preview lado a lado, pre-llena el alta existente). Arrancar
  por **factura de compra** (con ítems, K.8) — mayor volumen — y extender a
  recibo/OP/remito/cheque. *(grande)*
- **AI.7+:** sistema de skills ✅ (shipped). RAG con pgvector y tools de
  escritura + NL→SQL: **descartados** (decisión 2026-07-04 — sin infra de
  embeddings; el agente queda read-only, las escrituras las confirma un humano
  en los flujos normales).

---

## 10. Decisiones abiertas que necesitan tu aprobación

1. **D1 — Alcance de insights MVP. (resuelto 2026-06-16)** MVP = **cash-flow
   proyectado** (estrella) + delta de cobranzas. Quitados IVA y duplicados.
   Cash-flow depende de la feature no-IA **pagos recurrentes** (§5/§9), que debe
   shippear primero. Resto de insights → AI.6+. Abierto: dónde se especifica
   pagos recurrentes (entrada en `roadmap.md` vs spec aparte).
2. **D2 — Modelo y tope de costo. (resuelto 2026-06-16)** **Todo Sonnet 4.6**
   (chat + insights); Haiku 4.5 para títulos; Opus 4.8 descartado del MVP (queda
   como escalado opcional futuro). Fallback Gemini+GPT. **Tope: 500K tokens/día/org**
   (ajustable, ≈ ~$90/mes). Medidor de tokens visible en la página de IA (consumo
   del día vs tope, RPC `ai_usage_today`) + desglose para `ai:admin`. Costos en §8
   (~$160–220/mes uso moderado).
3. **D3 — Escape hatch SQL / CLI. (resuelto 2026-06-16)** **Sin CLI ni sandbox** —
   la implementación de referencia usa CLI-en-sandbox (Modal) + API HTTP separada
   + Redis + relay; para JouveERP (una sola app Next.js, decisión #8) es infra de
   más y complica el deploy. Primario = tools tipados. El tool SQL read-only se
   **difiere** (el MVP reducido no lo necesita); si se agrega, va in-process con
   denylist + RPC `read only` (§2.2), sin dep nueva.
4. **D4 — Alcance de insights vs roles. (resuelto 2026-06-16)** En el MVP los
   insights los ven **todos** (cualquiera con `ai:read`). El filtrado por rol —
   quién ve cada tarjeta, sobre todo las de RRHH (sueldos/vacaciones) — se define
   más adelante, cuando entren los insights de empleados en AI.6.
5. **D5 — Limpieza de `docs/ai-patterns.md`. (hecho 2026-06-16)** Reescrito: 26
   menciones a la implementación de referencia eliminadas, §19 (paths externos)
   borrada, §20 renombrada. `grep -i` da 0. Describe solo arquitectura JouveERP.

---

*Entregable de Fase 0. Freno acá para aprobación antes de cualquier código de la
feature.*
