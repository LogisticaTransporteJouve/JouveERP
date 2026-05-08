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

---

## 3. Roadmap por fases

> Cada fase se descompone en PRs ≤500 LOC. Si una migración + UI rompen la
> regla, se aceptan PRs hasta ~1000 LOC.

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
- **Vitest** — sin `vitest.config.ts`. Llega con el primer test (A.4 logger o B.2 withAuth).
- **Husky hooks** — el directorio existe pero `pre-commit` y `pre-push` no están escritos. Pendiente: `pre-commit: pnpm exec lint-staged`. `pre-push: regenera tipos si hay nuevas migrations + corre tests`.
- **lint-staged** — sin `lint-staged.config.mjs`.

❌ **No hecho** — entran cuando aparezca el caso de uso:
- `migration-order-check.yml` workflow → con B.1 (primera migración real).
- Scripts: `db:types:check` → con A.7. (`db:types:generate` ya existe pero apunta a `scripts/db-types.sh` que tampoco está creado todavía.)

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

#### A.5 — `feat: supabase clients (server, browser, service) + proxy.ts (CSP + session)` (1 PR)

- `lib/supabase/server.ts` — `createClient()` async para server components/actions, **tipado con `Database`** (que será generado en A.7).
- `lib/supabase/client.ts` — `createBrowserClient<Database>(...)` para client components.
- `lib/supabase/service.ts` — `getServiceClient()` con `SUPABASE_SERVICE_ROLE_KEY`. **Solo server-side.**
- `lib/supabase/proxy.ts` — refresca sesión en cada request, forwardea x-nonce.
- `proxy.ts` (root, Next 16 renombró `middleware.ts` → `proxy.ts`) — genera nonce per-request, llama a `updateSession`, aplica CSP estricto. Para JouveERP arrancamos con CSP estricto desde el día 1 (no shadow rollout — somos app nueva, no hay legacy assets a tolerar).
- `lib/security/csp.ts` — builder de CSP. Ver builder pegable completo en `docs/sumary-frontend-patterns.md` §18.2.
- `.env.local.example` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` documentados.
- **Sin tipos generados todavía** — el `Database` queda como `any` temporal hasta A.7. Se documenta en el PR.

#### A.6 — `feat: auth pages (login, logout) + protected dashboard` (1 PR)

- `app/auth/login/page.tsx` — form con email + password (react-hook-form + zod), llama a `signInWithPassword`. Server action.
- `app/auth/logout/route.ts` — endpoint `signOut` + redirect.
- `app/(dashboard)/layout.tsx` — chequea sesión; si no, redirect a `/auth/login`.
- `app/(dashboard)/page.tsx` — placeholder "Dashboard en construcción".
- `lib/auth/public-pages.ts` — `shouldSkipAuthRedirect(pathname)` para rutas públicas (login, signup, etc.).
- Manual: alta del primer user en Supabase Studio, login OK.

#### A.7 — `chore: supabase types generation + ci drift check` (1 PR)

- `supabase init` (config local).
- Una migración mínima `<ts>_init.sql` que crea extensión `pg_trgm` (que usaremos en C). Sirve de "primera migración" para probar el pipeline.
- `scripts/db-types.sh`:
  ```bash
  #!/bin/bash
  set -e
  pnpm dlx supabase gen types typescript --local --schema public > lib/db/database.types.ts
  pnpm exec prettier --write lib/db/database.types.ts
  ```
- `package.json` scripts:
  ```json
  "db:types:generate": "bash scripts/db-types.sh",
  "db:types:check": "bash scripts/db-types-check.sh"
  ```
- CI step en `ci.yml`: si hay nuevas migraciones, regenera y falla si hay drift.
- Husky `pre-push` hace lo mismo localmente.

**PRs Fase A: 7.** Al cerrar: repo deployable, login funcional, types generation working, CI verde.

---

### Fase B — Foundation: RBAC + Multi-división (1-2 semanas)

#### B.1 — `feat: migration roles + user_roles + audit_events + helper user_has_role` (1 PR)

Migración `<ts>_roles_and_audit.sql`:
- Catálogo `roles` (6 filas: owner, admin, finance, operations, warehouse, driver).
- `user_roles(user_id, role_id, granted_by, granted_at)`.
- `audit_events(id, ts, actor_id, event_type, target_user_id, target_resource_id, payload, ip_address, user_agent)`.
- `public.user_has_role(text[])` con `(select auth.uid())` cacheado.
- Trigger constraint deferrable: siempre ≥1 owner activo.
- RLS: lectura `user_roles` self o admin/owner; escritura solo admin/owner; lectura `audit_events` solo admin/owner.

#### B.2 — `feat: permissions matrix + withAuth wrapper + getCurrentUserContext` (1 PR)

- `lib/auth/permissions.ts` — `Role`, `Permission`, `ROLE_PERMISSIONS`, `userCan()`, `canAssignRole()`.
- `lib/auth/with-auth.ts` — wrapper con sesión + roles + opcional permission + Zod parse.
- `lib/auth/users.ts` — helpers `listUsersWithRoles`, `ownerCount`, `getCurrentUserRoles`.
- `lib/auth/context.ts` — `getCurrentUserContext()` server-only que devuelve `{ userId, roles }`. Punto único de acceso al contexto en cada server action — la action pide context al inicio, falla si no hay sesión, y usa `roles` para chequeos finos cuando el permiso es contextual (no expresable en la matriz). Ver patrón completo en `docs/sumary-frontend-patterns.md` §10.
- Tests Vitest: matriz completa, `canAssignRole`, unión de roles.

#### B.3 — `feat: admin/users page (list + invite + assign/revoke)` (1 PR)

- `app/(dashboard)/admin/users/page.tsx` server-rendered con `listUsers`.
- `features/admin-users/components/users-table.tsx` — tabla con email, último acceso, chips de roles.
- `features/admin-users/components/invite-user-dialog.tsx` — multi-select de roles iniciales filtrado por `canAssignRole`.
- `features/admin-users/actions/users-actions.ts`: `listUsers`, `assignRole`, `revokeRole`, `inviteUser`, `bootstrapOwnerIfNeeded`.
- Sidebar: link "Usuarios" con icono `ShieldCheck`.

#### B.4 — `feat: business_units + invoicing_channels (1 unit, 4+ channels)` (1 PR)

- Migración `<ts>_business_units_channels.sql`:
  - `business_units(id text pk, name, cuit, tax_condition, tax_address, is_active)` — seed: 1 fila `dz_sons`.
  - `invoicing_channels(id text pk, business_unit_id, name, division text check ('dz'|'jouve'), is_fiscal, display_color, is_active, unique(business_unit_id, division, is_fiscal))` — seed: 4 filas. Schema permite agregar más sin migración.
  - RLS: lectura `authenticated`; escritura `owner|admin`.

#### B.5 — `feat: ScopeProvider + ScopeSelector (division + fiscal filter)` (1 PR)

- `components/providers/scope-provider.tsx` — context con `division?` + `fiscal_filter`. Persiste localStorage.
- `components/scope-selector.tsx` — dos `Select` shadcn en el header. Solo borders + `text-muted-foreground`, sin colores.
- `lib/scope.ts`: `channelsForScope(scope) → InvoicingChannelId[] | null`.

**PRs Fase B: 5.**

---

### Fase C — Clientes (1-2 semanas)

#### C.1 — `feat: clients table + search + RLS` (1 PR)

- `clients(id, cuit nullable, legal_name, display_name, tax_condition, address, phone, fiscal_counterpart_id self-fk, is_active, created_at, updated_at)`.
- `unique index clients_cuit_unique on clients(cuit) where cuit is not null`.
- Constraint `cuit not null xor fiscal_counterpart_id not null`.
- `pg_trgm` + GIN index sobre `lower(display_name)`.
- Función `find_similar_clients(p_display_name, p_cuit, p_threshold)`.
- RLS: read `owner|admin|finance|operations`, write `owner|admin|finance`.
- Permisos: `clients:read`, `clients:write`.

#### C.2 — `feat: AFIP plumbing (env, wsaa, ta cache, padron, padron cache, rate limit)` (1 PR)

- Migración `<ts>_afip_caches.sql`:
  - `afip_ta_cache(service text pk, token, sign, expiration_time, cached_at)` — RLS sin policies.
  - `padron_cache(cuit text pk, data jsonb, cached_at)`.
  - `rate_limit_buckets(user_id, bucket_key, window_start, count)`.
- `lib/afip/{env,wsaa,padron,types}.ts` — port limpio del repo viejo (sin el upsert no-op de rate-limit).
- `lib/rate-limit.ts` — versión correcta (un solo path).
- Server action `verificarCuit(cuit)` con rate-limit (60/h), caché 24h, fallback stale.
- Permiso: `padron:lookup`.

#### C.3 — `feat: clients UI (list + form with verify-CUIT + similar dialog)` (1 PR)

- `features/clients/actions/clients-actions.ts`: `getClients`, `getClient`, `createClient` (`{status: 'created'|'needs_confirmation'}`), `updateClient`, `deactivateClient`, `findSimilarClients`.
- Hooks `useClients`, `useClient`.
- `features/clients/components/clients-table.tsx`, `client-form.tsx`, `similar-clients-dialog.tsx`.
- Cliente fiscal: gate inicial CUIT + verify. Internal: form completo.
- Threshold fuzzy **0.5**, solo si `cuit` is null.
- Páginas `/clients`, `/clients/new`, `/clients/[id]`.

**PRs Fase C: 3.**

---

### Fase D — Caja única (Accounts + Transactions) (1-2 semanas)

#### D.1 — `feat: accounts (caja única, sin business_unit_id)` (1 PR)

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

#### E.1 — `chore: inngest setup` (1 PR)

- `pnpm add inngest`.
- `lib/inngest/client.ts`, `app/api/inngest/route.ts`.
- Documentar en `README.md` que dev local requiere 3 terminales: `pnpm dev`, `pnpm dlx inngest-cli dev -u http://localhost:3000/api/inngest`, `pnpm dlx supabase start`. Si crece la necesidad, agregamos un script con `concurrently` — pero por ahora 3 terminales alcanza.

#### E.2 — `feat: comprobantes + comprobante_items + puntos_de_venta + afip_credentials` (1 PR)

- `puntos_de_venta(id, cuit, channel_id, numero, descripcion)` con trigger consistencia.
- `comprobantes(id, channel_id, tipo, punto_venta_id, numero, fecha, cliente_id, cae, cae_vencimiento, total_neto, total_iva, total, status, idempotency_key UNIQUE, comprobante_origen_id, motivo_nc_nd, emitted_at, notified_at, created_by)`.
- Constraint NC/ND requiere `comprobante_origen_id`.
- `comprobante_items(...)`.
- `afip_credentials(cuit pk, cert encrypted, private_key encrypted, environment)` — Supabase Vault para encrypted columns.
- Permisos: `invoices:read|issue|cancel`.

#### E.3 — `feat: WSFEv1 client (FECompUltimoAutorizado, FECAESolicitar, FECompConsultar)` (1 PR)

- `lib/afip/wsfev1.ts` con tipos.
- Reusa `getAccessTicket('wsfe')` de Fase C.
- Errores estructurados: `AfipValidationError` (no-retryable).

#### E.4 — `feat: issueInvoice Inngest function (idempotent + recovery via FECompConsultar)` (1 PR)

- `lib/inngest/functions/issue-invoice.ts` con steps `reserve-draft → afip-auth → reserve-numero → afip-cae (con recovery) → pdf → notify`.
- `idempotency: "event.data.idempotency_key"`, `retries: 10`, `throttle: { limit: 30, period: "1m" }`.
- `onFailure` marca `failed`.
- Server action `issueFiscalInvoice` que valida con Zod, persiste draft, dispara `inngest.send`.
- Endpoint `/api/jobs/[id]` para polling.

#### E.5 — `feat: PDF + QR (pdf-lib + qrcode)` (1 PR)

- `lib/pdf/invoice.ts` — plantilla por `division`.
- `lib/afip/qr.ts` — URL canónica AFIP + QR generation.
- Sube a Supabase Storage `comprobantes-pdf/`.

#### E.6 — `feat: invoice issuance UI + Playwright smoke test` (1 PR)

- `/invoices` — listado filtrado por canal/período/status.
- `/invoices/new` — selector canal + cliente autocomplete + items + totales.
- Componente `InvoiceJobStatus` polea cada 1.5s.
- Playwright: login → emitir factura B en homologación → ver CAE.
- Sentry instalado.

**PRs Fase E: 6.**

---

### Fase F — Cobranzas, recibos, cheques (2-3 semanas)

Referencia: roadmap viejo §14, §15, §19.1.

F.1 cobranzas + alocaciones · F.2 cheques + endosos · F.3 recibos editables · F.4 internal_fiscal_consumption + consolidateAndFiscalize · F.5 retenciones · F.6 NC/ND · F.7 aging + cron Inngest.

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

J.1 full-text search · J.2 backup drills · J.3 storage polimorfo · J.4 notificaciones · J.5 portal cliente · J.6 aprobaciones · J.7 indexación tarifas + multimoneda · J.8 CITI + CAEA.

**PRs Fase J: 8.**

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
6. **PDF con headless Chrome.** `pdf-lib` directo.
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

1. `cd ~/Desktop/JouveERP`.
2. PR-1 de Fase A.1 (`chore: init Next.js + pnpm + Tailwind v4 + shadcn`).
3. Cuando merge a main, abrir A.2.
4. Etcétera.

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
