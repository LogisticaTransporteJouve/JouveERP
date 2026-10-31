# Mobile Patterns — Diseño responsive de JouveERP

> Estado: **M1–M4 IMPLEMENTADAS** (2026-07-03, rama `feat/dashboard-widgets`,
> pendiente de revisión visual). M5 sigue siendo futura. Auditoría hecha el
> 2026-07-03 (66 páginas, 47 feature slices).
> No es una app nueva: es la misma app, responsive. Desktop queda intacto.
>
> Desvíos respecto del diseño original, decididos durante la implementación:
> - §3.3: los dialogs NO pasan a fullscreen < md; quedan centrados con
>   `max-h-[calc(100dvh-2rem)]` + scroll interno (un dialog chico fullscreen
>   queda peor, y el cap + scroll arregla igual los 55 dialogs altos).
> - §1.4: el `grid-cols-3` de `transaction-form` no se tocó — es un segmented
>   control de 3 botones cortos que entra bien a 375px; apilarlo era peor.
> - §3.7: el composer del chat no necesitó safe-area propia — el padding
>   inferior global del main (`max-md:pb-24`) + la tab bar la cubren.

---

## 1. Diagnóstico (auditoría)

### Lo que ya funciona en mobile (no tocar)

| Pieza | Por qué funciona |
|---|---|
| Sidebar | shadcn `Sidebar` ya se vuelve `Sheet` offcanvas < 768px (`components/ui/sidebar.tsx`, `useIsMobile`). |
| Dashboard canvas (vista) | `grid gap-4 lg:grid-cols-2` colapsa a 1 columna < 1024px; widgets con `min-w-0`. |
| Dialogs (ancho) | Base `max-w-[calc(100%-2rem)]`; overrides todos `sm:max-w-*` → full-width seguro < 640px. |
| Forms grandes | Mayoría usa `sm:grid-cols-2` → 1 columna en mobile. |
| AI workspace | Ya mobile-aware: historial `hidden md:block` + toggle `md:hidden` + overlay. |
| Document Intelligence review | `Sheet` lateral `sm:max-w-[600px]`; sidecar de documento fuente es `lg:` only (mobile ve solo los datos — correcto). |
| Tablas (mínimo viable) | `components/ui/table.tsx` envuelve todo en `overflow-x-auto` → nada rompe el layout, solo scrollea. |

### Lo que está roto / degradado a 375px

Veredicto por severidad (detalle pantalla por pantalla en §4):

1. **ROTO — Header global** (`app/(dashboard)/layout.tsx` + `components/scope-selector.tsx`).
   `ScopeSelector` = dos selects fijos `w-[180px]` + `w-[160px]` (~340px) en un flex
   `ml-auto` sin wrap, junto a búsqueda y campana. Desborda en TODAS las páginas.
   Es el blocker #1 de la app.
2. **ROTO — Chat** (`features/chat/components/chat-shell.tsx:23`).
   `grid-cols-[260px_1fr]` sin breakpoint → el hilo de mensajes queda en ~115px.
   Única rotura real de layout de toda la app.
3. **ROTO — Dialogs altos**. La base de `dialog.tsx` no tiene `max-h` ni scroll
   interno; solo 24 de 79 dialogs lo agregan. Forms largos (factura de compra
   ~42 campos, factura de venta, cheques ~22 campos) desbordan el viewport sin
   forma de scrollear.
4. **ROTO — Grids sin colapsar**. `trips/components/trip-dialog.tsx` (4×
   `grid-cols-*` sin prefijo `sm:`) y `transactions/components/transaction-form.tsx`
   (1×) quedan multi-columna apretada a 375px.
5. **DEGRADADO — Todas las tablas** (~30, 28 sobre el `DataTable` compartido).
   Solo scroll horizontal; sin prioridad de columnas ni vista alternativa.
   Peores: cheques recibidos (15 col), aging clientes/proveedores (14), préstamos
   (14), compras/proveedores/pallets/recurrentes (13), y los libros IVA
   (20–22 col, raw table).
6. **DEGRADADO — Grillas editables RRHH**. `payroll-period-grid` (~1400px, edición
   inline) y `attendance-grid` (matriz mes × empleado). Tienen overflow + sticky,
   pero editar desde el teléfono es penoso.
7. **DEGRADADO — Cash-flow chart**. El SVG escala por `viewBox` (720×230), a 375px
   el texto queda ~7px.
8. **DEGRADADO — PDF viewer** (`invoices/components/pdf-viewer-inner.tsx`): escala
   de página fija, riesgo de desborde.
9. **Sin export `viewport`** en `app/layout.tsx` (Next mete el default, pero falta
   `viewportFit`/`themeColor` para safe areas).

### Hallazgo colateral (no mobile, reportar aparte)

- `/fleet-reports` (rentabilidad de flota) está gateado por `trips:read` → un
  **driver** puede abrir el reporte de rentabilidad. Probable exposición no
  intencional. Fix trivial: permiso propio o `accounting:read`.

---

## 2. Principios

1. **Una sola app.** Responsive, no fork mobile. Desktop no cambia ni un pixel
   salvo que un fix lo mejore también.
2. **Breakpoint canónico: 768px** (`md:`), igual que el sidebar. `useIsMobile`
   (ya existe en `hooks/use-mobile.ts`) solo cuando CSS no alcanza (dnd, navegación
   de chat). CSS-first siempre que se pueda.
3. **Arreglar en la primitiva compartida, no por feature.** `dialog.tsx`,
   `data-table.tsx`, `scope-selector.tsx` arreglan 80% de la app en 3 archivos.
4. **Leer siempre; editar donde tenga sentido.** Toda pantalla debe ser *legible*
   en el teléfono. La edición compleja (libros contables, grilla de sueldos,
   factura de compra de 42 campos) puede quedar "usable con fricción" — sus
   usuarios (finance) trabajan en desktop.
5. **Usuarios phone-first mandan:** driver (4 links: Dashboard, Chat, Viajes,
   Rentabilidad), warehouse (6), operations. Sus flujos se pulen primero.
6. **Restricciones intactas:** shadcn/ui + Tailwind v4, 100% monocromo oklch,
   Dialog centrado para CRUD (adaptado, no reemplazado), lucide, Geist, slices
   autocontenidos, sin `as`, sin `any`.
7. **Touch targets ≥ 44px** en controles de acción mobile (botones de fila,
   toggles, tabs).

---

## 3. Decisiones de patrón

### 3.1 Navegación — Sheet existente ahora; bottom bar por rol después

**Decisión:** Fase 1 no toca la navegación: el Sheet del sidebar ya funciona.
Fase 4 agrega una **bottom tab bar mobile** (`md:hidden`) con los destinos de
primer nivel derivados del rol + botón "Más" que abre el Sheet completo:

- driver → Dashboard · Viajes · Chat
- warehouse → Dashboard · Pallets · Depósitos · Chat
- operations → Dashboard · Viajes · Cargas · Chat · Más
- finance/admin/owner → Dashboard · Caja · Cobranzas (receipts) · IA · Más

Se computa de la misma matriz `lib/auth/permissions.ts` (nada hardcodeado por
rol nuevo). Componente compartido en `components/mobile-tab-bar.tsx` (app layer,
como `app-sidebar.tsx`).

**Descartado:** drawer custom (duplica el Sheet que ya existe); bottom bar como
única navegación (rompe acceso a 66 rutas para finance); hamburger-only
(driver/warehouse merecen 1-tap a su pantalla principal).

### 3.2 Tablas — prioridad de columnas + fila expandible, en el DataTable compartido

**Decisión:** extender `components/ui/data-table.tsx` (una sola vez) con soporte
opt-in por columna vía `meta`:

```ts
// ColumnDef meta
meta: { mobile?: "primary" | "secondary" | "hidden" }
```

- `< md`: se renderizan solo las columnas `primary` (2–3: identidad + monto +
  estado). Las `secondary` van a un **panel expandible por fila** (chevron,
  reusa el tree/expand que el DataTable ya tiene). `hidden` no aparece.
- Sin `meta.mobile` en ninguna columna → comportamiento actual (overflow-x).
  Migración incremental, cero riesgo para las 30 tablas.
- `>= md`: sin cambios.

**Excepción explícita:** libros IVA (20–22 col), libro mayor, balance, grillas
RRHH → quedan en **scroll horizontal + primera columna sticky** (patrón ya
presente en attendance-grid; se replica). Son reportes fiscales de forma fija;
partirlos en cards destruye su semántica de libro.

**Descartado:** cards apiladas por tabla (30 rewrites, inconsistente); scroll
horizontal como patrón único (ilegible para operar: cobrar, pagar, depositar
cheques exige ver monto+estado sin scrollear); column-visibility manual de
TanStack (el usuario no debe configurar 30 tablas).

### 3.3 Dialogs CRUD — misma convención, base con scroll + full-screen < md

**Decisión:** dos cambios en `components/ui/dialog.tsx` (base, arregla ~55
dialogs de una):

1. `DialogContent` gana `max-h-[calc(100dvh-2rem)]` + el body del dialog
   scrollea (`overflow-y-auto`), header/footer sticky.
2. `< md`: el dialog se estira a casi-fullscreen (`h-dvh w-dvw max-w-none
   rounded-none` o inset mínimo) — patrón "full-screen dialog" estándar mobile.
   `>= md`: centrado idéntico a hoy. La convención "CRUD en Dialog centrado"
   se mantiene: mismo componente, misma API, presentación adaptada.

Forms multi-paso largos (purchase-invoice 5 tabs, trip 3 pasos, invoice) ya
tienen estructura de pasos → con scroll + fullscreen quedan usables sin rewrite.

**Descartado:** migrar a `Sheet`/`Drawer` bottom-sheet (viola convención del
proyecto, agregaría vaul como dependencia, y 79 call-sites); arreglar dialog
por dialog (55 pendientes hoy, deuda infinita).

### 3.4 Header global — scope compacto

**Decisión:** `components/scope-selector.tsx` responsive:

- `>= md`: los dos selects actuales, sin cambio.
- `< md`: un solo botón compacto (icono filtro + abreviatura del scope activo,
  p. ej. "DZ · Fiscal") que abre un `Popover` con los dos selects apilados.

Header (`layout.tsx`): `gap-2` → `gap-1.5` en mobile y `min-w-0` en el grupo
derecho. Búsqueda ya degrada a icono (`hidden sm:inline`).

**Descartado:** esconder el scope en mobile (el scope cambia qué datos ves —
ocultarlo genera errores de operación); meter el scope dentro del Sheet del
sidebar (queda a 2 taps y desincronizado del contexto de página).

### 3.5 Dashboard canvas — 1 columna; edición sin drag en touch

**Decisión:** vista mobile ya colapsa a 1 columna (nada que hacer). En modo
edición `< md` (o puntero coarse): **se deshabilita dnd-kit** y cada widget
muestra flechas ↑/↓ (reordenan el array) + los controles existentes de
tamaño/quitar. El toggle half/full no aplica visualmente en 1 columna →
se oculta el control de tamaño en mobile.

**Descartado:** TouchSensor de dnd-kit con delay (pelea con el scroll vertical
de la página, UX frustrante); bloquear la edición en mobile (innecesario:
reordenar con flechas es trivial).

### 3.6 Cash-flow chart — modo compacto

**Decisión:** `< md` el chart renderiza **ventana de 6 meses** (últimos 2
realizados + 4 proyectados) en un `viewBox` más cuadrado (ej. 360×220), tipografía
del SVG escalada, y el tooltip pasa a **panel fijo bajo el chart** (tap en un
mes lo puebla) en vez de flotante — el dedo tapa el tooltip flotante. Los hit
rects por columna ya existen (focus/aria), se reusan tal cual. Link "Ver
detalle" → `/treasury/cash-flow` sigue siendo la vía a la vista completa.

**Descartado:** scroll horizontal del SVG (esconde el mes en déficit, que es
el punto del widget); librería de charts (dependencia nueva prohibida por
objetivo).

### 3.7 Chat — navegación lista ↔ hilo

**Decisión:** `chat-shell.tsx` pasa de `grid-cols-[260px_1fr]` a:

- `>= md`: split actual.
- `< md`: **una vista por vez** — lista de canales full-width; tap en canal →
  hilo full-width con botón back (‹) en `channel-header`. La ruta ya es
  `/chat/[channelId]`, así que back = `router.push("/chat")` con la lista como
  estado vacío… la lista y el hilo ya son componentes separados, solo cambia
  qué se monta.
- `message-composer`: `pb-[env(safe-area-inset-bottom)]`.

**Descartado:** drawer para la lista de canales (el patrón universal de
mensajería es lista→hilo; drawer esconde canales no leídos).

### 3.8 Detalle y PDF

- Páginas de detalle (`grid lg:grid-cols-3`): ya colapsan. Solo asegurar orden
  de lectura (columna principal antes que la lateral en DOM — ya es así).
- `pdf-viewer-inner.tsx`: escala = `min(scaleActual, anchoContenedor/anchoPágina)`
  (fit-width en mobile), controles de zoom con touch targets 44px.

### 3.9 Viewport y safe areas

`app/layout.tsx` gana:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

Bottom bar y composer de chat usan `env(safe-area-inset-bottom)`.

---

## 4. Especificación pantalla por pantalla

Veredicto actual → qué cambia. Las 66 páginas, agrupadas. Todo hereda los fixes
de primitivas (§3.2–3.4) — solo se listan cambios *adicionales*.

| Pantalla(s) | Hoy @375px | Cambio |
|---|---|---|
| Header global (todas) | **Roto** | §3.4 scope compacto |
| `/dashboard` | Funciona (vista) / drag roto (edición) | §3.5 flechas de reorden; §3.6 chart compacto |
| `/chat/[id]` | **Inusable** (~115px de hilo) | §3.7 lista↔hilo |
| `/ai`, `/documentos` | Funciona | Nada (ya mobile-aware) |
| Listas: clients, invoices, receipts, aging, suppliers, categories, purchases, payment-orders, aging-suppliers, accounts, transactions, checks, issued-checks, recurring-payments, loans, drivers, vehicles, trips, cargas, fuel, maintenance, fleet-documents, warehouses, products, pallets, storage-tariffs, employees, admin/users, backups | Degradado (h-scroll) | §3.2 columnas primary/secondary por tabla; filtros de toolbar pasan a `flex-wrap` |
| Detalles `[id]`: clients, suppliers, invoices, receipts, purchases, payment-orders, trips, loans, employees | Funciona (grid colapsa) | Touch targets en botones de acción |
| Dialogs CRUD (79) | ~55 **rotos** en altura | §3.3 base fullscreen+scroll; `trip-dialog` y `transaction-form`: prefijar `sm:` a los grids pelados |
| `/treasury`, `/treasury/cash-flow` | Degradado | Chart compacto (§3.6); KPI tiles a `grid-cols-2` |
| Libros: libro-iva ×2, libro-mayor, journal, balance, inflation, exchange-rates, chart (árbol) | Degradado (scroll extremo) | **Se acepta scroll** + primera columna sticky + hint visual de scroll; sin rediseño |
| RRHH grillas: payroll `[y]/[m]`, attendance `[y]/[m]` | Degradado | Sticky ya existe; solo touch targets en celdas. Rediseño card-por-empleado = fuera de alcance (fase futura) |
| `/hr/document-expirations`, `/fleet-reports`, `/storage-billing`, `/pallets/trazabilidad` | Degradado leve | Heredan §3.2 / ya son listas simples |
| `/admin/padron`, `/admin/afip/*`, `/profile`, `/auth/login` | Funciona (max-w chicos) | Nada |
| PDF (invoices, preview-pdf) | Degradado | §3.8 fit-width |

---

## 5. Plan de implementación

Cada fase compila, pasa lint/tests y es mergeable por separado. Desktop sin
cambios visuales en todas.

### Fase M1 — Fundaciones del shell (impacto: toda la app)
- `components/scope-selector.tsx` — variante compacta `< md` (Popover).
- `app/(dashboard)/layout.tsx` — `min-w-0`/gaps del header.
- `components/ui/dialog.tsx` — `max-h` + scroll interno + fullscreen `< md`.
- `app/layout.tsx` — export `viewport`.
- `features/trips/components/trip-dialog.tsx`, `features/transactions/components/transaction-form.tsx` — prefijos `sm:` en grids pelados.
- **~6 archivos. Sin migraciones, sin deps.**

### Fase M2 — Tablas
- `components/ui/data-table.tsx` — soporte `meta.mobile` (primary/secondary/hidden) + fila expandible `< md`.
- Anotar columnas en las ~12 tablas más operativas: checks (15), aging (14), supplier-aging (14), loans (14), purchase-invoices (13), suppliers (13), pallets (13), recurring-payments (13), trips (12), shipments (12), issued-checks (12), transactions (6→primary directo).
- Toolbars de filtros de esas listas → `flex-wrap`.
- Sticky primera columna en libros IVA / libro mayor / balance (solo CSS).
- **~16 archivos.**

### Fase M3 — Vistas custom
- `features/chat/components/chat-shell.tsx` (+ `channel-header` back) — lista↔hilo.
- `features/dashboard/components/dashboard-canvas.tsx` — edición touch con flechas.
- `features/dashboard/components/cash-flow-chart.tsx` — modo compacto + tooltip fijo.
- `features/invoices/components/pdf-viewer-inner.tsx` — fit-width.
- **~5 archivos.**

### Fase M4 — Navegación por rol
- `components/mobile-tab-bar.tsx` (nuevo) + integración en `app/(dashboard)/layout.tsx`; ítems derivados de `lib/auth/permissions.ts`.
- Safe-area bottom en tab bar y composer de chat.
- **~3 archivos.**

### Fase M5 (futura, opcional) — Edición pesada
- Attendance/payroll: vista card-por-empleado para carga desde el teléfono.
- Purchase-invoice form: revisión de pasos para pulgar.
- PWA manifest si se quiere "instalar" en los teléfonos de los drivers.

### Fuera de alcance de este plan
- Fix del permiso de `/fleet-reports` (hallazgo de seguridad menor — hacer en
  PR aparte, 1 línea en `components/layout/nav-items.ts` + gate en la página).

---

## 6. Verificación por fase

- `pnpm test` + `pnpm lint` + `pnpm build` (como siempre).
- Revisión visual a 375×812 (iPhone SE/13 mini) y 768px con el dev server
  **levantado por el usuario** (regla: el agente no levanta stacks).
- Checklist por fase: sin scroll horizontal del body, dialogs scrollean, touch
  targets ≥ 44px, sidebar Sheet intacto, desktop sin diffs visuales.
