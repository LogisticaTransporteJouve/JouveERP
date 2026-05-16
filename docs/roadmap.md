# JouveERP — Roadmap maestro

> Single source of truth. Lo que está arriba está **hecho y mergeado en
> `main`**. Lo que está abajo está **pendiente**, en orden de ejecución.
> Cada PR es chico, autosuficiente y testeable. Decisiones cerradas
> marcadas como **decididas**.

---

## 0. Contexto y decisiones tomadas

**Negocio:** Transporte Jouve es un grupo familiar argentino con **un solo
CUIT** (DZ & Sons S.A) que opera dos divisiones comerciales:

- **DZ Instalaciones** — venta de calefacción.
- **Logística Jouve** — transporte B2B.

Cada división tiene un canal **fiscal** (AFIP) y uno **interno** (no fiscal).
Total: 1 unidad legal × 2 divisiones × 2 canales = 4 canales. Pueden crecer
(nuevos puntos de venta, futuras divisiones), pero **no son organizaciones
separadas** — siguen siendo el mismo CUIT, mismas credenciales, misma caja.

La caja, las cuentas y los movimientos son **transversales**. El dueño quiere
ver "la caja de todo" en un solo lugar — pero cada movimiento queda etiquetado
con su canal para sostener trazabilidad ante una inspección de AFIP.

**Decisiones cerradas:**

| # | Decisión | Razón |
|---|---|---|
| 1 | **Una sola `business_units`** (`dz_sons`) + columna `division` en `invoicing_channels`. Sin `account_firms` ni multi-tenancy | App = 1 sola, 4 unidades, pueden crecer. No hay orgs independientes |
| 2 | **Inngest** para workflows durables | Free tier alcanza, retries + idempotencia built-in |
| 3 | **Fuzzy match de clientes solo para internos**, threshold **0.5** | El CUIT desambigua fiscales |
| 4 | Driver permissions con sufijo `:own` — **postergado a Fase G** | No abstracciones para features hipotéticos |
| 5 | **Playwright postergado** a Fase E | Vitest alcanza para Fases A-D |
| 6 | **pnpm 10** como package manager | `pnpm-workspace.yaml` se agrega cuando exista un servicio Nest aparte (no antes) |
| 7 | **Sin Redux**. **Zustand opt-in** (solo si aparece estado cliente complejo). **TanStack Query** default para server state | Redux solo se justifica con casos de streaming/IA complejos, que no tenemos hoy |
| 8 | **Backend Nest** solo si AFIP lo justifica más adelante. Default: **todo en Next.js + Inngest** | Sin servicios extra hasta que duela |
| 9 | **Branch flow `feature → main`** | `staging` se introduce cuando seamos > 1 dev |
| 10 | **F.4 (consolidación interno→fiscal) descartado** | Contradice el modelo: internos son operaciones que NO se declaran |
| 11 | **Una sola tabla `comprobantes`** para fiscal e interno; discriminador `channel.is_fiscal` | Listado, UI, permisos y FK únicos |
| 12 | **Cliente global por CUIT único**, compartido entre divisiones | Un cliente factura a Jouve y a DZ → mismo `clients.id` |
| 13 | **Sin colores de marca** — paleta 100% monocromática (oklch); destructive en gris | Producto comunica con tipografía + iconos + copy |
| 14 | **CRUD vía `Dialog` centrado**, no `Sheet` derecho | Preferencia del owner (contra patrón de La Pyme) |
| 15 | **Fase K (Compras/Pagos)** se agregó al roadmap después de F porque AFIP también necesita el lado AP | No estaba en el plan original |
| 16 | **Fase L (Contabilidad)** entra inmediatamente después de cerrar K | Antes de IA / Flota / Pallets, porque cierra el ciclo contable que pide el contador |
| 17 | **Fase J → Fase M** (renombrada) con scope concreto: backups, multimoneda, FTS, adjuntos, aprobaciones, portal cliente | "Hardening" en el plan viejo era difuso; M lo descompone en 6 sub-PRs |
| 18 | **K.4 descartado (2026-05-16): Jouve no es agente de retención ni de percepción.** | Sin caso real: proveedores mayormente monotributistas o montos chicos, no llega el mínimo de RG 830. Si aparece, se reabre. Aplica al concepto entero — `payment_order_retentions` no se crea |

**Stack confirmado:**

| Capa | Tecnología |
|---|---|
| Package manager | pnpm 10 |
| Frontend | Next.js 16 (App Router) + React 19 |
| UI | shadcn/ui (style `new-york`, base `zinc` → override monocromo) + Tailwind v4 |
| Tipografía | Geist Sans + Geist Mono (vía `next/font/google`) |
| Auth + DB | Supabase (RLS + realtime + Postgres) |
| Server state | TanStack Query (`@tanstack/react-query`) |
| Cliente state | Zustand (opt-in) |
| Forms | react-hook-form + `@hookform/resolvers/zod` |
| Validación | Zod 4 |
| Background | Inngest |
| Tests | Vitest + Playwright (E2E desde Fase E) |
| Logs | logger interno con redacción de secretos |
| AFIP | OpenSSL CMS para WSAA + SOAP manual + `fast-xml-parser` para A4/WSFEv1 |
| Observability | PostHog vía reverse proxy (`/ingest/*` → PostHog Cloud) |
| Errores | Sentry |
| PDF | `@react-pdf/renderer` (JSX-based, sin headless Chrome) |
| CI | GitHub Actions (lint + typecheck + test + build + types-drift + migration-order) |

---

## 1. Design system

### 1.1 Inspiración

Inspirado visualmente en **lapyme.com.ar** (sobriedad, densidad media). **Sin
colores de marca**: paleta 100% monocromática. El producto comunica con
contraste, espaciado y tipografía, no con hue.

La arquitectura de componentes y feature folders está documentada en
`docs/sumary-frontend-patterns.md` — cuando se implementa cada fase, se
consulta ese documento para los detalles concretos.

### 1.2 Colores — Tailwind v4 + `oklch()`

Sin `tailwind.config.js`. Todo en `app/globals.css` con `@theme inline`. Las
variables CSS están en espacio **OKLCH** (no HSL — más uniforme perceptualmente).

```css
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0 0);
  --primary: oklch(0.21 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.45 0 0);          /* monocromo: gris oscuro, NO rojo */
  --border: oklch(0.92 0 0);
  --ring: oklch(0.705 0 0);
  /* … resto de variables shadcn idem, hue forzado a 0 */
}

.dark {
  --background: oklch(0.141 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.92 0 0);
  --primary-foreground: oklch(0.21 0 0);
}
```

> **`destructive` también monocromo.** Por default es gris oscuro.
> Comunicamos peligro con copy explícito + iconos (`Trash2`, `TriangleAlert`).

### 1.3 Tipografía

- **Geist Sans** (UI) + **Geist Mono** (números, CUITs, IDs) vía
  `next/font/google` con CSS vars (`--font-geist-sans`, `--font-geist-mono`).
- Tamaños: `text-sm` default; `text-xs` metadatos; `text-2xl font-semibold`
  H1; `text-lg font-medium` H2.
- Pesos: 400, 500, 600. **Nunca 700** — Geist 600 ya pega.

### 1.4 Espaciado y radius

- `--radius: 0.625rem` (10px).
- Botones: `h-9 px-4` (default), `h-8 px-3` (sm), `h-10 px-6` (lg),
  `size-9` (icon).
- Container app: `mx-auto px-4 sm:px-6 lg:px-8`. Contenido: `gap-4` o `gap-6`.

### 1.5 Componentes shadcn (resumen)

- **Button** variantes: default / outline / secondary / ghost / link, todos
  monocromos por las CSS vars.
- **Sidebar**: cookie `sidebar_state` (max-age 7 días), `Cmd+B` toggle,
  drawer mobile bajo 768px.
- **Header sticky**: `sticky top-0 z-50 border-b bg-background/90 backdrop-blur`.
- **Tarjeta**: `rounded-lg border bg-card p-4`.
- **Tabla**: `<Table>` shadcn. Para listados grandes (≥500 filas) sumar
  TanStack Table + Virtual.
- **CRUD = Dialog**, no Sheet (decisión #14). Footer: primario "Crear" +
  secundario "Guardar y crear otra ⌘Enter" + Cancelar.

### 1.6 Iconos

`lucide-react` exclusivamente. `size-4` default, `stroke-width=2`.
`experimental.optimizePackageImports: ["lucide-react"]` en `next.config.ts`.

### 1.7 Animación

- `transition-all` para hover/focus.
- `duration-100` micro-interacciones, `duration-300` popover/dialog.
- `active:translate-y-px` feedback táctil en botones.
- `next-themes` con `disableTransitionOnChange`.

### 1.8 Patrones de La Pyme (referencia visual)

Catálogo de patrones extraídos de capturas de **La Pyme** (2026-05-08).
**Sidebar fijo izquierdo** con subnav por sección; **topbar** con selector
de empresa + búsqueda global `⌘K` + badge del plan; **plan de cuentas
jerárquico** con árbol expandible 1 → 1.1 → 1.1.1 (referencia directa
para L.1); **roles y permisos finos** con scope por caja/ubicación/PdV
(alinea B.2/B.3); **medios de pago con planes de cuotas** (M.5);
**onboarding checklist** colapsable; **datos fiscales con autofill por
CUIT** (ya implementado en C.2); **integraciones** con lista simple.

---

## 2. Convenciones de trabajo

### 2.1 Branches

- `main` → siempre verde. Solo merges de PR.
- `feat/<scope>` → features.
- `fix/<scope>` → bugfixes.
- `chore/<scope>` → tooling, deps, docs.

Una rama = un PR = una unidad lógica. Cuando seamos > 1 dev, agregamos
`staging` como gate intermedio.

### 2.2 Commits

Conventional Commits, **en inglés**:

```
feat: add accounts module with channel-tagged transactions
fix: skip fuzzy match for fiscal clients
chore: bump zod to 4.2
docs: clarify multi-division decision in roadmap
```

Cuerpo en presente/imperativo, líneas ≤80 chars. **Nunca** `Co-Authored-By`
ni footer de "Generated with Claude Code".

### 2.3 PRs

- Título corto (≤70 chars).
- Body con: **Summary** (1-3 bullets), **Migrations** (si hay), **Test plan**.
- **Abrir siempre como draft** (`gh pr create --draft`) — el workflow de
  Claude Review está gateado a no-draft.
- Verde en CI obligatorio.
- Squash merge — el cuerpo final se cura desde la descripción del PR.

### 2.4 Migraciones SQL

- Nombre: `YYYYMMDDHHMMSS_<scope>.sql` (alineado con timestamp Supabase CLI).
- Una migración = un cambio cohesivo.
- **Nunca** editar una migración mergeada. Si hay que ajustar, va una nueva.
- RLS habilitada en la **misma** migración que crea la tabla.
- `alter publication supabase_realtime add table public.<t>` solo si esa
  tabla necesita realtime UI.
- **CI `migration-order-check.yml`** valida que cada timestamp nuevo sea
  posterior al máximo en `main`. Previene colisiones en prod.

### 2.5 Tipos generados

- `lib/db/database.types.ts` se genera con:
  ```bash
  pnpm dlx supabase gen types typescript --local --schema public > lib/db/database.types.ts
  ```
- Se commitea al repo. CI lo regenera y compara — si hay drift, falla el PR.
- En todo `createClient()` se tipa: `createBrowserClient<Database>(...)`.

### 2.6 Testing

- Vitest para Zod schemas, helpers puros, matriz de permisos. **100%
  cobertura** de la matriz.
- Tests de penetración por rol (Vitest hits server actions con mocks) — desde Fase B.
- Integration suite contra Supabase local gateada por `RUN_INTEGRATION=1`.
- Playwright E2E desde Fase E. AFIP-emit smoke gateado por `RUN_AFIP_E2E=1`.

### 2.7 Husky

- `pre-commit`: `lint-staged` corre prettier + eslint en archivos staged.
- `pre-push`: si hay nuevas migraciones desde `origin/main`, regenera
  `database.types.ts` y falla si hay drift. También corre tests.

### 2.8 Estructura de features

Cada feature se autocontiene:

```
features/<feature>/
  ├── actions/        # "use server" — server actions
  ├── components/     # UI específica del feature
  ├── hooks/          # hooks específicos
  ├── lib/            # utils sin React
  ├── schemas/        # Zod schemas
  ├── types/          # TS interfaces
  └── index.ts        # barrel
```

Solo importa de: `@/components/ui/*`, `@/lib/supabase/*`, `@/lib/auth/*`,
`@/hooks/*` (globales). **Otras features → prohibido** (rompe el límite).
Si hace falta, se sube a `@/lib/`.

### 2.9 Hooks primero, lógica inline después

Antes de inlinear state machines / effects / async flows en un componente,
**evaluar si existe (o tiene que existir) un hook reutilizable**:

- Patrones project-wide (paginación, intersection observer, debounce,
  URL ↔ state, formato de fechas) → `hooks/use-*.ts`.
- Patrones de un feature (verify-CUIT, alta de comprobante) →
  `features/<feature>/hooks/use-*.ts`.
- Inlinear sólo cuando la lógica es genuinamente one-off.

---

## 3. Estado al 2026-05-16

**~48 PRs mergeados desde repo vacío.** La pata administrativa
(vender / cobrar / comprar / pagar) está end-to-end. La pata operativa
(camión / depósito / IA) no empezó.

### 3.1 Hecho — fases shippeadas

| Fase | Qué cubre | Detalle |
|---|---|---|
| **A — Bootstrap** ✅ | Next.js 16 + Tailwind v4 + shadcn + Supabase + Inngest + Vitest + Playwright + Sentry + CSP con nonce + CI completo + login + sidebar + theme toggle | Anexo §A |
| **B — RBAC + Multi-división** ✅ | 6 roles, ~45 permisos, matriz `userCan` con 100% cobertura Vitest, `canAssignRole`, trigger "owner mínimo", `audit_events`, 4 canales (DZ/Jouve × fiscal/interno), ScopeSelector | Anexo §B |
| **C — Clientes** ✅ | Cliente global por CUIT único. Verificación AFIP (WSAA + Padrón A4) con cache 24h + rate-limit 60/h + fallback stale. Búsqueda fuzzy `pg_trgm`. CRUD con verify-CUIT + soft-delete | Anexo §C |
| **D — Caja única** ✅ | `accounts` (caja única, sin `business_unit_id`) tipos bank/cash/wallet/investment/cheques/echeq. `transactions` etiquetadas por canal con `v_transactions_tagged`. RPC `create_transfer`. UI `/transactions` con filtros. Opening balances con FIFO | Anexo §D |
| **E — AFIP Comprobantes** ✅ | Workflow Inngest `issueInvoice` idempotente + retries + recovery vía `FECompConsultar`. Una sola tabla `comprobantes`. PDF + QR con `@react-pdf/renderer`. NC/ND con `cbtesAsoc`. Modo rápido "Emitir y continuar". E2E AFIP gateado | Anexo §E |
| **F — Cobranzas, recibos, cheques** ✅ | Recibos con numerador `R{POS}-{numero}` por canal. Payment lines con auto-creación de metadata de cheque. Allocations con sum-validation. RPCs lifecycle de cheques (deposit/credit/endorse/reject) con transactions linkeadas. Retenciones / percepciones. Cuenta corriente per cliente. Aging buckets + cron Inngest semanal | Anexo §F |
| **Subsistema social** ✅ | Chat (self/DMs/grupos, edit, reactions, typing, @-mentions, FTS ⌘K, channel admin), notifications (bell + popover + push real con service worker + Inngest), perfil con avatares monocromos | PR #44 — specs en `docs/chat-patterns.md`, `docs/notifications-patterns.md`, `docs/user-avatars.md` |

### 3.2 Fase K — Compras, Proveedores, Pagos — **parcial** ⏳

| Sub | Qué | Estado |
|---|---|---|
| K.1 | Suppliers CRUD + cuenta corriente + aging | ✅ PR #45 |
| K.2 | Purchase invoices CRUD + import AFIP (1313 facturas reales, 256 proveedores) | ✅ PR #46 |
| K.3 | Payment orders con líneas de cuenta, endoso de cheque, emisión de cheque propio (físico/ECHEQ) | ✅ PR #47 |
| K.5 | Vistas de aging proveedor | ✅ PR #47 |
| K.6 | Issued checks (cheques propios) | ✅ PR #47 |
| K.7 | OPs editables con cheques (RPC revierte endosos + borra issued_checks antes de reaplicar) | ⏳ PR #48 draft |

**Falta para cerrar K** — ver §4.1: K.8, K.9, K.10, K.11. (K.4 descartado, decisión #18.)

### 3.3 En vuelo

| PR | Branch | Estado | Próximo paso |
|---|---|---|---|
| #48 | `feat/edit-op-with-checks` | Draft, 2 commits, +380 LOC | Smoke browser → marcar ready → squash merge |

### 3.4 Refactors transversales mergeados

- **Query pattern rollout (PR #24, 2026-05-10):** RSC prefetch +
  `useSuspenseQuery` + `loading.tsx` + `(dashboard)/error.tsx` en todas
  las features. `lib/query/{query-client,prefetch,run-action,hydrate}.ts`
  + `lib/<f>-keys.ts` por feature. Borrado `app/api/jobs/[id]/route.ts`
  (polling vive en hook).
- **Dashboard unify + ES→EN slug rename (PR #39, 2026-05-12):** rutas y
  carpetas en inglés (`/clients`, `/invoices`, `/transactions`, `/checks`,
  `/receipts`, `/accounts`), receipts PDF endpoint,
  `app/(dashboard)/dashboard/page.tsx` landing.
- **Sidebar agrupado por sección (PR #47, 2026-05-14):** grupos Ventas /
  Compras / Cobranzas / Pagos / Caja / Admin.
- **Realtime cross-feature (PR #36, 2026-05-10):** hook genérico
  `use-realtime-invalidate.ts` cableado en 6 tablas respetando RLS.

---

## 4. Próximas fases

### 4.1 Fase K — Cerrar Compras/Pagos (próximo, antes de L)

> Para que la pata AP quede al nivel de la pata AR, faltan 4 sub-PRs:
> K.11 (bugfix NC origen), K.8 (items por línea, bloqueante para L.4),
> K.9 (PDF), K.10 (adjuntos). K.4 (retenciones) **descartado** por la
> decisión #18 — Jouve no es agente de retención ni de percepción.

#### ~~K.4 — `feat: retenciones en OPs (agente de retención)`~~ ❌ descartado

Modelaba a Jouve como agente de retención (RG 830 Ganancias, RG 2616 IVA,
regímenes IIBB). **No aplica** al negocio: proveedores mayormente
monotributistas o montos chicos, no llega el mínimo de retención. Si en
el futuro Jouve tiene que retener a un proveedor responsable inscripto
con factura > $X mensual, se reabre con el scope original (tabla
`payment_order_retentions` mirror de `receipt_retentions`, RPCs extendidos
con `p_retentions jsonb`, `RetentionsEditor` reusable).

#### K.11 — `feat: NC compra imputable a factura origen + aging fix`

**Bug latente descubierto en code review 2026-05-16.** El schema de
`purchase_invoices` ya tiene `invoice_origin_id` self-fk + `motivo_nc_nd`,
pero la UI **no expone el campo `invoice_origin_id`** — solo pide el motivo
en texto libre. Consecuencia:

- La cuenta corriente (`v_supplier_account_movements`) trata la NC con
  signo negativo correctamente (descuenta del saldo total). OK.
- El aging por buckets (`v_aging_documents`) filtra por
  `kind in ('factura', 'nd')` y **descarta las NCs**. Las facturas origen
  quedan con saldo abierto en el bucket aunque fueron parcialmente
  acreditadas por NC.

Fix en 3 partes:

1. **Componente `PurchaseInvoicePicker`** (nuevo en
   `features/purchase-invoices/components/`): combobox filtrado por
   `supplier_id` + `kind = 'factura'` + `status = 'received'` con search.
2. **Form change** en `purchase-invoice-form.tsx`: cuando
   `kind in ('nc', 'nd')`, mostrar el picker arriba del `motivo_nc_nd`.
   Acción / RPC ya soportan el campo, solo falta el wiring del form.
3. **Migración** que reescribe `v_aging_documents` para descontar
   `Σ NC.imp_total` con `invoice_origin_id = factura.id` del `open_amount`
   de la factura. Las NCs sin `invoice_origin_id` (las viejas que se
   cargaron antes de este PR) quedan como movimiento independiente —
   no las imputamos retroactivamente.

~150-200 LOC. Branch `feat/purchase-nc-origin-link`.

#### K.8 — `feat: items por línea en facturas de compra`

- Tabla `purchase_invoice_items(id, purchase_invoice_id, sku?, description,
  quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total, sort_order)`.
- Catálogo `iva_rates` con alícuotas argentinas (0, 10.5, 21, 27, no
  gravado, exento) si no existe; reusar si ya está en `comprobante_items`.
- **Necesario para libro IVA Compras detallado (L.4).** Hoy las
  purchase_invoices guardan totales pero no líneas — el contador necesita
  ver qué se compró por alícuota.
- Migración + form de líneas en `/purchases/[id]` + recalculo de
  totales auto.
- Backfill: las facturas importadas de AFIP en K.2 quedan con una sola
  línea genérica "Importado de AFIP, sin discriminar" — se editan
  manualmente cuando aparezca el caso.

#### K.9 — `feat: PDF de OPs`

- Plantilla `lib/pdf/payment-order-template.tsx` con `@react-pdf/renderer`
  (mismo patrón que recibos en F.3).
- Endpoint `/api/payment-orders/[id]/pdf` con generación on-demand
  (no preloaded en Storage — render bajo demanda como recibos).
- Contenido: encabezado (proveedor + canal + fecha + número), payment
  lines con cuenta y método, allocations con factura aplicada y monto,
  retenciones discriminadas, totales, observaciones, firma.
- Botón "Descargar PDF" en `/payment-orders/[id]`.

#### K.10 — `feat: adjuntos a compras (storage polimorfo — purchases only)`

- Bucket Supabase `purchase-attachments` con políticas: read finance/admin,
  write finance/admin.
- Tabla `purchase_invoice_attachments(id, purchase_invoice_id, file_path,
  file_name, mime_type, size_bytes, uploaded_by, uploaded_at)`.
- UI: drop zone en `/purchases/[id]` + preview inline de PDFs/imágenes,
  download para otros tipos.
- Sirve para guardar la factura del proveedor (PDF o foto) junto al
  registro contable.
- **Nota:** la generalización a cualquier entidad (comprobantes, OPs,
  clientes, suppliers) entra en **M.4**. K.10 implementa solo purchases
  porque es el caso más doloroso hoy (el contador siempre pide el PDF
  de la factura que se asentó). Spec completo en
  `docs/files-patterns.md`; OCR queda para Fase I.

**PRs Fase K para cerrar: 4 (K.11 → K.8 → K.9 → K.10) + K.7 que ya está en
PR #48.** ~1050 LOC totales.

---

### 4.2 Fase L — Contabilidad (después de K)

**Objetivo:** que el contador pueda cerrar mes desde JouveERP sin pedir
exports a mano. Cubre plan de cuentas, asientos auto, libros, balances
y exports regulatorios AFIP. **9 sub-PRs.**

#### L.1 — `feat: plan de cuentas jerárquico (chart of accounts)`

- Tabla `chart_of_accounts(id uuid pk, parent_id uuid self-fk, code text
  unique, name text, level int, account_type activo|pasivo|patrimonio|resultado_positivo|resultado_negativo|orden,
  eerr_category text nullable, system_role text nullable, is_active,
  created_by, timestamps)`.
- Codes jerárquicos 1 → 1.1 → 1.1.1 → 1.1.1.1.
- `system_role` ∈ `caja | banco | clientes | proveedores | iva_debito |
  iva_credito | iva_percibido | iva_retenido | ventas | compras | gastos |
  retenciones_pagadas | retenciones_cobradas | cheques_cartera |
  cheques_diferidos_emitidos | …`. **Clave para autoasientos de L.2.**
- RLS: read `accounting:read`, write `accounting:write`. Nuevos permisos
  en `lib/auth/permissions.ts`.
- UI `/accounting/chart` con árbol expandible (chevron + carpeta/documento
  + badge Activa + menú …, layout copiado de La Pyme §1.8). Form "Nueva
  cuenta" con combo del árbol como padre, código auto-sugerido, categoría
  EERR, rol del sistema.
- Seed con plan estándar pyme argentina (capítulos 1-5: activo, pasivo,
  patrimonio, resultados positivos, resultados negativos) que el
  contador puede ajustar.

#### L.2 — `feat: asientos automáticos desde transactions/invoices/OPs/receipts`

- Tabla `journal_entries(id uuid pk, entry_date date, accrual_period text
  'YYYY-MM', description, source_table text, source_id uuid, channel_id,
  created_by, created_at, is_reversal bool default false, reversed_entry_id
  uuid self-fk nullable)`.
- Tabla `journal_entry_lines(id, journal_entry_id, chart_of_accounts_id,
  debit numeric, credit numeric, description, sort_order)` con check
  `(debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)`.
- Trigger `enforce_journal_balance`: rechaza commit si
  `Σ debit ≠ Σ credit` por entry.
- Triggers AFTER INSERT/UPDATE/DELETE en `comprobantes` (status=emitted),
  `receipts` (status=issued), `payment_orders` (status=issued),
  `transactions`. Generan / actualizan / revierten el journal entry
  correspondiente. Lookup de cuenta vía `system_role` del plan (L.1).
- Tabla `auto_journal_mapping(event_type, account_role, conditions jsonb)`
  para casos no-1-a-1 (típico: IIBB por jurisdicción → cuenta distinta
  por provincia).
- UI `/accounting/journal` con timeline + filtros (período, source, canal).
  Cada entry linkea al source (factura, recibo, OP).
- Script `scripts/backfill-journal.ts` para procesar todos los movimientos
  históricos.
- Estados de cuentas y libros (L.3) leen de `journal_entry_lines`, no
  de las tablas operacionales.

#### L.3 — `feat: libro diario + libro mayor`

- **Libro Diario:** vista cronológica de `journal_entries` con drill-down a
  líneas. Filtro por período + canal.
- **Libro Mayor:** vista por cuenta contable con saldo running y filtro
  por período. Click en una línea → asiento completo + source.
- Exports: PDF con folios numerados (formato presentable a AFIP /
  contador) + Excel.
- RPC `get_ledger(account_id, date_from, date_to)` para no recalcular
  saldos en tiempo real cuando son muchos asientos.

#### L.4 — `feat: libros IVA Ventas y Compras (RG 1361)`

- **Libro IVA Ventas:** una fila por comprobante emitido (factura, NC, ND).
  Columnas: Fecha, Tipo, Letra, POS, Número, CUIT cliente, Razón social,
  Neto gravado por alícuota (21/10.5/27/0/no gravado/exento), IVA por
  alícuota, Percepciones, Total, CAE.
- **Libro IVA Compras:** una fila por `purchase_invoice` agrupado por
  alícuota (consume las líneas de K.8). CUIT proveedor, razón social,
  tipo de comprobante, neto, IVA discriminado, percepciones IIBB y
  nacionales, total.
- Filtros: período (mes/trimestre), canal, fiscal-only (los internos NO
  van al libro IVA por diseño).
- Exports: PDF con totalizadores por alícuota + Excel + formato compatible
  con SIAP / Mis Comprobantes (TXT posicional).
- Validación previa: lista comprobantes sin CAE, purchase_invoices sin
  items (de K.8) — no deja exportar si hay rotos.

#### L.5 — `feat: balance de saldos + estado de resultados + balance general`

- **Balance de saldos** a una fecha: código + cuenta + saldo deudor +
  saldo acreedor, agrupado por capítulo. Verifica `Σ deudor = Σ acreedor`.
- **Estado de Resultados** del período: agrupa cuentas tipo
  `resultado_positivo` / `resultado_negativo` por `eerr_category`
  (ventas, costo, gastos operativos, gastos financieros, gastos
  administrativos, otros) y muestra utilidad/pérdida.
- **Balance General** a fecha de corte: activo / pasivo / patrimonio
  agrupado por capítulo.
- Comparativos: período vs período anterior, mes vs YTD.
- Exports PDF + Excel.

#### L.6 — `feat: exports para contador — CITI Ventas/Compras + SIAP`

- **CITI Ventas (RG 3685):** TXT con encabezado + un registro por
  comprobante emitido + un registro por alícuota de IVA, formato fijo
  AFIP. Posicional, sin separadores.
- **CITI Compras (RG 3685):** mismo formato para `purchase_invoices` +
  items de K.8.
- **SIAP:** importable por el aplicativo de IVA con totales por mes.
- Página `/accounting/exports` con selector de período + botón por
  export.
- Validación previa idéntica a L.4 (no exporta si hay comprobantes rotos).
- Cron mensual opcional que pre-genera los exports del mes anterior y
  los manda al email del contador (vinculado a M.6 si llega antes).

#### L.7 — `feat: CAEA fallback (alta contingencia AFIP)`

- Cuando AFIP está caído > X minutos, permitir emitir contra **CAEA**
  (Código de Autorización Electrónico Anticipado) — solicitado una vez
  por quincena con un margen de comprobantes pre-autorizados.
- RPC `requestCAEA` + endpoint `/admin/afip/caea`.
- Workflow Inngest `issueInvoice` detecta error de AFIP y consume del
  pool CAEA si está disponible; si no, marca el comprobante como `failed`
  con motivo.
- Tabla `caea_pool(id, caea text, period_start, period_end, channel_id,
  total_authorized int, consumed_count int, status active|expired)`.
- Reporte de **informativos CAEA (RG 2926)** — TXT con los comprobantes
  emitidos contra cada CAEA, que se rinde a AFIP dentro de los 5 días.
- Anteriormente estaba en J.8; movido acá porque es responsabilidad
  contable / regulatoria.

#### L.8 — `feat: ajuste por inflación (RG 4667)`

- Tabla `inflation_adjustments(id, period text 'YYYY-MM', coefficient
  numeric, applied_at, applied_by, journal_entry_id, notes)`.
- Página `/accounting/inflation` con período + coeficiente manual (IPIM
  oficial INDEC o el que indique el contador) + leyenda + **preview del
  asiento** antes de aplicar.
- Genera un `journal_entry` de ajuste que reexpresa los saldos no
  monetarios según el coeficiente. **Reversible** vía `is_reversal +
  reversed_entry_id`.
- Reporte de cuentas reexpresadas vs cuentas a valor histórico para
  el contador.

#### L.9 — `feat: centros de costo (dimensiones contables)`

- Tabla `cost_centers(id, name, description, is_required bool,
  show_in_sales bool, show_in_purchases bool, is_active, timestamps)`.
- Columna `cost_center_id` opcional en `transactions`, `comprobantes`,
  `purchase_invoices`, `payment_orders`, `receipts`.
- UI: combo en cada form. Reporte EERR de L.5 puede filtrarse por
  centro.
- Para Jouve: separar resultados por vehículo / depósito / proyecto
  (e.g. "Flota DZ", "Flota Jouve", "Obra X").

**PRs Fase L: 9** (L.1 → L.2 → L.3 → L.4 → L.5 → L.6 → L.7 → L.8 → L.9,
ejecutables en este orden — L.2 depende de L.1; L.3/L.4/L.5/L.6 dependen
de L.2; L.7/L.8/L.9 son independientes entre sí).

---

### 4.3 Fase M — Hardening operacional (paralelizable a L)

> **Qué es Hardening:** todo lo que no es feature nueva pero hace al ERP
> confiable en prod — backups, recuperación, performance, exports
> regulatorios no-contables, multimoneda, FTS, adjuntos, aprobaciones,
> portal cliente. El roadmap viejo lo llamaba "Fase J" como bolsa; lo
> redefinimos como M con 6 sub-PRs concretos.

Heredado de la vieja Fase J:
- J.9 loading/error/not-found UX ✅ (PR #24)
- J.4 notificaciones ✅ (PR #44)
- J.8 CITI + CAEA → **movido a L.6 y L.7** (responsabilidad contable)

#### M.1 — `feat: backups automáticos + restore drill`

- Cron Inngest diario: `pg_dump --schema-only` + `pg_dump --data-only`
  comprimido → Supabase Storage `backups-daily/` con retención 30 días.
- Cron semanal: full dump → bucket frío con retención 1 año.
- Script `scripts/restore-backup.sh` documentado + **drill mensual** de
  restore en un proyecto Supabase temporal.
- Página `/admin/backups` con histórico + tamaño + checksum + fecha del
  último drill OK.

#### M.2 — `feat: multimoneda (USD con cotización BCRA)`

- Tabla `exchange_rates(date, currency, rate_to_ars, source bcra|manual,
  created_by, created_at)`.
- Job diario Inngest que pulla cotización BCRA (oficial + MEP).
- `transactions`, `comprobantes`, `payment_orders`, `receipts` aceptan
  `currency = USD`. Cuenta corriente **por moneda** (no mezcla).
- Reportes en moneda funcional ARS con conversión a fecha del movimiento.
- Indexación de tarifas (que Fase H necesita) queda con escalator
  vinculado a USD.

#### M.3 — `feat: full-text search global`

- Vista materializada `search_index` con `(entity_type, entity_id, title,
  body, tsv tsvector)` que une clientes, suppliers, comprobantes,
  purchase_invoices, payment_orders, receipts, transactions.
- Refresh trigger por tabla.
- Atajo `⌘K` extendido (ya existe para chat en PR #44) que busca en
  todo y navega al detalle.

#### M.4 — `feat: storage polimorfo (adjuntos a cualquier entidad)`

- Generalización de **K.10** (purchase attachments) a cualquier entidad:
  comprobantes, OPs, clientes, suppliers, transactions.
- Tabla `attachments(id, entity_type text, entity_id uuid, file_path,
  file_name, mime_type, size_bytes, uploaded_by, uploaded_at)`.
- Componente reusable `<AttachmentZone entityType entityId />`.
- Spec completo en `docs/files-patterns.md` (el motor de OCR queda para
  Fase I.2, no entra acá).

#### M.5 — `feat: aprobaciones de montos altos`

- Tabla `approval_thresholds(entity_type, action, amount_ars,
  requires_role)`.
- Trigger: si una OP / transferencia / pago supera el threshold y el
  actor no tiene el rol, queda en `pending_approval`.
- Sidebar entry "Pendientes" gateada en `admin|owner` con queue +
  botones aprobar/rechazar.
- Audit log de quién aprobó qué en `audit_events`.

#### M.6 — `feat: portal cliente (read-only)`

- Sub-app `/portal` con auth separada (magic link al email del cliente).
- Read-only: cuenta corriente del cliente, descarga de facturas/recibos
  asociadas a su CUIT.
- Sin escritura — el cliente no puede emitir nada.
- Permite "self-service" para clientes Jouve grandes que piden estados
  mensuales por email hoy.

**PRs Fase M: 6.** Paralelizables con L (son independientes).

---

## 5. Después de L y M

### Fase G — Flota y viajes (3 semanas, ~7 PRs)

Referencia: roadmap viejo §3 + §20.

- **G.1** choferes + vehículos.
- **G.2** viajes + costos + cargas.
- **G.3** driver `:own` permissions + RLS de viajes propios (decisión #4).
- **G.4** combustible + tarjetas YPF/Axion.
- **G.5** mantenimientos + cron de vencimientos.
- **G.6** `viaje_documentacion` (cartas de porte, remitos electrónicos).
- **G.7** rentabilidad por viaje / por vehículo.

### Fase H — Pallets (2-3 semanas, ~5 PRs)

Referencia: roadmap viejo §17.

- **H.1** depósitos + pallets propios.
- **H.2** productos + tarifas con vigencia temporal.
- **H.3** movimientos + `calculate_storage_billing`.
- **H.4** PWA + scanner QR.
- **H.5** `emitStorageInvoice` + reportes de ocupación.

### Fase I — IA (3-4 semanas, ~7 PRs)

Plan completo en `docs/ai-patterns.md`. Integra el POC `claude-proxy/`
que vive untracked en el repo hoy.

- **I.1** Vercel AI SDK + Claude + prompt caching.
- **I.2** OCR remitos / facturas de compra (cierra `claude-proxy/`).
- **I.3** categorización automática de transactions.
- **I.4** asistente conversacional con tool use.
- **I.5** anomalías nightly (movimientos atípicos, precios fuera de rango).
- **I.6** cobranzas auto (drafts de email/WhatsApp por bucket de aging).
- **I.7** newsletter mensual generado.

---

## 6. Orden de ejecución resumido

```
HOY ────► PR #48 (cerrar K.7)
          ↓
          K.11 → K.8 → K.9 → K.10             (cerrar K — 4 PRs, ~1050 LOC)
          ↓
          L.1 → L.2 → L.3 → L.4 → L.5         (contabilidad core — 5 PRs)
          ↓
          L.6 → L.7 → L.8 → L.9               (exports + ajustes — 4 PRs)
          ↓
          M.1 → M.2 → M.3 → M.4 → M.5 → M.6   (hardening — 6 PRs, paralelizables)
          ↓
          G (7) → H (5) → I (7)
```

**Total restante: ~38 PRs.** (4 K + 9 L + 6 M + 7 G + 5 H + 7 I.)

---

## 7. Anti-patrones (lecciones de proyectos previos)

1. **Mezclar deuda vieja con código nuevo.** Lo que se traiga del repo
   viejo va en PR aislado `chore: port <module> from old repo`.
2. **`select *`.** Especificar columnas siempre.
3. **`any` y `as`.** Bloqueado en ESLint flat config desde A.2.
4. **Migraciones sin orden.** CI dedicado.
5. **Tipos de Supabase a mano o sin generar.** Se generan, se commitean,
   CI checkea drift.
6. **PDF con headless Chrome.** Usar `@react-pdf/renderer` directo
   (decisión 2026-05-09 — `pdf-lib` quedó abandonado en 2022).
7. **Color para diferenciar acciones.** Sin colores. Iconos + copy +
   posición.
8. **PRs todo-en-uno.** Si el diff cambia migración + UI + tests + 3
   features, se parte.
9. **Realtime de Supabase para eventos críticos.** Solo para refrescar UI
   cuando otro user inserta. Workflows críticos van por Inngest.
10. **Multi-tenancy prematuro.** Nuestra app es single-CUIT; no introducir
    `organizations` ni separation por tenant.
11. **NestJS por moda.** Server actions de Next alcanzan hasta que duela.
    Evaluar §8 antes de partir.
12. **Redux por moda.** TanStack Query default para server state. Zustand
    solo si aparece estado cliente complejo.
13. **Fases sin actualizar el roadmap.** Si se shippea una fase nueva (caso
    K), el roadmap se actualiza en el MISMO PR — no se posterga.

---

## 8. Cuándo introducir un backend Nest separado

**No es default.** Se considera solo si pasa al menos uno:

1. Volumen AFIP > 1000 comprobantes/mes y la latencia de server actions
   de Next molesta.
2. Se necesita exponer una API pública (clientes, integraciones).
3. Aparece un segundo runtime (Python para ML, etc.).
4. El equipo crece > 2 devs y la separación frontend/backend ayuda al
   code review.

Si se introduce: se agrega `pnpm-workspace.yaml` con `apps/web` y
`apps/api`, se mueve la lógica AFIP a un module Nest. El patrón típico
(auth guard + decorator que inyecta context, `nestjs-cls` para propagar
`userId`, helmet + throttler) está documentado en
`docs/sumary-frontend-patterns.md` §10.

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| AFIP cambia API/cert | Alta | Alto | Inngest con retries; nightly homologación; **CAEA fallback (L.7)** |
| RLS mal escrita filtra datos | Media | Crítico | Pentest tests por tabla en CI desde B |
| Privilege escalation | Baja | Crítico | `canAssignRole` + tests |
| AFIP timeouts disparan latencia | Media | Medio | Cache TA (12h), padrón (24h), rate-limit |
| Drift de tipos generados | Media | Medio | CI workflow + husky pre-push |
| Costos IA crecen | Media | Medio | Prompt caching desde I.1 + cap por user |
| Dev solo se enferma | Alta | Alto | Roadmap + tests + PRs chicos |
| **Backup de DB falla y nadie se entera** | Media | Crítico | **M.1 drill mensual** + alerta si el cron no corre |
| **Inflación argentina destrampa los reportes** | Alta | Medio | **L.8 ajuste por inflación** + multimoneda M.2 |

---

## 10. Métricas de éxito

| Fase | Métrica | Objetivo |
|---|---|---|
| A | CI verde, login funcional, types generation | 100% |
| B | Cobertura matriz `userCan()` | 100% |
| B | Tests de penetración por rol | Pasan en CI |
| C | Verificación AFIP por CUIT | <2s p95 cache, <8s sin cache |
| D | Listado transactions con scope | <500ms p95 |
| E | Comprobantes sin intervención | >99% homologación |
| E | p95 emisión factura | <10s |
| E | Duplicados por idempotencia | 0 |
| F | Aging por cliente | <1s hasta 10k movimientos |
| **K** | Tiempo para registrar 100 facturas de compra del mes | <20 min con import AFIP |
| **K** | OPs editables sin corrupción de cheques | 0 incidentes |
| **L** | Libro IVA Ventas vs lo que dice AFIP | 100% match |
| **L** | Cierre de mes contable | <2 horas (era 1 día) |
| **L** | Asientos automáticos sin intervención | >95% |
| **M** | Restore de backup funcional | Drill mensual OK |
| **M** | Búsqueda global p95 | <300ms |
| G | Vencimientos doc con alerta | 100% |
| H | Discrepancia stock físico/sistema | <0.5% mensual |
| I | OCR remitos precisión | >95% |

---

## 11. Referencia rápida

- **Patrones de Sumary** (frontend, tooling): `docs/sumary-frontend-patterns.md`.
- **AI / Fase I**: `docs/ai-patterns.md`.
- **Subsistema social**: `docs/chat-patterns.md`,
  `docs/notifications-patterns.md`, `docs/user-avatars.md`.
- **Storage polimorfo**: `docs/files-patterns.md` (spec) +
  `docs/files-reference.md` (motor OCR para Fase I).
- **Implementación previa** (a portar selectivamente): repo
  `LogisticaTransporteJouve`, ramas `feat/business-units-scope` y
  `feat/accounts-transactions`.

Lecciones a no repetir del repo viejo:
- `lib/rate-limit.ts` tenía un upsert no-op antes del manualIncrement —
  copiar **solo el manualIncrement**.
- Threshold fuzzy `0.45` → corregido a **0.5** para internos, **skip**
  para fiscales.
- `driver: []` queda vacío hasta G.3.

---

# Anexo — Changelog histórico de Fases A–F + K

> Detalle por PR de las fases ya shippeadas. Útil para entender por qué
> está como está. **No se edita** salvo para corregir errores fácticos.

## §A — Bootstrap

### A.1 — `chore: init Next.js + pnpm + Tailwind v4 + shadcn`

```bash
pnpm create next-app@latest . --typescript --app --eslint --tailwind --src-dir=false --import-alias="@/*"
```

Engines + packageManager (`node >=20`, `pnpm@10.28.2`). Deps base: zod,
`@tanstack/react-query`, `@tanstack/react-table`, `@supabase/{ssr,supabase-js}`,
`next-themes`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`,
`radix-ui`, `react-hook-form`, `@hookform/resolvers`, `sonner`, `cmdk`. Dev:
`vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/{react,dom}`,
`prettier`, `eslint-config-next`, `tw-animate-css`.

shadcn init con `--style new-york --base-color zinc`. Override de paleta a
monocromática hue=0 en `app/globals.css`. Componentes iniciales: button,
input, label, select, badge, card, table, dialog, dropdown-menu, sheet,
sidebar, skeleton, separator, scroll-area, popover, tooltip, checkbox,
breadcrumb, form, alert, sonner.

`next.config.ts`: `experimental.optimizePackageImports: ["lucide-react"]`,
security headers (X-Content-Type-Options, X-Frame-Options, HSTS,
Referrer-Policy, Permissions-Policy). `tsconfig.json`: `strict: true`,
`noUncheckedIndexedAccess: true`, paths `@/*`.

### A.2 — `chore: tooling — vitest, eslint flat config, prettier, husky, ci`

ESLint flat config (`eslint.config.mjs`) con `@typescript-eslint/no-explicit-any: error`.
CI workflow (`.github/workflows/ci.yml`) — lint + typecheck + build sobre PRs
y push a main. Vitest config con alias `@/*`, env `node`.

Pendiente menor: `.prettierrc` y husky pre-commit/pre-push hooks concretos
quedaron para una pasada posterior (sin bloquear features).

### A.3 — `feat: base layout — sticky topbar, sidebar with cookie, theme toggle`

`app/layout.tsx` con Geist Sans + Geist Mono. `app/(dashboard)/layout.tsx`
con `SidebarProvider`, header sticky 56px, theme toggle. Dashboard landing
ampliado después en PR #39. `components/theme-toggle.tsx` con `next-themes`
(`disableTransitionOnChange`). `QueryClientProvider` con `staleTime: 30s`.
`scope-provider.tsx` con persistencia localStorage. Toaster sonner en root.

**Decisión global de CRUD:** Dialog centrado (no Sheet derecho).

### A.4 — `feat: logger with secret redaction + observability stub`

`lib/logger.ts` JSON estructurado, redacta `token`, `sign`, `cert`, `key`,
`password`, `authorization`. `lib/observability.ts` con `captureException`
que enruta al logger; cuando llegue Sentry se actualiza acá sin tocar
callsites. Tests cubren redacción + niveles.

### A.5 + A.7 — `feat: supabase clients + proxy.ts (CSP + session) + types generation`

Bundleado en PR #5. `lib/supabase/{server,client,service,proxy}.ts`. `proxy.ts`
en root (Next 16 renombró middleware), nonce per-request via `btoa(crypto.randomUUID())`,
CSP enforced con strict-dynamic. `lib/security/csp.ts` builder.

Ajuste vs spec original: `style-src` queda con `'unsafe-inline'` sin nonce
porque Tailwind v4 + `next/font` emiten `<style>` sin etiquetar. Scripts
siguen estrictos.

`supabase init` + migración mínima `<ts>_init.sql` con `pg_trgm`.
`scripts/db-types.sh` + `db-types-check.sh`. CI `db-types-check.yml`.

### A.6 — `feat: auth pages (login, logout) + protected dashboard`

`lib/auth/public-pages.ts` con `DONT_AUTH_REDIRECT_PREFIXES`. Proxy
extendido con redirect a `/auth/login` si no hay user + a `/dashboard` si
hay user en login. `app/auth/login/page.tsx` Card. `login-form.tsx` con
`useActionState`. Logout como POST con `<form>` (no GET).

---

## §B — RBAC + Multi-división

### B.1 — `feat: migration roles + user_roles + audit_events + helper user_has_role`

Migración `20260508201626_roles_and_audit.sql`. Catálogo `roles` con 6 filas
(owner=0, admin=1, finance=2, operations=3, warehouse=4, driver=5).
`user_roles` con PK `(user_id, role_id)`. `audit_events` con índices por
ts/actor/event_type, sin INSERT policy (service role only).

`user_has_role(text[])` `stable security definer` con `search_path` fijado.

**Constraint trigger deferrable** `user_roles_owner_minimum_trigger`:
levanta excepción si `count(*) where role_id='owner' = 0` después del commit.

Workflow `migration-order-check.yml` agregado en este PR.

### B.2 — `feat: permissions matrix + withAuth wrapper`

`lib/auth/permissions.ts` con `ROLES` (6) y `PERMISSIONS` (~45 entradas).
Owner y admin tienen el mismo set; la separación vive en `canAssignRole`.
`getCurrentUserContext` server-only en `cache()` de React. `withAuth`
wrapper genérico que lanza `AuthError` con códigos `UNAUTHENTICATED |
FORBIDDEN | VALIDATION`. 17 tests cubriendo coherencia + casos edge.

### B.3 — `feat: admin/users page (list + invite + assign/revoke)`

`/admin/users` con `bootstrapOwnerIfNeeded` (one-shot). Server actions con
filtro `canAssignRole` antes de mutar + emisión a `audit_events`. UI con
tabla + invite dialog + assign-roles dialog + role-checkbox-grid.

### B.4 + B.5 — `feat: business_units + invoicing_channels + ScopeProvider/Selector`

Bundleados. `business_units` con 1 fila `dz_sons` CUIT 30714637432.
`invoicing_channels` con 4 filas (DZ Fiscal/Interno, Jouve Fiscal/Interno).
`scope-provider.tsx` extendido que dropea division stale si los canales
cambian. `scope-selector.tsx` con 2 Selects en el header.

---

## §C — Clientes

### C.1 — `feat: clients table + RLS`

**Decisión 2026-05-08:** cliente global por CUIT único, una sola fila
compartida entre divisiones. Se descarta el `fiscal_counterpart_id self-fk`.

`clients(id, cuit unique 11 dígitos, legal_name, display_name, iva_condition
enum, email, phone, address, notes, is_active, created_by, timestamps)`.
Sin hard delete: soft via `is_active`. Server actions con auditoría +
mapping 23505 → "Ya existe un cliente con ese CUIT.". Zod con preprocess
que normaliza CUIT (acepta `30-71463743-2`).

### C.2 — `feat: AFIP plumbing (env, wsaa, ta cache, padron, rate limit)`

Migración `20260508220000_afip_caches_and_rate_limit.sql` con
`afip_ta_cache`, `padron_cache`, `rate_limit_buckets`, RPC
`bump_rate_limit_bucket` security definer atómico.

`lib/afip/{env,types,wsaa,padron}.ts`. `wsaa.ts` con firma CMS PKCS#7 vía
`openssl cms -sign` subprocess + cache memoria + DB + coalescing in-flight.
`padron.ts` con SOAP manual + `fast-xml-parser`. `lib/rate-limit.ts`
single-path, fail-closed.

`verifyCuitAction` con permiso `padron:lookup` + rate-limit 60/h + cache
DB 24h + fallback stale. Página `/admin/padron` para test manual.

### C.3 — `feat: clients UI (list, form with verify-CUIT, edit, deactivate)`

Migración `20260509120000_clients_search.sql` con `pg_trgm` + GIN
trigram + RPC `search_clients` security invoker. Search con debounce 250ms
push a URL. ClientForm con botón "Verificar AFIP" que (1) checkea duplicados
con `findClientByCuitAction`, (2) llama `verifyCuitAction` y autocompleta.
CUIT bloqueado en modo edit.

Validación inline con `zodResolver` diferida porque el schema con
`transform/nullable/optional` rompe la inferencia. Server-side cubre el
caso.

### C.4 — _diferido_: columnas parseadas de domicilio + filtro por ciudad

---

## §D — Caja única

> Orden de ejecución histórico: D.1 después de E.6 (recibos necesitaban
> cuenta destino), D.2+D.3 después de F.3. Hoy todo shipped.

### D.1 — `feat: accounts (caja única, sin business_unit_id)`

`accounts(id, name, type bank|cash|wallet|investment|cheques|echeq,
currency ARS|USD, opening_balance, notes, is_active, timestamps)`. Unique
sobre `(lower(name), type, currency)`. Cheques físicos y echeq como tipos
separados. Seed con cuentas reales del negocio.

### D.2 — `feat: transactions schema + actions + RPC`

`transactions(id, account_id, channel_id NOT NULL, kind
income|expense|transfer_in|transfer_out, amount, currency, transaction_date,
accrual_month CHECK day=1, description, comprobante_id,
counterparty_client_id, transfer_pair_id self, created_by, timestamps)`.
View `v_transactions_tagged`. Triggers de consistencia (transfer ↔
transfer_pair_id, comprobante ↔ channel match). RPC `create_transfer`
atómico con cross-pointer.

### D.3 — `feat: transactions UI (Caja)`

`/transactions` con filtros (canal, cuenta, tipo, rango). `useDeferredValue`
para mantener resultados visibles. Dialog "Nuevo movimiento" con kind picker
que conmuta entre 1 cuenta o 2. Mes devengado auto-aligned con la fecha
(input `type="month"` salvado como YYYY-MM-01).

---

## §E — AFIP Comprobantes

### E.1 — `chore: inngest setup`

`inngest@4.x` + singleton en `lib/inngest/client.ts`. Route handler
`app/api/inngest/route.ts`. README documenta el flujo de 3 terminales.

### E.1.5 — `feat: AFIP admin foundation`

`lib/afip/wsfev1.ts` minimal (FEDummy + FEParamGetPtosVenta) con SOAP manual.
`lib/afip/errors.ts` jerarquía tipada: `AfipError` base +
`Config|Input|Transport|SoapFault|Service`. Solo TRANSPORT retryable.
`lib/afip/diagnostics.ts` corre en paralelo.

Migración `puntos_de_venta` con `numero PK + channel_id FK + nickname +
is_enabled + last_known_emission_type + last_known_blocked + last_synced_at`.
Página `/admin/afip/puntos-de-venta`. Permiso `afip:admin`.

### E.2 — `feat: comprobantes + comprobante_items`

`comprobantes(id, channel_id, client_id, kind factura|nc|nd, letter A|B|C
nullable, punto_venta, numero, fecha, imp_neto, imp_iva, imp_trib, imp_total,
imp_tot_conc, imp_op_ex, cbte_tipo_afip nullable, cae nullable,
cae_vencimiento nullable, afip_observaciones jsonb, status
draft|emitted|failed|cancelled, idempotency_key UNIQUE,
comprobante_origen_id self-fk, motivo_nc_nd, pdf_url, emitted_at,
notified_at, timestamps)`.

Unique compuesto `(channel_id, punto_venta, kind, letter, numero)`.
Constraint NC/ND requiere origen. Constraint `letter` + `cbte_tipo_afip`
NOT NULL si `channel.is_fiscal`.

`comprobante_items` con cascade.

### E.3 — `feat: WSFEv1 emission methods`

`getLastAuthorizedNumber`, `requestCAE`, `getVoucherInfo`. Builder XML con
orden estricto AFIP. `requestCAE` lanza `AfipServiceError` con
observaciones si `Resultado != 'A'`. `getVoucherInfo` devuelve null en
602 → habilita recovery.

### E.4 — `feat: issueInvoice Inngest function`

Steps `load-draft → reserve-numero → persist-numero → request-cae (con
recovery vía FECompConsultar en transport-error) → persist-cae`.
`idempotency: "event.data.idempotency_key"`, `retries: 5`. `onFailure`
marca `failed`. Inngest v4 API: `triggers: [...]` plural, sin `EventSchemas`.

### E.5 — `feat: PDF + QR (@react-pdf/renderer + qrcode)`

`lib/pdf/invoice-template.tsx` JSX con `<Document><Page>`. Para interno
flag `isFiscal=false` que oculta CAE/QR + agrega marca de agua. `lib/afip/qr.ts`
URL canónica AFIP + PNG inline. Step `generate-pdf` después de `persist-cae`.

### E.6 — `feat: invoice issuance UI + Playwright`

`/invoices` listado filtrado. `/invoices/nuevo` Dialog con selector canal +
form que se reconfigura según `is_fiscal`. Detalle con card "Datos AFIP"
solo fiscal. `InvoiceJobStatus` polea cada 1.5s. Sentry instalado.

### E.6.5 — `feat: AFIP-emit smoke test`

`tests/e2e/invoices-emit.spec.ts` gateado por `RUN_AFIP_E2E=1`. Login →
abre dialog → completa → "Emitir y solicitar CAE" → polling hasta CAE.

### E.7 — `feat: comprobante interno branch`

Workflow Inngest bifurca al cargar draft: si `!is_fiscal` salta WSAA/CAE
y va directo a numerar localmente (`max(numero) + 1` filtrado por channel +
POS + kind), marcar emitted y generar PDF "no fiscal".

### E.8 — `feat: realtime cross-feature`

`alter publication supabase_realtime add table` para `comprobantes`,
`receipts`, `cheques`, `transactions`. Hook genérico
`hooks/use-realtime-invalidate.ts`. Tablas hijas (payment_lines,
allocations, retentions, cheque_movements) NO van a la publication —
piggyback sobre `updated_at` del padre.

### E.9 — `feat: emitir y continuar (rapid invoicing)`

Botón secundario "Emitir y continuar (⌘Enter)". Mantiene canal y fecha,
limpia cliente/items/notas, focus en ClientPicker, no cierra dialog.

---

## §F — Cobranzas, recibos, cheques

### F.1 — `feat: receipt → transactions auto-link`

`transactions.receipt_id` FK opcional. RPCs `create_receipt` y
`update_receipt` insertan una transaction `kind=income` por cada
`payment_line` (mismo channel, currency, fecha, accrual=mes de la fecha,
counterparty=cliente). Retenciones NO generan transactions. Trigger
`receipts_on_cancel_clean_transactions`.

### F.2 — `feat: cheques + endosos`

`cheques` (header con kind=fisico|echeq) + `cheque_movements` (historial
inmutable). Lifecycle: `en_cartera → depositado → acreditado` o
`en_cartera → endosado` o `cualquiera → rechazado`. 4 RPCs:
`deposit_cheque`, `credit_cheque`, `endorse_cheque`, `reject_cheque`.

### F.2.b — `feat: cheques ↔ recibos integration`

RPCs aceptan `cheque` opcional en cada payment_line. Sub-form en
`PaymentLinesEditor` cuando la cuenta es cartera. `getReceiptByIdAction`
devuelve `cheques_by_line`. Trigger `guard_cheque_delete_in_lifecycle`.

### F.3 — `feat: recibos editables (numerador R{POS}-{numero})`

`receipts` con UNIQUE `(channel_id, punto_venta, numero)`. Format
`R0003-12345678`. `receipt_payment_lines` (método derivado de
`account.type`). `receipt_allocations` con UNIQUE `(receipt_id,
comprobante_id)`. RPCs `create_receipt` + `update_receipt` con
sum-validation. Soft-cancel.

Hook nuevo `hooks/use-action-query.ts` (wrapper TanStack Query sobre
`ActionResult<T>`).

### F.4 — ~~descartado (2026-05-10)~~

Modelaba "Jouve consume servicios de DZ y se factura junto al cliente
final". No aplica: los canales fiscales e internos son paralelos por
diseño — los internos son operaciones que NO se declaran. Consolidar
internos en fiscales sería justamente lo opuesto de lo deseado.

### F.5 — `feat: retenciones y percepciones en recibos`

`receipt_retentions(id, receipt_id, kind retencion|percepcion, tax_type
ganancias|iva|iibb|suss|otros, jurisdiction, certificate_number,
certificate_date, amount, notes, timestamps)`. RPCs extendidos con
`p_retentions jsonb`. Validación
`Σ payment_lines + Σ retentions = total_amount`. UI `RetentionsEditor`
con `jurisdiction` solo para IIBB. 5 cards de totales.

### F.6 — `feat: NC/ND emisión vía AFIP`

Botones "Emitir NC" / "Emitir ND" en `/invoices/[id]`. `IssueNcNdDialog`
reusa `issueFiscalInvoiceAction` con `kind = nc | nd` y
`comprobante_origen_id`. Items prellenados desde origen. Letter y POS
heredan (RG 1415). `cbteTipoFor` resuelve NC_A/NC_B/NC_C o ND_A/ND_B/ND_C.

### F.7.a — `feat: cuenta corriente per cliente`

Vista `v_client_account_movements`: UNION ALL de comprobantes (emitted) y
receipts (issued). Signo: `signed_amount > 0` ⇒ debe; `< 0` ⇒ pago/NC.
Tabs nuevos en `/clients/[id]`: "Cuenta corriente" + "Datos". Header con
saldo total.

### F.7.b — `feat: aging buckets + cron Inngest`

Vistas `v_aging_documents` + `v_client_aging` con buckets 0-30 / 30-60 /
60-90 / 90+. Allocations de recibos canceled no descuentan. Página
`/aging`. Cron `aging-weekly-summary` lunes 09:00 ART.

---

## §K — Compras, Proveedores, Pagos

### K.1 — `feat: suppliers CRUD` (PR #45)

Migración `20260514185709_suppliers.sql`. Tabla `suppliers` paralela a
`clients` (CUIT único, razón social, condición IVA, dirección, email,
teléfono, notas, is_active). RLS mismo patrón que clients. CRUD con
verify-CUIT reusado de AFIP plumbing. Soft-delete via `is_active`.

### K.2 — `feat: purchase invoices CRUD + import AFIP` (PR #46)

Migración `20260514191144_purchase_invoices.sql`. `purchase_invoices(id,
supplier_id, channel_id, tipo, letter, pos, numero, fecha, fecha_devengado,
neto, iva, percepciones, total, currency, notes, status, timestamps)`.
Script `scripts/import-afip-purchases.ts` que pulla las facturas
recibidas vía AFIP "Mis Comprobantes" y las carga en bulk. 1313 facturas
reales cargadas / 256 proveedores.

### K.3 — `feat: payment orders` (PR #47)

Migración `20260514192231_payment_orders.sql`. `payment_orders(id,
supplier_id, channel_id, op_date, total_amount, currency, notes, status,
canceled_at, canceled_by, created_by, timestamps)`. `payment_order_lines`
con `(account_id, amount, method bank|cash|cheques|echeq|wallet)`.
`payment_order_allocations` con `(purchase_invoice_id, amount_applied)`.

Endoso de cheques: RPC `endorse_cheque_for_payment` que descuenta el
cheque de cartera y lo asocia a una payment_line. Emisión de cheque
propio: tabla `issued_checks` (PR K.6) con relación a `payment_order_lines`.

Migración subsecuente `20260514215801_payment_orders_with_checks.sql` que
expandió el modelo para registrar cheques propios físicos / ECHEQ.

### K.5 — `feat: vistas aging proveedor`

Migración `20260514193318_supplier_account_and_aging.sql`. Vistas
`v_supplier_account_movements` (cuenta corriente per supplier) +
`v_supplier_aging` con buckets. Tabs en `/suppliers/[id]`. Página
`/suppliers/aging` o sección dentro de `/aging`.

### K.6 — `feat: issued checks` (PR #47)

Migración `20260514194207_issued_checks.sql`. `issued_checks(id, kind
fisico|echeq, account_id, numero, banco, monto, fecha_emision,
fecha_vencimiento, beneficiario_supplier_id, status emitido|cobrado|anulado,
payment_order_line_id FK opcional, notes, timestamps)`. Página `/checks`
(reusa la existente de F.2) con tab adicional "Emitidos".

### K.7 — `feat: editable OPs with cheques` (PR #48 — draft)

Migración `20260514215801_payment_orders_with_checks.sql` +
`20260514221121_drop_endorse_check_rpc.sql` +
`20260516102448_payment_orders_edit_with_checks.sql`.

Las OPs con cheques ahora son editables. La RPC `update_payment_order`
revierte endosos (`cheques.status = en_cartera`) y borra los
`issued_checks` emitidos antes de reaplicar las líneas. Form reconstruye
las líneas de cheque al editar. Collapse en `allocations-picker` de OPs y
recibos.

Bugfix incluido (`5eb9d86`): el endoso al editar pierde el nombre de la
cartera; se rellena desde el cheque original.

### Apertura FIFO de proveedor

Migración `20260514221909_supplier_opening_balances.sql`. Permite cargar
saldo inicial al supplier que se imputa contra las facturas más viejas
por FIFO cuando entran recibos / OPs.

---

## §Subsistema social (PR #44)

11 migraciones (`20260514150000` → `20260514151100`). `user_profiles` +
`avatars` bucket + chat schema + RPCs + realtime + notifications + admin
RPCs + mentions/search + bugfixes + notification_settings + push_subscriptions.

`/profile` con upload foto + nombre/apellido + color avatar monocromo.

Chat self / DMs / grupos: send, reply inline, edit, soft-delete, reactions,
typing indicators, @-mentions con dedupe de notif, FTS con ⌘K, channel
admin (rename/add/remove/leave/mute), markdown, virtualización con
`@tanstack/react-virtual`.

Notifications: bell + popover + realtime, browser notifications nativas
in-page, push real con service worker + Inngest dispatch, preferences
per-type en `/profile`.

Tests: 221 unit + 9 integration gated por `RUN_INTEGRATION=1` + 4 E2E
Playwright.

Specs detalladas: `docs/chat-patterns.md`, `docs/notifications-patterns.md`,
`docs/user-avatars.md`.

---

## §Operativo pendiente (no es feature)

1. **Regenerar tipos.** Hay archivos puente
   (`lib/db/database.ts` + `lib/db/database.types.extensions.ts`) porque
   no se levantó Supabase local durante el dev del PR #44. Después de:
   ```bash
   pnpm dlx supabase stop --project-id sumary-dev
   pnpm dlx supabase start
   pnpm db:types:generate
   ```
   borrar los puente y revertir los 4 imports en
   `lib/supabase/{server,client,service,proxy}.ts` de `@/lib/db` a
   `@/lib/db/database.types`.

2. **VAPID keys** (opcional, solo si querés push real con app cerrada):
   ```bash
   pnpm dlx web-push generate-vapid-keys
   ```
   Pegar en `.env.local` y en Vercel:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY=BL...`
   - `VAPID_PRIVATE_KEY=...`
   - `VAPID_SUBJECT=mailto:soporte@logisticajouve.com.ar`
   - `NEXT_PUBLIC_APP_URL=https://tu-dominio.com`

3. **WIP fuera del repo:** carpeta untracked `claude-proxy/` con un Express
   standalone + componente `ExtractorFactura.jsx` para OCR de facturas
   vía Claude API. Es un POC. Debe integrarse a **Fase I.2 (OCR remitos)**
   o moverse fuera del repo — viola la decisión #8 (todo en Next.js +
   Inngest).
