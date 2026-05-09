# JouveERP — Roadmap

> Plan ejecutable desde repo vacío. Cada PR es chico, autosuficiente y testeable.
> Las decisiones que ya tomamos van marcadas como **decididas**. Lo demás se
> resuelve en su fase correspondiente.

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
| Tests | Vitest (Playwright a partir de Fase E) |
| Logs | logger interno con redacción de secretos |
| AFIP | OpenSSL CMS para WSAA + soap para A4/WSFEv1 |
| Observability | PostHog vía reverse proxy (`/ingest/*` → PostHog Cloud) |
| Errores | Sentry (cuando llegue Fase E) |
| CI | GitHub Actions (lint + typecheck + test + build + types-drift check + migration-order check) |

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
  --foreground: oklch(0.141 0 0);          /* near-black, hue 0 */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.141 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.141 0 0);
  --primary: oklch(0.21 0 0);              /* black on white CTA */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.967 0 0);
  --secondary-foreground: oklch(0.21 0 0);
  --muted: oklch(0.967 0 0);
  --muted-foreground: oklch(0.552 0 0);
  --accent: oklch(0.967 0 0);
  --accent-foreground: oklch(0.21 0 0);
  --destructive: oklch(0.45 0 0);          /* monocromo: gris oscuro, NO rojo */
  --border: oklch(0.92 0 0);
  --input: oklch(0.92 0 0);
  --ring: oklch(0.705 0 0);
  --sidebar: oklch(1 0 0);
  --sidebar-foreground: oklch(0.141 0 0);
  --sidebar-primary: oklch(0.21 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.967 0 0);
  --sidebar-accent-foreground: oklch(0.21 0 0);
  --sidebar-border: oklch(0.92 0 0);
  --sidebar-ring: oklch(0.705 0 0);
}

.dark {
  --background: oklch(0.141 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.92 0 0);
  --primary-foreground: oklch(0.21 0 0);
  --secondary: oklch(0.274 0 0);
  --muted: oklch(0.274 0 0);
  --muted-foreground: oklch(0.705 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.439 0 0);
}
```

> **`destructive` también monocromo.** Por default `--destructive` es un gris
> oscuro. Comunicamos peligro con copy explícito + iconos (`Trash2`,
> `TriangleAlert`), no con color. Si el usuario reporta confusión real, se
> reintroduce un rojo discreto en una sola PR.

### 1.3 Tipografía

- **Geist Sans** (UI) + **Geist Mono** (números, CUITs, IDs) vía `next/font/google` con CSS vars (`--font-geist-sans`, `--font-geist-mono`).
- Aplicadas en `<body className="font-sans antialiased">` + `font-mono` donde corresponda.
- Tamaños: `text-sm` default; `text-xs` metadatos; `text-2xl font-semibold` H1; `text-lg font-medium` H2.
- Pesos: 400, 500, 600. **Nunca 700** — Geist 600 ya pega.

### 1.4 Espaciado y radius

- `--radius: 0.625rem` (10px). Tailwind expone `rounded-sm` (6px), `rounded-md` (8px), `rounded-lg` (10px), `rounded-xl` (14px).
- Botones: `h-9 px-4` (default), `h-8 px-3` (sm), `h-10 px-6` (lg), `size-9` (icon).
- Container app: `mx-auto px-4 sm:px-6 lg:px-8`. Contenido: `gap-4` o `gap-6`.

### 1.5 Componentes shadcn (variantes pegables)

**Button** (variante shadcn `new-york`, monocromo por las CSS vars):
```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
  },
);
```

**Sidebar** (primitivo shadcn extendido):
- Persistencia en cookie `sidebar_state` (max-age 7 días) — sobrevive a refresh y SSR.
- Ancho `16rem` expandido, `3rem` colapsado, `18rem` mobile.
- Atajo `Cmd+B` (`Ctrl+B` en Windows) para toggle.
- Mobile: drawer (`Sheet`) automático debajo de breakpoint 768px.

**Header sticky:** `sticky top-0 z-50 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80`.

**Tarjeta:** `rounded-lg border bg-card p-4`.

**Tabla:** `<Table>` shadcn (HTML wrapper). Si crecen filas, sumar **TanStack Table + TanStack Virtual** en la fase que lo requiera (probablemente Fase D para movements ≥500/mes).

**Input:** `h-9 rounded-md border bg-background px-3 text-sm`.

### 1.6 Iconos

- **lucide-react** exclusivamente. `size-4` (16px) por default, `stroke-width=2`.
- En `next.config.ts`: `experimental.optimizePackageImports: ["lucide-react"]`.

### 1.7 Animación

- `transition-all` para hover/focus en interactivos.
- `duration-100` micro-interacciones, `duration-300` popover/dialog.
- `active:translate-y-px` para feedback táctil en botones.
- `next-themes` con `disableTransitionOnChange` para evitar flash.

### 1.8 Patrones de UI observados en La Pyme (referencia)

> Catálogo de patrones extraídos del análisis de capturas de **La Pyme**
> (2026-05-08) para usar como guía cuando se implementen las fases B-F.
> No es prescriptivo — es la base de inspiración con detalles concretos.

**Layout y navegación**
- Sidebar fijo izquierdo (~200px) con grupos por sección. Configuración tiene
  subnav: Organización, Plan, Preferencias, Puntos de Venta, Ubicaciones,
  Bancos, Medios de Pago, Categorías, Contabilidad, Colaboradores, Campos
  personalizados, Integraciones.
- Topbar con: selector de empresa (`Jouve · Max`), búsqueda global con
  shortcut `⌘K`, badge del plan, link de Ayuda.
- Contenido centrado con `max-w` y cards `rounded-xl border`.

**Drawer derecho vs Dialog centrado**
- La Pyme usa `Sheet` deslizante a la derecha consistentemente para todo
  CRUD (ubicación, cuenta bancaria, medio de pago, categoría, cuenta
  contable, dimensión, colaborador, campo personalizado).
- Header: título + descripción corta + close (X). Footer fijo: primario
  pill + "Guardar y crear otra ⌘Enter" + Cancelar.
- **Decisión JouveERP (2026-05-08):** se descarta el drawer; usamos `Dialog`
  centrado de shadcn. Misma estructura header/footer y atajo "Guardar y
  crear otra ⌘Enter". Razón: preferencia personal del owner.

**Onboarding checklist**
- Dashboard inicial muestra dos secciones colapsables ("Configurá tu
  organización 0/5", "Empezá a usar La Pyme 0/3"). Cada item con check + link
  a la página. Útil para guiar el alta de Jouve.

**Datos fiscales con autofill por CUIT**
- Modal "Completá tus datos fiscales" → ingresás CUIT y llena Razón Social,
  Personería Jurídica, Condición IVA, Domicilio Fiscal.
- **Aplica a:** alta de la organización + C.1 (clientes fiscales).

**Plan de cuentas jerárquico**
- Árbol con nivel visual claro (1 → 1.1 → 1.1.1 → 1.1.1.1), filas con
  chevron expand, icono carpeta/documento, código + nombre, badge `Activa`,
  tag opcional con categoría EERR, menú `…`, footer "+ Agregar subcuenta".
- Form "Nueva cuenta": Cuenta padre (combo del árbol), Código, Nombre,
  Descripción, **Categoría del estado de resultados**, **Rol del sistema**
  (clave para autoasientos).

**Configuración contable avanzada**
- Tabs **Cuentas / Asientos Automáticos / Centros de Costo** con toggle
  "Habilitar Contabilidad" como kill-switch.
- Asientos Automáticos = mapping de cuentas para inflación/IVA/ventas
  (multi-select chips).
- Centros de costo como dimensiones configurables (Nombre, Requerido toggle,
  Mostrar en ventas toggle).
- Página dedicada **Ajuste por inflación**: fecha + coeficiente manual +
  leyenda → previsualizar asiento.

**Roles y permisos finos (alinear B.2/B.3)**
- Form "Invitar Colaborador": Email + Rol + Acceso a Cajas y Ubicaciones
  (checkboxes por sucursal/caja) + Cajas fuertes + Puntos de Venta +
  Visibilidad de datos (`Ubicaciones asignadas` / global) + Descuento Máximo
  + Comisión.
- **Aplica a:** modelo de permisos B (no solo roles globales — también scope
  por caja/ubicación/PdV).

**Medios de pago con planes de cuotas (Fase F)**
- Form: Nombre, Disponibilidad (online/presencial), Comisión %, Comisión
  Fija $, toggle "Requiere Referencia", lista de Planes de cuotas (3, 6, 12)
  con coeficiente.

**Campos personalizados genéricos**
- Sistema: Nombre, Descripción, Tipo (texto/número/select/etc.),
  Validaciones (Obligatorio toggle, Long mín/máx). Permite extender
  entidades sin migrar schema. Pensar para C (Clientes) y G (Flota) —
  postergado hasta tener al menos un caso real que lo justifique.

**Integraciones**
- Listado simple con ícono + nombre + chevron + sección "Próximamente".
  Plantilla útil para conectores AFIP/Inngest.

**Detalles de estilo**
- Botones primarios negro sólido pill (`rounded-full`), secundarios outline.
- Badges pill grises (`Activa`, `Por defecto`, `Beta`).
- Soporte light + dark mode (oklch ya cubre).
- Empty states con texto centrado gris ("No hay X configurados…").
- Paginación pie de tabla: "Página 1 de 1" + flechas + "0 de 1 fila
  seleccionadas".

---

## 2. Convenciones de trabajo

### 2.1 Branches

- `main` → siempre verde. Solo merges de PR.
- `feat/<scope>` → features.
- `fix/<scope>` → bugfixes.
- `chore/<scope>` → tooling, deps, docs.

Una rama = un PR = una unidad lógica. Cuando seamos > 1 dev, agregamos
`staging` como gate intermedio entre `feature` y `main`.

### 2.2 Commits

Conventional Commits, **en inglés**:

```
feat: add accounts module with channel-tagged transactions
fix: skip fuzzy match for fiscal clients
chore: bump zod to 4.2
docs: clarify multi-division decision in roadmap
```

Cuerpo en presente/imperativo, líneas ≤80 chars. Co-author de Claude cuando colabore.

### 2.3 PRs

- Título corto (≤70 chars).
- Body con: **Summary** (1-3 bullets), **Migrations** (si hay), **Test plan**.
- Verde en CI obligatorio.
- Squash merge — el cuerpo final se cura desde la descripción del PR.

### 2.4 Migraciones SQL

- Nombre: `YYYYMMDDHHMMSS_<scope>.sql` (alineado con timestamp Supabase CLI).
- Una migración = un cambio cohesivo.
- **Nunca** editar una migración mergeada. Si hay que ajustar, va una nueva.
- RLS habilitada en la **misma** migración que crea la tabla.
- `alter publication supabase_realtime add table public.<t>` solo si esa tabla necesita realtime UI.
- **CI workflow `migration-order-check.yml`** valida que el timestamp de cada nueva migración sea posterior al máximo en `main`. Esto previene el bug "dos PRs paralelos mergean migraciones con mismo timestamp y `supabase migration up` se rompe en prod".

### 2.5 Tipos generados

- `lib/db/database.types.ts` se genera con:
  ```bash
  pnpm dlx supabase gen types typescript --local --schema public > lib/db/database.types.ts
  ```
- **Se commitea al repo.**
- CI lo regenera y compara — si hay drift, falla el PR.
- Husky `pre-push` hace el mismo check local antes de pushear.
- En todo `createClient()` se tipa: `createBrowserClient<Database>(...)`.

### 2.6 Testing

- Vitest para Zod schemas, helpers puros, matriz de permisos. **100% cobertura** de la matriz.
- Tests de penetración por rol (Vitest hits server actions con mocks de roles) — desde Fase B.
- Playwright e2e desde Fase E (login, alta cliente, emisión comprobante).

### 2.7 Husky

- `pre-commit`: `lint-staged` corre prettier + eslint en archivos staged.
- `pre-push`: si hay nuevas migraciones desde `origin/main`, regenera `database.types.ts` y falla si hay drift. También corre tests.

### 2.8 Estructura de features

Cada feature se autocontiene:

```
features/<feature>/
  ├── actions/        # "use server" — server actions
  ├── components/     # UI específica del feature
  ├── hooks/          # hooks específicos
  ├── lib/            # utils sin React
  ├── schemas/        # Zod schemas (re-export de @/lib/contracts)
  ├── types/          # TS interfaces
  └── index.ts        # barrel
```

Solo importa de:
- `@/components/ui/*` (primitivos shadcn)
- `@/lib/supabase/*`
- `@/lib/auth/*`
- `@/hooks/*` (globales)
- otras features → **prohibido** (rompe el límite). Si hace falta, se sube a `@/lib/`.

### 2.9 Hooks primero, lógica inline después

Antes de inlinear state machines / effects / async flows en un componente, **evaluar si existe (o tiene que existir) un hook reutilizable**. Reglas:

- Patrones project-wide (paginación, intersection observer, debounce, URL ↔ state, formato de fechas) → `hooks/use-*.ts`.
- Patrones de un feature (verify-CUIT, alta de comprobante, etc.) → `features/<feature>/hooks/use-*.ts`.
- Inlinear sólo cuando la lógica es genuinamente one-off y no escala.

Esto previene reimplementar el mismo patrón en cada tabla/form/dialog cuando llegan transactions, comprobantes, cobranzas, viajes, pallets.

---

## 3. Roadmap por fases

> Cada fase se descompone en PRs ≤500 LOC. Si una migración + UI rompen la
> regla, se aceptan PRs hasta ~1000 LOC.

> **Orden de ejecución (decidido 2026-05-09).** Las letras de fase se
> mantienen para no romper referencias cruzadas, pero el orden real de
> implementación cambia: tras cerrar **C** (Clientes), arrancamos
> **E (Facturación)** para entregar el dolor más alto antes. Después
> **D.1** (sólo `accounts` — caja mínima necesaria para que los recibos
> tengan dónde aterrizar), después **F.3** (recibos vinculados a las
> facturas emitidas), y recién después **D.2/D.3** completos (transactions
> UI + transferencias) y el resto de **F** (cheques, retenciones, NC/ND,
> aging). Las fases G–J quedan en el orden original. Razón: facturación
> entrega valor desde el día 1; recibos cierran el ciclo AR; caja completa
> y reporting se construyen sobre una base ya productiva.

### Fase A — Bootstrap (1 semana)

**Objetivo:** repo de Next.js mínimo, deployable a Vercel, con login.

#### A.1 — `chore: init Next.js + pnpm + Tailwind v4 + shadcn` (1 PR)

```bash
pnpm create next-app@latest . --typescript --app --eslint --tailwind --src-dir=false --import-alias="@/*"
```

Engines + packageManager:
```json
{
  "engines": { "node": ">=20" },
  "packageManager": "pnpm@10.28.2"
}
```

Deps base:
```bash
pnpm add zod @tanstack/react-query @tanstack/react-table \
        @supabase/ssr @supabase/supabase-js \
        next-themes lucide-react clsx tailwind-merge class-variance-authority \
        radix-ui react-hook-form @hookform/resolvers \
        sonner cmdk
pnpm add -D vitest @vitejs/plugin-react jsdom \
           @testing-library/react @testing-library/dom \
           prettier eslint-config-next \
           tw-animate-css
```

shadcn init:
```bash
pnpm dlx shadcn@latest init --style new-york --base-color zinc
```

Después: editar `app/globals.css` con la paleta monocromática de §1.2 (override
sobre el default de zinc — mismas variables, hue forzado a 0).

Componentes shadcn iniciales:
```bash
pnpm dlx shadcn@latest add button input label select badge card table \
                          dialog dropdown-menu sheet sidebar skeleton \
                          separator scroll-area popover tooltip checkbox \
                          breadcrumb form alert sonner
```

Configurar:
- `next.config.ts`: `experimental.optimizePackageImports: ["lucide-react"]`, security headers (X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy).
- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, paths `@/*`.
- `.gitignore`: `.env*`, `node_modules`, `.next`, `supabase/.env`, `.DS_Store`, `lib/db/database.types.ts.bak`.

#### A.2 — `chore: tooling — vitest, eslint flat config, prettier, husky, ci` (split en 2 PRs)

**Estado actual (reconciliado 2026-05-08 con el repo real):**

✅ **Hecho** (parte mergeada en A.1, parte en PR #2 `9bc1d9c`, parte ya
instalado en `package.json` aunque no documentado):
- ESLint flat config (`eslint.config.mjs`) con `@typescript-eslint/no-explicit-any: error` y los desactivados de Next 16 / React 19 que pegan con shadcn.
- CI workflow (`.github/workflows/ci.yml`) — lint + typecheck + build sobre PRs y push a main.
- Claude PR review workflow (`.github/workflows/claude-review.yml`) — extra, fuera del plan original.
- Deps de tooling instaladas: `prettier`, `vitest`, `husky`, `lint-staged`, `@testing-library/{react,dom}`, `@vitejs/plugin-react`, `jsdom`.
- Scripts en `package.json`: `lint`, `format`, `format:check`, `typecheck`, `test`, `test:watch`, `db:types:generate`, `prepare` (husky).
- Husky inicializado (`.husky/_/` con stubs estándar).

⏳ **Instalado pero sin configurar** — falta el archivo de config y/o el hook concreto:
- **Prettier** — sin `.prettierrc` ni `.prettierignore`. `pnpm format:check` falla en 25 archivos shadcn (no usan punto y coma) — hay que decidir entre adaptar el config (`semi: false`) o correr `format --write` y dejar la base alineada al estilo Prettier por default. La opción "no config + write all" pierde el estilo shadcn; la opción "config sin semi" deja todo el código sin `;`. Pendiente decidir cuando moleste; mientras tanto el CI no ejecuta `format:check`.
- ✅ **Vitest** — `vitest.config.ts` agregado en A.4 (PR del logger). Alias `@/*`, env `node`. CI corre `pnpm test`.
- **Husky hooks** — el directorio existe pero `pre-commit` y `pre-push` no están escritos. Pendiente: `pre-commit: pnpm exec lint-staged`. `pre-push: regenera tipos si hay nuevas migrations + corre tests`.
- **lint-staged** — sin `lint-staged.config.mjs`.

❌ **No hecho** — entran cuando aparezca el caso de uso:
- ✅ `migration-order-check.yml` agregado en B.1 (primera migración real con `roles_and_audit`). Compara timestamps contra `main` y falla si dos PRs paralelos colisionan.
- ✅ Scripts `db:types:generate` + `db:types:check` agregados en A.7 (PR adelantado antes de A.5). `scripts/db-types.sh` y `scripts/db-types-check.sh` ya en el repo.

Refs originales del scope completo (para cuando se retomen):
- `lint-staged.config.mjs`:
  ```js
  export default {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"],
  };
  ```
- `.prettierrc`: `{ "singleQuote": false, "trailingComma": "all" }`.
- `.github/workflows/migration-order-check.yml`: ver yaml completo en `docs/sumary-frontend-patterns.md` §4.2.

#### A.3 — `feat: base layout — sticky topbar, sidebar with cookie, theme toggle` (1 PR)

- `app/layout.tsx` carga Geist Sans + Geist Mono via `next/font/google` con CSS vars.
- `app/(dashboard)/layout.tsx` con `SidebarProvider` (default colapsado), header sticky 56px, theme toggle.
- `components/app-sidebar.tsx` con header (logo "JouveERP"), grupo "Navegación" vacío.
- `components/theme-toggle.tsx` con `next-themes` (`disableTransitionOnChange`).
- `components/providers/query-provider.tsx`: `QueryClientProvider` con `staleTime: 30s`, `refetchOnWindowFocus: false`.
- `components/providers/scope-provider.tsx`: context para `division` + `fiscal_filter` con persistencia localStorage.
- Tipografía y paleta de §1.2 cargadas en `app/globals.css`.
- `Toaster` de sonner en root layout.
- **Convención global de CRUD:** `Dialog` centrado de shadcn (no `Sheet`
  derecho — preferencia confirmada 2026-05-08, en contra del patrón de La
  Pyme observado en §1.8). Header con título+descripción, footer con
  primario "Crear" + secundario "Guardar y crear otra ⌘Enter" + Cancelar.

#### A.4 — `feat: logger with secret redaction + observability stub` (1 PR)

- `lib/logger.ts` — JSON estructurado, redacta `token`, `sign`, `cert`, `key`, `password`, `authorization`. Niveles `debug|info|warn|error`. Debug suprimido en prod salvo `DEBUG=true`.
- `lib/observability.ts` — `captureException(err, context)` que hoy enruta al logger; cuando se sume Sentry/PostHog, se actualiza acá sin tocar callsites.
- Tests: redacta keys sensibles, respeta nivel.

#### A.5 — `feat: supabase clients (server, browser, service) + proxy.ts (CSP + session)` (1 PR) — **bundleado con A.7** en PR #5

- `lib/supabase/server.ts` — `createClient()` async, tipado con `Database` (generado en A.7).
- `lib/supabase/client.ts` — `createBrowserClient<Database>(...)`.
- `lib/supabase/service.ts` — `getServiceClient()` con `server-only`. Singleton, `persistSession: false`.
- `lib/supabase/proxy.ts` — `updateSession(request, headers)`. **Conserva el comentario "DO NOT REMOVE auth.getUser()"** (refresh side-effect).
- `proxy.ts` (root, Next 16 renombró `middleware.ts` → `proxy.ts`) — genera nonce per-request via `btoa(crypto.randomUUID())` (Edge-safe, sin Buffer), llama a `updateSession`, aplica CSP enforced.
- `lib/security/csp.ts` — builder con nonce + strict-dynamic en `script-src`. **Ajuste vs spec original**: `style-src` queda en `'self' 'unsafe-inline'` sin nonce (modern browsers invalidan `'unsafe-inline'` cuando hay nonce, y Tailwind v4 + `next/font` emiten `<style>` que Next no etiqueta — sin esto la UI pierde estilos). Scripts siguen estrictos, que es donde vive XSS. En dev se agrega `'unsafe-eval'` por HMR de Turbopack.
- `app/layout.tsx` lee `x-nonce` de `headers()` y lo pasa al `<ThemeProvider nonce={nonce}>` para que el inline script de hidratación de `next-themes` pase CSP.
- `.env.local.example` ya estaba en A.7.

#### A.6 — `feat: auth pages (login, logout) + protected dashboard` (1 PR) — ✅ shipped

- `lib/auth/public-pages.ts` — `DONT_AUTH_REDIRECT_PREFIXES = ["/auth", "/api/auth"]` + `shouldSkipAuthRedirect(pathname)`. Comentario inline aclara que esto es solo para la decisión de redirect, **no para data access** (RLS).
- `lib/supabase/proxy.ts` (extendido) — además de refrescar la sesión:
  - Si no hay user y la ruta no está en `DONT_AUTH_REDIRECT_PREFIXES` → redirect a `/auth/login` con `?redirectTo=...`.
  - Si hay user y la ruta empieza con `/auth/login` → redirect a `/dashboard`. Solo `/auth/login`, no `/auth/*` general — el logout debe llegar a su route handler.
- `app/auth/login/page.tsx` — Card con logo Jouve, lee `searchParams.redirectTo`.
- `app/auth/login/login-form.tsx` (`"use client"`) — form server-action con `useActionState`.
- `app/auth/login/actions.ts` — `signInWithEmail` server action: valida con Zod, llama a `signInWithPassword`, en error loguea `login.failure` con `logger.warn` y devuelve string genérico ("Credenciales inválidas") al cliente. Redirect post-login al `redirectTo` si empieza con `/`, sino a `/dashboard`.
- `app/auth/logout/route.ts` — POST handler que llama a `signOut` y redirect 303 a `/auth/login`.
- `app/(dashboard)/layout.tsx` — defense-in-depth: `getUser()` server-side y redirect a `/auth/login` si no hay sesión, además del proxy. Pasa `userEmail` al sidebar.
- `AppSidebar` — footer con email del user truncado + ThemeToggle + botón "Cerrar sesión" como `<form action="/auth/logout" method="post">` (no GET, evita prefetch accidental).
- Manual: alta del primer user vía la auth admin API local con `email_confirm: true` (Studio guardaba en otra instancia). Documentado en el PR.

#### A.7 — `chore: supabase types generation + ci drift check` (1 PR) — **adelantado antes de A.5** (decisión 2026-05-08: A.5 importa `Database`; mejor generarlo ya que tener `any` temporal)

- `supabase init` (config local).
- Una migración mínima `<ts>_init.sql` que crea extensión `pg_trgm` (que usaremos en C). Sirve de "primera migración" para probar el pipeline.
- `scripts/db-types.sh` y `scripts/db-types-check.sh` con `set -euo pipefail`. Ambos requieren `supabase start` corriendo.
- `package.json` scripts: `db:types:generate`, `db:types:check`.
- `.env.local.example` con los defaults del stack local (`http://127.0.0.1:54321`, anon/service_role keys conocidas).
- `.env.local` ya gitignored.
- CI dedicado `db-types-check.yml` que se dispara solo si cambian migraciones, types, o los scripts. Levanta Supabase via `supabase/setup-cli@v1`, regenera tipos, falla si hay drift.
- Husky `pre-push` hace lo mismo localmente — pendiente cuando se cablee el hook.

**PRs Fase A: 7.** Al cerrar: repo deployable, login funcional, types generation working, CI verde.

---

### Fase B — Foundation: RBAC + Multi-división (1-2 semanas)

#### B.1 — `feat: migration roles + user_roles + audit_events + helper user_has_role` (1 PR) — ✅ shipped

Migración `20260508201626_roles_and_audit.sql`:
- Catálogo `public.roles` con 6 filas seeded (owner=0, admin=1, finance=2, operations=3, warehouse=4, driver=5). Lectura abierta a `authenticated`.
- `public.user_roles(user_id, role_id, granted_by, granted_at)` con PK `(user_id, role_id)` e índice por `role_id`. RLS:
  - SELECT self o si tenés `owner|admin`.
  - INSERT/DELETE solo si tenés `owner|admin`.
- `public.audit_events(id, ts, actor_id, event_type, target_user_id, target_resource_id, payload, ip_address, user_agent)` con índices por `ts desc`, `actor_id`, `event_type`. RLS: SELECT solo `owner|admin`. **Sin INSERT policy** — los inserts vienen exclusivamente del service role.
- `public.user_has_role(text[])` `stable security definer`, `search_path` fijado, ejecuta `(select auth.uid())` cacheado. `revoke ... from public` + `grant execute to authenticated`.
- **Constraint trigger deferrable** `user_roles_owner_minimum_trigger`: dispara `after delete or update of role_id`, levanta excepción si `count(*) where role_id='owner' = 0`. Deferrable initially deferred → permite revoke + grant en la misma transacción sin trigger spurio.
- Migración usa `set row_security = off` durante el seed del catálogo y lo vuelve a prender al final.

Workflow nuevo `.github/workflows/migration-order-check.yml`: solo corre sobre PRs que tocan `supabase/migrations/**`, calcula el timestamp más alto en `main` y falla si la migración del PR no es estrictamente posterior. Bloquea el bug "dos PRs paralelos con timestamps overlapping".

Smoke local verificado:
- 6 roles seeded.
- `insert into user_roles ('owner') for tomas@jouve.test` → OK.
- `delete from user_roles where role_id='owner'` → bloqueado por el trigger con mensaje "At least one user must hold the owner role.".

#### B.2 — `feat: permissions matrix + withAuth wrapper + getCurrentUserContext` (1 PR) — ✅ shipped

- `lib/auth/permissions.ts`:
  - `ROLES` (6) y `PERMISSIONS` (~45 entradas que cubren Fases B-J upfront).
  - `ROLE_PERMISSIONS` mapping. **Owner y admin tienen el mismo set de permisos**; la separación vive en `canAssignRole`. `finance` cubre clients/AFIP/caja/comprobantes/cobranzas/retenciones/NC-ND. `operations` cubre flota+viajes+combustible+mantenimiento+docs+clients:read. `warehouse` cubre depósitos+pallets+stock+products:read. `driver` queda en `trips:read` solamente hasta G.3.
  - `userCan(roles, permission)`, `canAssignRole(actor, target)` (owner asigna todo, admin todo menos owner, otros nada), `highestRole(roles)`, `isRole(value)` type guard.
- `lib/auth/context.ts` — `getCurrentUserContext()` server-only envuelto en `cache()` de React (un solo round-trip a Supabase por request) + `requireUserContext()`.
- `lib/auth/users.ts` — `listUsersWithRoles()` y `ownerCount()` vía service client. Ambos requieren que el caller chequee `users:read` antes.
- `lib/auth/with-auth.ts` — wrapper genérico para server actions: `requireUserContext` → `userCan` → Zod `safeParse`. Lanza `AuthError` con códigos `UNAUTHENTICATED|FORBIDDEN|VALIDATION` para que el caller los mapee sin filtrar detalles.
- Tests: 17 tests Vitest cubriendo coherencia de la matriz, `userCan` con union de roles, casos edge de driver/warehouse, `canAssignRole` para todas las combinaciones actor→target, `highestRole`, `isRole`.

#### B.3 — `feat: admin/users page (list + invite + assign/revoke)` (1 PR) — ✅ shipped

- `app/(dashboard)/admin/users/page.tsx` server-rendered con `force-dynamic`. Llama a `bootstrapOwnerIfNeeded()` (one-shot: el primer user logueado se vuelve `owner` si no hay ninguno) y redirige a `/dashboard` si no tenés `users:read`.
- `features/admin-users/actions/users-actions.ts`:
  - `listUsersAction`, `inviteUserAction`, `assignRoleAction`, `revokeRoleAction`, `setUserRolesAction` (diff bulk add/remove), `bootstrapOwnerIfNeeded`.
  - Cada mutación filtra los roles vía `canAssignRole(actor, target)` antes de tocar la DB y emite `audit_events` con `actor_id`, `target_user_id`, `event_type`, `payload`.
  - Errores del trigger SQL "owner mínimo" se mapean a copy en español ("Tiene que quedar al menos un usuario con rol owner").
  - `revalidatePath("/admin/users")` después de cada mutación.
- `features/admin-users/components/users-table.tsx` (client) — tabla shadcn con búsqueda por email, chips por rol con `highestRole` resaltado, badge "Vos" en la fila propia, dropdown `…` con "Editar roles".
- `features/admin-users/components/invite-user-dialog.tsx` — Dialog (no Sheet) con email + RoleCheckboxGrid.
- `features/admin-users/components/assign-roles-dialog.tsx` — mismo grid pre-poblado, diff calculado en `setUserRolesAction`.
- `features/admin-users/components/role-checkbox-grid.tsx` — checkbox por rol con label + descripción + flag "Tu rol no puede asignarlo" via `canAssignRole`.
- `AppSidebar` recibe `userRoles` y filtra `navItems` por `permission?` — solo se muestra "Usuarios" si tenés `users:read`. El `(dashboard)/layout.tsx` pasa `ctx.email` y `ctx.roles` desde `getCurrentUserContext`.
- Tipo `JsonValue` local en el action file para insertar en `audit_events.payload` sin cast a `unknown` (la columna es `Json`, `Record<string, unknown>` no encaja).
- Smoke test verificado: ver propio usuario, editar roles (suma finance), invitar nuevo email, intentar revocar último owner → bloqueado por trigger con copy amigable.

#### B.4 + B.5 — bundleados ✅ shipped

> Bundleados en un solo PR (DB schema + UI que lo consume). Cierra Fase B.

**B.4 — business_units + invoicing_channels** (`20260508204342_business_units_channels.sql`):
- `business_units(id text pk, name, cuit, tax_condition, tax_address, is_active, timestamps)` con check `cuit ~ '^[0-9]{11}$'`. Seed: 1 fila `dz_sons` con CUIT `30714637432`.
- `invoicing_channels(id text pk, business_unit_id, name, division text check ('dz'|'jouve'), is_fiscal, display_color, is_active, timestamps)`. **Sin compound unique** sobre `(unit, division, is_fiscal)` — el negocio puede tener varios PdV por canal en el futuro. Seed: 4 filas (DZ Fiscal/Interno, Jouve Fiscal/Interno).
- Helper `public.set_updated_at` reusable + triggers en ambas tablas.
- RLS: SELECT `authenticated`; INSERT/UPDATE/DELETE `owner|admin` vía `user_has_role`.

**B.5 — ScopeProvider + ScopeSelector**:
- `lib/scope.ts` con `Division`, `FiscalFilter`, `Scope`, `InvoicingChannelSummary` (narrowing del `division: string` que devuelve la generación de tipos a `'dz'|'jouve'` del CHECK), `channelsForScope(scope, channels) → string[] | null` (null = "no filtrar"), guards `isDivision` / `isFiscalFilter`.
- `components/providers/scope-provider.tsx` extendido — recibe `channels` por prop, hidrata desde localStorage post-mount, **dropea cualquier `division` persistida que ya no exista entre los canales activos**.
- `components/scope-selector.tsx` — dos `Select` shadcn (`position="popper"`, `align="end"`) en el header. Etiquetas en español.
- `(dashboard)/layout.tsx` fetchea los canales en server, filtra por `isDivision`, los inyecta al `ScopeProvider`. **Movido del root layout** — el scope solo aplica al área autenticada.
- Smoke verificado: persistencia localStorage funciona, dropdown abre hacia abajo, divisions/fiscal filter persisten al refrescar.

**PRs Fase B: 4 (B.1, B.2, B.3, B.4+B.5).**


---

### Fase C — Clientes (1-2 semanas)

#### C.1 — `feat: clients table + RLS` ✅ shipped

> **Decisión 2026-05-08**: cliente **global** por CUIT — una sola fila por CUIT, compartida entre divisiones. Las facturas a Jouve y a DZ Instalaciones se vinculan al mismo `clients.id` (la división vive en `invoices.channel_id`). Se descarta el `fiscal_counterpart_id self-fk` del plan original; el caso "fiscal + interno por separado" quedaba mal resuelto y el usuario explicitó "cuit único con id único, porque puede pasar que un cliente tenga facturas en jouve y en instalaciones".

- `clients(id uuid pk, cuit unique [11 dígitos check], legal_name, display_name, iva_condition CHECK enum, email, phone, address, notes, is_active, created_by → auth.users, created_at, updated_at)`.
- `iva_condition` ∈ `responsable_inscripto | monotributo | exento | consumidor_final | no_categorizado`.
- Sin hard delete: `is_active = false` para retirar (las facturas históricas referencian `clients.id`).
- `set_updated_at` trigger reusado.
- RLS: SELECT `authenticated`; INSERT/UPDATE `owner|admin|finance` vía `user_has_role`. Sin DELETE.
- Permisos: `clients:read`, `clients:write` (ya en `lib/auth/permissions.ts`).
- Server actions en `features/clients/actions/clients-actions.ts`: `listClientsAction`, `createClientAction`, `updateClientAction`, `setClientActiveAction`. Auditoría en `audit_events.target_resource_id`. Mapeo de `23505` → "Ya existe un cliente con ese CUIT.".
- `features/clients/schema.ts`: Zod con preprocess que normaliza CUIT (acepta `30-71463743-2` y queda `30714637432`), guard `isIvaCondition`, type `Client` con narrowing de `iva_condition: string → IvaCondition`.
- `pg_trgm` + GIN + `find_similar_clients` se difieren a **C.3** (se agregan junto al UI que los usa, no antes).

#### C.2 — `feat: AFIP plumbing (env, wsaa, ta cache, padron, rate limit)` ✅ shipped

- Migración `20260508220000_afip_caches_and_rate_limit.sql`:
  - `afip_ta_cache(service text pk, token, sign, expiration_time, cached_at)` — RLS sin policies.
  - `padron_cache(cuit text pk, data jsonb, cached_at)` — RLS sin policies.
  - `rate_limit_buckets(user_id uuid, bucket_key text, window_start timestamptz, count int, pk compuesto)` — RLS sin policies.
  - **`bump_rate_limit_bucket(p_user_id, p_bucket_key, p_window_start) returns int`** — RPC `security definer` con `search_path = public`, hace `INSERT … ON CONFLICT DO UPDATE … RETURNING count` atómico. Resuelve el bug del repo viejo (`upsert` reset-to-1 + fallback manual no se ejecutaba en el path feliz, así que sólo se "salvaba" por el bug-de-no-camino).
- `lib/afip/{env,types,wsaa,padron}.ts` — port del repo viejo. Cambios:
  - `wsaa.ts` igual al original (firma CMS PKCS#7 vía `openssl cms -sign` subprocess; cache memoria + DB; coalescing in-flight).
  - `padron.ts` reemplaza el cliente `soap` por una llamada SOAP manual + `fast-xml-parser` (~80 KB, sin transitive `request`/`xml2js` enormes). Misma normalización: `tax_condition` → enum nuestro (con `no_categorizado` como bucket fallback en lugar del legacy `no_determinado`).
- `lib/rate-limit.ts` — single-path: una sola RPC, fail-closed si falla. Sin upsert no-op.
- `features/clients/actions/afip-actions.ts` → `verifyCuitAction(input)`:
  - Permiso `padron:lookup` + Zod `VerifyCuitSchema` (CUIT 11 dígitos arrancando 2/3, normaliza guiones).
  - Rate-limit 60/h por usuario.
  - Caché DB 24h. Fallback **stale** si AFIP responde error pero hay cached row vencido.
- `.env.local.example` documenta `AFIP_ENV`, `AFIP_CUIT`, `AFIP_CERT`, `AFIP_KEY` (base64-PEMs single-line).
- Tests: `lib/rate-limit.test.ts` (allow/deny, ventana alineada, fail-closed); `lib/afip/padron.test.ts` (mapper, prioridad VAT > Mono > Exempt > no_categorizado, asArray, fiscal-address preference).
- Stub `tests/stubs/server-only.ts` aliased en vitest: `import "server-only"` ya no rompe los tests.

#### C.3 — `feat: clients UI (list, form with verify-CUIT, edit, deactivate)` ✅ shipped

- Migración `20260509120000_clients_search.sql`:
  - `create extension pg_trgm`.
  - GIN trigram indexes sobre `lower(legal_name)` y `lower(coalesce(display_name, ''))`.
  - RPC `search_clients(p_query, p_only_active, p_limit) returns setof clients` — ranking por similitud trigram + LIKE prefix por CUIT, fallback a listado completo cuando `query=''`. `security invoker` para que respete RLS.
- `features/clients/actions/clients-actions.ts` extendido: `searchClientsAction({ query, onlyActive, limit })`, `getClientByIdAction(id)`, `findClientByCuitAction(cuit)` (devuelve null cuando no existe — usado por la alta para detectar duplicados antes de pegarle a AFIP).
- Páginas:
  - `/clientes` (server) — lee `?q=` y `?inactive=1` de la URL, renderiza `ClientsTable`.
  - `/clientes/nuevo` (server, gate `clients:write`) — `ClientForm mode="create"`.
  - `/clientes/[id]` (server, gate `clients:read`) — `ClientForm mode="edit"` para escritores; vista read-only para `operations`.
- Componentes:
  - `clients-table.tsx`: TanStack Table feel (search debounced 250 ms que pushea URL via `router.replace`, toggle "Solo activos", badges por condición IVA con paleta neutra, dropdown de acciones con desactivar/reactivar via `setClientActiveAction`).
  - `client-form.tsx`: RHF, botón "Verificar AFIP" que (1) checkea duplicados con `findClientByCuitAction` y muestra link a la ficha existente, (2) si no existe llama `verifyCuitAction` y autocompleta razón social, condición IVA, dirección. Toast de sonner en éxito/error. CUIT bloqueado en modo edit.
  - Nuevo `Textarea` primitive en `components/ui/textarea.tsx`.
- Sidebar: entry "Clientes" con icono Users, gate `clients:read`.
- Decisión: la validación inline con `zodResolver` queda diferida — el `ClientCreateSchema` tiene `transform`/`nullable`/`optional` que rompen la inferencia de tipos contra `useForm<FormValues>`. La validación server-side via `createClientAction.safeParse` cubre el caso y los errores se muestran por toast. Si más adelante queremos validación inline, hay que separar un `ClientFormSchema` plano (todos `z.string()`).
- `find_similar_clients` que estaba en el plan original queda fuera porque el modelo actual exige CUIT obligatorio único — ya no hay caso "alta sin CUIT" que necesite fuzzy match para deduplicar. La búsqueda fuzzy se usa en la lista vía `search_clients`, que ya cubre tipeos.

#### C.4 — _diferido_: columnas parseadas de domicilio + filtro por ciudad

- Agregar `fiscal_city`, `fiscal_province`, `fiscal_postal_code` (parseados desde `fiscal_address` de AFIP) al `clients`. Decisión pendiente: ¿filtramos por **ciudad fiscal** (AFIP) o por **ciudad real** (la que carga el usuario)? Si es la real, hay que pensar cómo parsear o cómo pedir city/province/cp como campos separados en el form de "Domicilio real".
- Columna nueva "Ciudad" en la tabla, con su `Combobox` filtro alimentado por `list_client_cities()` RPC.
- Backfill: cuando un cliente seedeado se "Verifica AFIP" se autocompletan las columnas. Migración + endpoint para refrescar bulk si llega a hacer falta.

**PRs Fase C: 3 (+ C.4 diferido).**

---

### Fase D — Caja única (Accounts + Transactions) (1-2 semanas)

> **Orden de ejecución:** D.1 (sólo `accounts`) se adelanta y va **inmediatamente
> después de Fase E** — los recibos (F.3) necesitan una cuenta destino para
> registrar el ingreso. D.2 + D.3 (transactions + UI) van después de F.3.

#### D.1 — `feat: accounts (caja única, sin business_unit_id)` (1 PR) — _ejecuta entre E y F.3_

- `accounts(id, name, type bank|cash|wallet|investment|cheques, currency ARS|USD|EUR|BRL, opening_balance, notes, is_active, created_at, updated_at)`.
- Trigger `set_updated_at` (función reusable).
- RLS: read `owner|admin|finance`, write `owner|finance`, delete `owner`.
- Permisos: `accounts:read`, `accounts:write`.
- `features/accounts/` con form + lista + edit/desactivar.

#### D.2 — `feat: transactions (channel_id obligatorio + view tagged + trigger consistencia)` (1 PR)

- `transactions(id, account_id, channel_id NOT NULL, kind income|expense|transfer_in|transfer_out, amount, currency, transaction_date, accrual_month CHECK day=1, description, comprobante_id, counterparty_client_id, transfer_pair_id self, created_by, created_at, updated_at)`.
- View `v_transactions_tagged` que joinea con `invoicing_channels` y expone `division`, `is_fiscal`.
- Trigger `check_transaction_channel_matches_comprobante` con `to_regclass` guard (dormant hasta Fase E).
- RLS: read `owner|admin|finance`, write `owner|finance`, delete `owner`.
- Permisos: `transactions:read`, `transactions:write`.
- `lib/contracts/transactions.ts` (Zod): `createTransactionSchema`, `createTransferSchema` (refine cuentas distintas), `listTransactionsSchema`.
- Server actions: `listTransactions`, `createTransaction`, `createTransfer` (paired rows con cleanup), `updateTransaction`, `deleteTransaction`.

#### D.3 — `feat: transactions UI (list filtered by scope + new with channel selector)` (1 PR)

- `/transactions` — tabla con TanStack Table (sort + filter cliente, paginación server-side cuando crezca).
- `/transactions/new` — form con tipo (ingreso/egreso/transferencia), cuenta(s), canal, monto, fecha, mes devengado (auto-aligned), descripción.
- Sidebar: links "Cuentas" + "Movimientos".

**PRs Fase D: 3.**

---

### Fase E — AFIP Comprobantes con Inngest (3-4 semanas)

> A partir de acá: Playwright + Sentry se incorporan.

> **Decisión de schema (2026-05-09):** una sola tabla `comprobantes` para
> fiscal e interno. El discriminador es `channel.is_fiscal`. Los campos
> AFIP (`cae`, `cae_vencimiento`, `cbte_tipo_afip`, `letter`) son
> nulleables y solo se llenan en fiscal. Esto deja un único listado, una
> única UI, mismos permisos y FK estables para Recibos. Para los internos
> el form esconde la letra (A/B/C) y la discriminación IVA, y el PDF lleva
> marca de agua "Documento no fiscal". El branch interno del workflow
> Inngest queda diferido a **E.7** (post-MVP).

#### E.1 — `chore: inngest setup` ✅ shipped

- `inngest@4.x` agregado y singleton tipado en `lib/inngest/client.ts`.
- Route handler `app/api/inngest/route.ts` con `serve()` y `functions: []` (vacío hasta E.4).
- README documenta el flujo de 3 terminales (`supabase start` + `pnpm dev` + `inngest-cli dev`).
- `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` documentados en `.env.local.example` (solo prod).
- **Bundleado con E.1.5 en PR #14** porque ambos son foundation de Fase E.

#### E.1.5 — `feat: AFIP admin foundation` ✅ shipped

> **Cambio de scope:** descubrimos que `FEParamGetPtosVenta` no devuelve
> ninguna descripción humana de los POS, y AFIP no tiene una forma de
> marcar "este POS está deprecado" — todo eso vive en JouveERP.

- `lib/afip/wsfev1.ts` minimal: `getServerStatus` (FEDummy) + `getSalesPoints` (FEParamGetPtosVenta) con SOAP manual + `fast-xml-parser` (mismo patrón que `padron.ts`).
- `lib/afip/errors.ts` con jerarquía tipada: `AfipError` base + `AfipConfigError | AfipInputError | AfipTransportError | AfipSoapFaultError | AfipServiceError`. Solo TRANSPORT es retryable.
- `lib/afip/diagnostics.ts` corre en paralelo: env vars, cert (X509 + días para vencer), WSAA por servicio, FEDummy. Short-circuita si env o cert están rotos.
- Migración `20260509120000_puntos_de_venta.sql`: `numero PK + channel_id FK + nickname + is_enabled + last_known_emission_type + last_known_blocked + last_synced_at`. RLS owner|admin write.
- Página `/admin/afip/puntos-de-venta` con dos secciones: **Diagnóstico** + **Puntos de venta**. Sync con AFIP upsertea las filas y la UI muestra alias/canal/habilitado por POS, configurable vía Dialog. El form de emisión (E.6) leerá solo los `is_enabled = true`.
- Permiso `afip:admin` agregado a la matriz (owner|admin only).
- Sidebar entry "Puntos de venta" gateada en `afip:admin`.

#### E.2 — `feat: comprobantes + comprobante_items` (1 PR)

- `comprobantes(id uuid pk, channel_id NOT NULL, client_id NOT NULL, kind 'factura'|'nc'|'nd', letter 'A'|'B'|'C' nullable, punto_venta NOT NULL, numero NOT NULL, fecha, imp_neto, imp_iva, imp_trib, imp_total, imp_tot_conc, imp_op_ex, cbte_tipo_afip int nullable, cae text nullable, cae_vencimiento date nullable, afip_observaciones jsonb, status 'draft'|'emitted'|'failed'|'cancelled', idempotency_key text UNIQUE, comprobante_origen_id self-fk nullable, motivo_nc_nd text, pdf_url text, emitted_at, notified_at, created_by, created_at, updated_at)`.
- Unique compuesto `(channel_id, punto_venta, kind, letter, numero)`.
- Constraint NC/ND requiere `comprobante_origen_id`.
- Constraint: `letter` y `cbte_tipo_afip` deben ser NOT NULL si `channel.is_fiscal`.
- `comprobante_items(id, comprobante_id FK CASCADE, sku?, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total, sort_order)`.
- RLS: read `owner|admin|finance`, write `owner|finance`.
- Permisos: `invoices:read|issue|cancel` (ya en la matriz desde B.2).

`afip_credentials` queda diferido — hoy las credenciales viven en env vars,
está bien para el caso single-tenant. Se agrega cuando aparezca el caso de
multi-CUIT o necesitemos rotación on-the-fly.

#### E.3 — `feat: WSFEv1 emission methods (FECompUltimoAutorizado, FECAESolicitar, FECompConsultar)` ✅ shipped

- `lib/afip/wsfev1.ts` extendido con `getLastAuthorizedNumber`, `requestCAE`, `getVoucherInfo`. Builder XML respeta el orden estricto de campos AFIP (`Concepto → DocTipo → … → MonId → CondicionIVAReceptorId → Iva`), formatea moneda a 2 decimales y fechas a `YYYYMMDD`.
- Tipos: `InvoiceRequestInput`, `InvoiceCAEResult`, `VoucherInfo`, `InvoiceCbteAsoc`, `InvoiceIvaEntry`, `InvoiceObservation`.
- `requestCAE` lanza `AfipServiceError` con observaciones cuando `Resultado != 'A'` — el caller no necesita branchear.
- `getVoucherInfo` devuelve `null` en error 602 (no existe) — habilita el path de recovery de E.4.
- Tests cubren orden de campos, formato money/fecha, opcionales (`FchServ*`, `CbtesAsoc`, `Iva`).

#### E.4 — `feat: issueInvoice Inngest function (idempotent + recovery via FECompConsultar)` ✅ shipped

- `lib/inngest/functions/issue-invoice.ts` con steps `load-draft → reserve-numero → persist-numero → request-cae (con recovery vía FECompConsultar en transport-error) → persist-cae`.
- `idempotency: "event.data.idempotency_key"`, `retries: 5`. `onFailure` marca `failed` con el error en `afip_observaciones`.
- Inngest v4 cambió la API: `triggers: [...]` plural, sin `EventSchemas`. Los eventos se validan con Zod en el boundary de cada función.
- `features/comprobantes/actions/comprobantes-actions.ts`: `issueFiscalInvoiceAction` (resuelve canal+cliente+POS, persiste draft+items, dispara evento), `getInvoiceStatusAction` (para polling).
- Endpoint `GET /api/jobs/[id]` que devuelve status + cae info.
- Branch interno rechazada explícitamente (llega en E.7).

#### E.5 — `feat: PDF + QR (@react-pdf/renderer + qrcode)` (1 PR)

> **Cambio de plan (2026-05-09):** el roadmap original elegía `pdf-lib`,
> pero esa librería está abandonada (última release hace ~4 años, status
> "inactive" según Snyk). `@react-pdf/renderer` está activo (release hace
> ~3 semanas, soporta React 19 explícitamente, ~290k weekly downloads).
> Sigue cumpliendo la regla "PDF sin headless Chrome" del anti-patrón #6.
> Adicional: las plantillas se escriben en JSX en lugar de coordenadas
> manuales, lo que las vuelve más mantenibles.

- `lib/pdf/invoice-template.tsx` — componente JSX con `<Document><Page>` por canal/letra. Para el caso interno (E.7) reusa el componente con un flag `isFiscal=false` que oculta CAE/QR y agrega marca de agua.
- `lib/afip/qr.ts` — URL canónica AFIP (`https://www.afip.gob.ar/fe/qr/?p=<base64>`) con payload obligatorio (ver, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz, tipoDocRec, nroDocRec, tipoCodAut, codAut). PNG inline vía `qrcode`.
- `lib/pdf/upload.ts` — renderiza el `<Document>` a Buffer y sube a Supabase Storage `comprobantes-pdf/<comprobante_id>.pdf`. Devuelve URL firmada de 7 días que persiste en `comprobantes.pdf_url`.
- Migración de bucket con políticas: read autenticado, write sólo service-role.
- Step nuevo `generate-pdf` en el workflow Inngest después de `persist-cae`.
- Página `/admin/afip/preview-pdf` para probar el render con un comprobante existente sin emitir nada nuevo.

#### E.6 — `feat: invoice issuance UI + Playwright smoke test` (1 PR)

- `/comprobantes` — listado filtrado por canal/período/status. Una sola tabla para fiscal e interno; columna "Tipo" diferencia con icono + texto ("Factura B" vs "Comprobante interno").
- `/comprobantes/nuevo` — Dialog con selector canal arriba (con `optgroup` Fiscal/Interno). El form se reconfigura según `channel.is_fiscal`: fiscal muestra letter + IVA discriminado + `CondicionIVAReceptor`; interno los oculta. El selector solo lista POS con `is_enabled = true` (alimentado desde la tabla de E.1.5).
- `/comprobantes/[id]` — detalle con card "Datos AFIP" (CAE, vencimiento, QR, observaciones) sólo para fiscal; interno muestra "Documento sin valor fiscal".
- Componente `InvoiceJobStatus` polea cada 1.5s al endpoint `/api/jobs/[id]`.
- Playwright: login → emitir factura B en homologación → ver CAE.
- Sentry instalado.

#### E.7 — `feat: comprobante interno branch (post-MVP)` (1 PR)

- Branch en el workflow `issueInvoice` cuando `channel.is_fiscal = false`: numeración por secuencia local (`select max(numero) + 1` con lock dentro de la transacción), salta los pasos `afip-auth`, `reserve-numero`, `afip-cae`.
- Plantilla PDF "Documento no fiscal" con marca de agua diagonal + footer legal.
- Sin QR, sin CAE.
- UI: el form esconde letra y discriminación IVA; copy "Sin valor fiscal — solo para registro interno".

**PRs Fase E: 7 (E.1 + E.1.5 ya shipped en PR #14).**

---

### Fase F — Cobranzas, recibos, cheques (2-3 semanas)

Referencia: roadmap viejo §14, §15, §19.1.

> **Orden de ejecución:** **F.3 (recibos)** se adelanta y va inmediatamente
> después de **D.1** — cierra el ciclo "emitir factura → cobrarla" sobre la
> base mínima (clients + comprobantes + accounts) sin esperar al resto de
> Caja. Después se completan D.2 + D.3, y luego el resto de F.

F.1 cobranzas + alocaciones · F.2 cheques + endosos · **F.3 recibos editables** _(adelantado, después de D.1)_ · F.4 internal_fiscal_consumption + consolidateAndFiscalize · F.5 retenciones · F.6 NC/ND · F.7 aging + cron Inngest.

**PRs Fase F: 7.**

---

### Fase G — Flota y viajes (3 semanas)

Referencia: roadmap viejo §3 + §20.

G.1 choferes + vehiculos · G.2 viajes + costos + cargas · **G.3 driver `:own` permissions + RLS de viajes propios** (decisión #4) · G.4 combustible + tarjetas · G.5 mantenimientos + cron · G.6 viaje_documentacion · G.7 rentabilidad.

**PRs Fase G: 7.**

---

### Fase H — Pallets (2-3 semanas)

Referencia: roadmap viejo §17.

H.1 depositos + pallets propios · H.2 productos + tarifas vigencia temporal · H.3 movimientos + calculate_storage_billing · H.4 PWA + scanner QR · H.5 emitStorageInvoice + reportes.

**PRs Fase H: 5.**

---

### Fase I — IA (3-4 semanas)

Referencia: roadmap viejo §29.

I.1 vercel ai sdk + claude + prompt caching · I.2 OCR remitos · I.3 categorización tx · I.4 asistente con tool use · I.5 anomalías nightly · I.6 cobranzas auto · I.7 newsletter mensual.

**PRs Fase I: 7.**

---

### Fase J — Hardening (continuo)

J.1 full-text search · J.2 backup drills · J.3 storage polimorfo · J.4 notificaciones · J.5 portal cliente · J.6 aprobaciones · J.7 indexación tarifas + multimoneda · J.8 CITI + CAEA · **J.9 loading/error/not-found UX**: revisar si vale la pena agregar `loading.tsx` + `error.tsx` + `not-found.tsx` por ruta. Hoy se decidió no aplicarlo (el flash en dev no justifica el ruido); volver acá cuando haya users reales y conexiones lentas en juego, o cuando una page tenga awaits pesados.

**PRs Fase J: 9.**

---

## 4. Cuándo introducir un backend Nest separado

**No es default.** Se considera solo si pasa al menos uno:

1. **Volumen AFIP > 1000 comprobantes/mes y la latencia de server actions de Next molesta.**
2. **Se necesita exponer una API pública** (clientes, integraciones).
3. **Aparece un segundo runtime** (Python para ML, etc.).
4. **El equipo crece > 2 devs y la separación frontend/backend ayuda al code review.**

Si se introduce: se agrega `pnpm-workspace.yaml` con `apps/web` y `apps/api`, se mueve la lógica AFIP a un module Nest. El patrón típico (auth guard + decorator que inyecta context, `nestjs-cls` para propagar `userId` por la request, helmet + throttler) está documentado en `docs/sumary-frontend-patterns.md` §10 — se adapta a single-CUIT (no hay `organization_id` que validar).

---

## 5. Métricas de éxito

| Fase | Métrica | Objetivo |
|---|---|---|
| A | CI verde, login funcional, types generation working | 100% |
| B | Cobertura matriz `userCan()` | 100% |
| B | Tests de penetración por rol | Pasan en CI |
| C | Verificación AFIP por CUIT | <2s p95 cache, <8s sin cache |
| C | Fuzzy match marca duplicados internos | >90% recall |
| D | Listado transactions con scope | <500ms p95 |
| E | Comprobantes sin intervención | >99% homologación |
| E | p95 emisión factura | <10s |
| E | Duplicados por idempotencia | 0 |
| F | Aging por cliente | <1s hasta 10k movimientos |
| G | Vencimientos doc con alerta | 100% |
| H | Discrepancia stock físico/sistema | <0.5% mensual |
| I | OCR remitos precisión | >95% |
| J | MTTR incidentes | <30 min |

---

## 6. Anti-patrones (lecciones de proyectos previos)

1. **Mezclar deuda vieja con código nuevo.** Lo que se traiga del repo viejo va en PR aislado `chore: port <module> from old repo`.
2. **`select *`.** Especificar columnas siempre.
3. **`any` y `as`.** Bloqueado en ESLint flat config desde A.2.
4. **Migraciones sin orden.** Workflow CI dedicado.
5. **Tipos de Supabase a mano o sin generar.** Se generan, se commitean, CI checkea drift.
6. **PDF con headless Chrome.** Usar `@react-pdf/renderer` directo (decisión 2026-05-09 — `pdf-lib` quedó abandonado en 2022).
7. **Color para diferenciar acciones.** Sin colores. Iconos + copy + posición.
8. **PRs todo-en-uno.** Si el diff cambia migración + UI + tests + 3 features, se parte.
9. **Realtime de Supabase para eventos críticos.** Solo para refrescar UI cuando otro user inserta. Workflows críticos van por Inngest.
10. **Multi-tenancy prematuro.** Nuestra app es single-CUIT; no introducir `organizations` ni separation por tenant.
11. **NestJS por moda.** Server actions de Next alcanzan hasta que duela. Evaluar §4 antes de partir.
12. **Redux por moda.** TanStack Query default para server state. Zustand solo si aparece estado cliente complejo.

---

## 7. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| AFIP cambia API/cert | Alta | Alto | Inngest con retries; nightly homologación; CAEA fallback (J.8) |
| RLS mal escrita filtra datos | Media | Crítico | Pentest tests por tabla en CI desde B |
| Privilege escalation | Baja | Crítico | `canAssignRole` + tests |
| AFIP timeouts disparan latencia | Media | Medio | Cache TA (12h), padrón (24h), rate-limit |
| Drift de tipos generados | Media | Medio | CI workflow + husky pre-push |
| Costos IA crecen | Media | Medio | Prompt caching desde I.1 + cap por user |
| Dev solo se enferma | Alta | Alto | Roadmap + tests + PRs chicos |

---

## 8. Cómo arrancar mañana

**Estado al 2026-05-09**: Fases A, B, C, **E.1 + E.1.5 + E.2 + E.3 + E.4** shipped. La próxima PR es **E.5** (`@react-pdf/renderer` + QR). El orden a seguir es:

1. **E.5** — PDF + QR (`@react-pdf/renderer` + `qrcode`).
2. **E.6** — UI + Playwright smoke.
3. **D.1** — `accounts` (caja mínima, condición previa para F.3).
4. **F.3** — recibos editables (cierra el ciclo AR).
5. **D.2 + D.3** — transactions + UI + transferencias.
6. **F.1, F.2, F.4–F.7** — el resto de cobranzas.
7. **E.7** (post-MVP) — branch interna del workflow + plantilla PDF "no fiscal".
8. Continuar con G, H, I, J en orden.

**Regla de oro:** una fase no empieza si la anterior no tiene CI verde + tests
mínimos + test manual de los flows críticos.

---

## 9. Referencia rápida

- **Patrones de Sumary** (frontend, tooling): `docs/sumary-frontend-patterns.md`.
- **Implementación previa** (a portar selectivamente): repo `LogisticaTransporteJouve`, ramas `feat/business-units-scope` y `feat/accounts-transactions`.

Lecciones a no repetir del repo viejo:
- `lib/rate-limit.ts` tenía un upsert no-op antes del manualIncrement — copiar **solo el manualIncrement**.
- Threshold fuzzy `0.45` → corregido a **0.5** para internos, **skip** para fiscales.
- `driver: []` queda vacío hasta G.3.
- Tipos del cliente Supabase **no** estaban generados — los errores `never` venían de eso. Acá se generan desde A.7.
