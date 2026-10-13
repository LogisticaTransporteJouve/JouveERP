# Patrones de la app de referencia aplicables a JouveERP

> Referencia técnica extraída leyendo el código de `~/Desktop/reference-app` directamente.
> Todo lo de acá tiene path absoluto al archivo origen para ir a leer el detalle
> cuando se implemente. Lo que aplica directo a JouveERP va marcado con ✅; lo
> que **NO** aplica (multi-tenancy real, etc.) va con ❌.

---

## 1. Tooling y monorepo

### 1.1 pnpm como package manager (no npm) ✅

`package.json` raíz:

```json
{
  "private": true,
  "packageManager": "pnpm@10.30.2",
  "engines": { "node": ">=20" },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"],
    "overrides": {
      "fast-xml-parser": ">=5.3.8",
      "multer": ">=2.1.1",
      "lodash": ">=4.18.1",
      "qs": ">=6.14.2"
    }
  }
}
```

**Tres cosas que importan:**

- `packageManager` field — **CI lee la versión de acá** vía `pnpm/action-setup@v4`. No hay que mantener sync entre repo y CI.
- `engines.node: ">=20"` — bloquea Node viejos.
- `pnpm.onlyBuiltDependencies` — **bloquea scripts de install** salvo los explícitos. Mitigación de supply-chain (un paquete malicioso no puede correr postinstall arbitrario).
- `pnpm.overrides` — **pinea transitivas vulnerables** sin esperar a que el dep root las actualice.

### 1.2 Workspaces ✅ (cuando hagamos falta — Fase E al menos)

Para JouveERP **probablemente no haga falta nunca**: si el Nest API para AFIP se concreta, ahí sí pasamos a workspace con `apps/web` + `apps/api` + `packages/shared`. El patrón básico:

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Workspace dependencies se referencian con `"@jouve/shared": "workspace:*"`. pnpm linkea por symlink, no publica a npm. La migración (single-app → workspace) es mecánica: mover `app/`, `components/`, etc. a `apps/web/`.

### 1.3 Scripts del root con `--filter` ✅ (cuando haya workspace)

```json
"scripts": {
  "shared:build": "pnpm --filter @jouve/shared build",
  "web:dev": "pnpm --filter ./apps/web dev",
  "api:dev": "pnpm --filter @jouve/api dev",
  "build": "pnpm -r build",
  "test": "pnpm -r test"
}
```

`pnpm -r` corre el script en todos los paquetes que lo tienen. `pnpm --filter` ejecuta en uno específico.

---

## 2. Dev local: variables de entorno

### 2.1 dotenv-cli para cargar .env.local en dev ✅

```json
// package.json
"dev": "dotenv -e .env.local -- next dev"
```

Razón: `dotenv-cli` evita tener que importar `dotenv` en código. El env file solo carga durante `dev`. En prod las vars vienen del provider (Vercel).

> **Para JouveERP en Fase A** alcanza con un solo `pnpm dev`. Cuando sumemos Inngest + Supabase local en Fase E, son 3 terminales paralelos (`pnpm dev`, `pnpm dlx inngest-cli dev`, `pnpm dlx supabase start`). Si la fricción molesta, agregamos `concurrently` como dep dev — sin Procfile/hivemind.

---

## 3. Husky + lint-staged + pre-push guardrails

### 3.1 Husky 9 ✅

`pnpm add -D husky lint-staged && pnpm exec husky init`

`.husky/pre-commit`:
```bash
pnpm exec lint-staged -c lint-staged.config.mjs
```

`lint-staged.config.mjs`:
```js
export default {
  '{src,test}/**/*.ts': [
    // 'eslint --fix',  // will slow down development if enabled on commit
    'pnpm exec prettier --write',
  ],
  '*.{md,html,css,yml,json}': 'pnpm exec prettier --write',
};
```

> Comentario inline explica por qué eslint está apagado en pre-commit: ralentiza demasiado. Eslint se corre en CI.

### 3.2 Pre-push: regenera tipos si hay nuevas migraciones ✅ (alto valor)

`.husky/pre-push` (versión adaptada a JouveERP single-app):
```bash
# Check Supabase types only when new migrations were added since branching from main
if git show-ref --verify --quiet refs/remotes/origin/main; then
  merge_base="$(git merge-base HEAD origin/main)"
else
  merge_base=""
fi

has_new_migrations=0
if [ -n "$merge_base" ]; then
  new_migrations_count="$(git diff --diff-filter=A --name-only "$merge_base"...HEAD -- "supabase/migrations/*.sql" | wc -l | xargs)"
  if [ "$new_migrations_count" -gt 0 ]; then
    has_new_migrations=1
  fi
fi

if [ "$has_new_migrations" -eq 1 ]; then
  pnpm run db:types:generate
  if ! git diff --quiet lib/db/database.types.ts; then
    echo "Error: Supabase types are out of date. Run 'pnpm run db:types:generate' and commit the changes."
    git checkout -- lib/db/database.types.ts
    exit 1
  fi
fi

pnpm test
```

**Lo más importante:** si hay nuevas migraciones, **regenera los tipos** y falla el push si los tipos commiteados están stale. Esto cierra el agujero de "agregaste columna y olvidaste regenerar tipos" que tuvimos en LogisticaTransporteJouve (donde todo era `never`).

---

## 4. CI/CD con GitHub Actions

### 4.1 ci.yml estructura ✅

```yaml
name: CI
on:
  pull_request:
    branches: [staging]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # IMPORTANTE: full history para git diff

      - uses: pnpm/action-setup@v4   # lee versión del packageManager field

      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }

      - run: pnpm install --frozen-lockfile

      - name: Detect new migrations
        id: new_migrations
        run: |
          git fetch origin "${{ github.base_ref }}" --depth=1
          migration_count="$(git diff --diff-filter=A --name-only "origin/${{ github.base_ref }}...HEAD" -- "supabase/migrations/*.sql" | wc -l | xargs)"
          if [ "$migration_count" -gt 0 ]; then
            echo "has_new_migrations=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Check Supabase types are up to date
        if: steps.new_migrations.outputs.has_new_migrations == 'true'
        run: |
          pnpm run db:types:generate
          if ! git diff --quiet lib/db/database.types.ts; then
            echo "::error::Supabase types are out of date. Run pnpm db:types:generate locally and commit."
            exit 1
          fi

      - run: pnpm exec prettier --check "**/*.{ts,tsx}"
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
        env:
          NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co"
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub"
          SUPABASE_SERVICE_ROLE_KEY: "stub"
```

**Patterns clave:**
- `fetch-depth: 0` — necesario para `git diff base...HEAD`.
- `pnpm/action-setup@v4` antes de `setup-node@v4` con `cache: 'pnpm'` (orden importa).
- `pnpm install --frozen-lockfile` falla si lockfile drift.
- Types-drift check **condicional** — solo si hay nuevas migraciones, ahorra tiempo.
- `pnpm build` recibe **env vars stub** — Next.js lee envs en build time pero las reales solo existen en deploy.

### 4.2 migration-order-check.yml ✅ (oro puro)

```yaml
name: Migration Order Check
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches: [staging]
    paths:
      - "supabase/migrations/*.sql"

jobs:
  check-migration-order:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: |
          git fetch origin "${{ github.base_ref }}" --depth=1
          new_migration_files=$(git diff --diff-filter=A --name-only "origin/${{ github.base_ref }}...HEAD" -- "supabase/migrations/*.sql")
          if [ -z "$new_migration_files" ]; then exit 0; fi

          latest_migration_file_timestamp=$(git ls-tree --name-only "origin/${{ github.base_ref }}" supabase/migrations/ \
            | sed 's/.*\///' | grep -oE '^[0-9]+' | sort | tail -n 1)

          errors=0
          while IFS= read -r file; do
            timestamp=$(basename "$file" | grep -oE '^[0-9]+')
            if [ "$timestamp" -le "$latest_migration_file_timestamp" ]; then
              echo "::error::Migration $file timestamp $timestamp is not newer than the latest on ${{ github.base_ref }} ($latest_migration_file_timestamp)."
              errors=$((errors + 1))
            fi
          done <<< "$new_migration_files"
          if [ "$errors" -gt 0 ]; then exit 1; fi
```

**Para qué sirve:** dos PRs en paralelo no pueden mergear migraciones con el mismo timestamp. El segundo PR tiene que regenerar la migración con timestamp posterior. **Esto evita el bug "mi migración quedó antes que la de master, supabase migration up se rompe en prod"**.

### 4.3 Branch flow ❌ no copiar literal

La app de referencia: PRs van a `staging`, después workflow `promote-to-production` separado para mover a `production`.

**Para JouveERP:** **`feature → main`** mientras seamos un dev solo. La capa `staging` es overhead que no vale la pena para un sprint de un proyecto chico. Lo agregamos cuando seamos > 1 dev y un mismo `main` ya no represente "lo desplegado".

---

## 5. Estructura del frontend (Next.js 16 App Router)

### 5.1 Layout de carpetas ✅

```
frontend/src/
├── app/
│  ├── (main)/                # Layout group: rutas protegidas
│  │  ├── layout.tsx          # Wraps con providers + sidebar
│  │  ├── loading.tsx         # Skeleton genérico
│  │  ├── page.tsx            # Home
│  │  ├── close-management/
│  │  ├── reporting/
│  │  └── settings/
│  ├── auth/                  # Páginas públicas (login, signup, callback)
│  ├── api/                   # Route handlers
│  ├── globals.css            # Tailwind + theme vars
│  └── layout.tsx             # Root: providers + fonts + Toaster
├── features/                 # Feature-scoped (un módulo de negocio = una feature)
│  └── <feature>/
│     ├── actions/            # "use server" — server actions
│     ├── components/
│     ├── hooks/
│     ├── lib/                # utils sin React
│     ├── schemas/            # Zod schemas
│     ├── types/              # TS interfaces
│     └── index.ts            # barrel
├── components/
│  ├── ui/                    # shadcn primitivos (button, table, dialog…)
│  ├── layout/                # Header, sidebar, ThemeProvider
│  ├── providers/             # Query, Theme, Access, Intercom, PostHog
│  ├── shared/                # Cross-feature reusable (FilterDropdown, etc.)
│  ├── ai-elements/
│  ├── feature-flagged/
│  ├── file-preview/
│  └── file-upload/
├── hooks/                    # Hooks globales
│  ├── use-validated-organization.ts
│  ├── use-mobile.ts
│  ├── use-confirm.tsx
│  └── use-group-only-state.ts
├── lib/
│  ├── supabase/              # client.ts, server.ts, proxy.ts (middleware)
│  ├── auth/                  # public-pages.ts
│  ├── security/              # csp.ts
│  ├── utils/                 # organization-utils.ts, server-organization-utils.ts
│  ├── files/
│  ├── logger.ts              # Frontend logger (no-op en client)
│  ├── otel-logger.ts         # OTLP exporter para PostHog logs
│  └── utils.ts               # cn() solamente
├── instrumentation.ts        # Next 16 hook (opt-in, OTel logger)
├── instrumentation-client.ts # PostHog init
└── proxy.ts                  # Next 16 (renamed middleware.ts)
```

> **Para JouveERP:** sin `store/` (Redux descartado). Sin `app/(main)/` por ahora — usamos `app/(dashboard)/` como ya existe en el repo viejo. Si después aparece un layout secundario (portal cliente, admin) se agregan más groups paréntesis.

### 5.2 Convenciones de imports ✅

```tsx
// Solo se permite importar de:
import { Button } from "@/components/ui/button";              // primitivos shadcn
import { createClient } from "@/lib/supabase/server";         // libs
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-current-user";    // hooks globales
import type { Database } from "@/lib/db/database.types";      // tipos generados
```

**Prohibido:**
- `@/features/<other-feature>/...` — features no se importan entre sí. Si compartís algo, sube a `@/lib/` o `@/components/shared/`.
- `../../../` paths relativos largos. Siempre `@/`.

### 5.3 Barrel files (`index.ts`) ✅

Cada feature exporta su API pública en `index.ts`:

```ts
// features/close-management/index.ts
export * from "./actions/close-period-actions";
export * from "./types";
export { ReconciliationDialog } from "./components/ReconciliationDialog";
```

Reduce ruido al importar y permite renombrar internos sin romper consumers.

### 5.4 Path alias TS ✅

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "esnext",
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

> La app de referencia tiene `strict: false` y `noImplicitAny: false`. **Para JouveERP recomiendo `strict: true` y `noUncheckedIndexedAccess: true`** — el costo en boilerplate vale la pena en un proyecto nuevo.

---

## 6. Theming, fonts y paleta

### 6.1 Geist Sans + Geist Mono via next/font ✅

`app/layout.tsx`:
```tsx
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default async function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* providers */}
      </body>
    </html>
  );
}
```

**`suppressHydrationWarning`** en `<html>` — necesario porque `next-themes` modifica la class antes de hydration.

### 6.2 Tailwind v4 con @theme inline + oklch ✅

`app/globals.css`:
```css
@import "tailwindcss";
@import "tw-animate-css";
@source "../node_modules/streamdown/dist/index.js";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);   /* hue 285 → muy leve violeta */
  --primary: oklch(0.21 0.006 285.885);
  --primary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.967 0.001 286.375);
  --muted-foreground: oklch(0.552 0.016 285.938);
  --accent: oklch(0.967 0.001 286.375);
  --destructive: oklch(0.577 0.245 27.325);   /* el ÚNICO color (rojo) */
  --border: oklch(0.92 0.004 286.32);
  --ring: oklch(0.705 0.015 286.067);
  /* ... sidebar vars idem ... */
}

.dark {
  --background: oklch(0.141 0.005 285.823);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.92 0.004 286.32);
  --primary-foreground: oklch(0.21 0.006 285.885);
  /* ... */
}
```

**Lo que define el lenguaje visual:**
- `oklch()` — espacio perceptualmente uniforme. Mejor que HSL para grises porque mantiene la luminosidad consistente.
- Hue ~285 (zinc) en la app de referencia. **Para JouveERP poné `0` en hue (gris puro).**
- `--radius: 0.625rem` (10px) como base, que se deriva en `sm/md/lg/xl`.
- **`tw-animate-css`** importado para tener `animate-in/out` y similares con sintaxis Tailwind v4.

### 6.3 ThemeProvider + next-themes ✅

```tsx
// app/layout.tsx
<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
  nonce={nonce}              // CSP-safe inline script
>
  <ThemeContextProvider>
    {children}
  </ThemeContextProvider>
</ThemeProvider>
```

`ThemeContextProvider` envuelve `useTheme()` y expone `currentTheme` + `isDark` derivados — un patrón para componentes que necesitan saber el theme **resuelto** (no `system`).

```tsx
// components/layout/ThemeContext.tsx
export function ThemeContextProvider({ children }) {
  const { resolvedTheme } = useTheme();
  const [themeState, setThemeState] = useState({ currentTheme: "light", isDark: false });

  useEffect(() => {
    if (resolvedTheme) {
      setThemeState({ currentTheme: resolvedTheme, isDark: resolvedTheme === "dark" });
    }
  }, [resolvedTheme]);

  return <ThemeContext.Provider value={themeState}>{children}</ThemeContext.Provider>;
}
```

### 6.4 cn() helper ✅

`lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Único contenido del archivo. Pequeño y se usa en todos lados.

### 6.5 Toaster (sonner) tematizado ✅

`components/ui/sonner.tsx`:
```tsx
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={{
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
      } as React.CSSProperties}
      {...props}
    />
  );
};
```

Inyecta CSS vars del theme para que sonner respete el modo oscuro automático.

---

## 7. Layout: sidebar + header + breadcrumbs

### 7.1 Root layout (jerarquía de providers) ✅

`app/layout.tsx`:
```tsx
return (
  <html lang="en" suppressHydrationWarning>
    <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <QueryProvider>          {/* TanStack Query */}
        <ReduxProvider>        {/* (opcional para JouveERP — saltarlo) */}
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
            <ThemeContextProvider>
              <PostHogIdentify>
                <WebVitals />
                <IntercomProvider>
                  {children}
                  <Toaster />
                </IntercomProvider>
              </PostHogIdentify>
            </ThemeContextProvider>
          </ThemeProvider>
        </ReduxProvider>
      </QueryProvider>
    </body>
  </html>
);
```

**Orden de providers crítico:**
1. `QueryProvider` afuera de todo — los providers internos pueden hacer queries.
2. `ThemeProvider` antes de cualquier UI que necesite theme.
3. `PostHogIdentify` antes de `IntercomProvider` y demás analytics.
4. `Toaster` al final (para que se renderice por encima).

### 7.2 (main) protected layout ✅

`app/(main)/layout.tsx`:
```tsx
export default function MainLayout({ children }) {
  return (
    <ReportBuilderDataProvider>
      <AccessStateProvider>
        <SidebarProvider className="min-h-0 h-svh overflow-hidden">
          <NotificationSidebarProvider>
            <AppSidebar />
            <NotificationSidebarPanel />
            <SidebarInset className="overflow-y-auto">
              <div className="flex-1 bg-muted/40">
                <ProtectedContent>{children}</ProtectedContent>
              </div>
            </SidebarInset>
          </NotificationSidebarProvider>
        </SidebarProvider>
      </AccessStateProvider>
    </ReportBuilderDataProvider>
  );
}
```

**`min-h-0 h-svh overflow-hidden`** en SidebarProvider — clave para que el inset interno scrollee sin desbordar la viewport. `h-svh` (small viewport height) maneja mejor los keyboards en mobile.

`ProtectedContent` renderiza children directo si el user tiene acceso, o muestra `NoOrganizationAccess` si no.

### 7.3 SidebarProvider con persistencia en cookie ✅

`components/ui/sidebar.tsx` (shadcn):
```ts
const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;   // 7 días
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";   // Cmd+B / Ctrl+B
```

El estado open/closed se guarda en cookie `sidebar_state`. El servidor lee la cookie en SSR para evitar flash de contenido.

### 7.4 AppSidebar — composición ✅

`components/layout/sidebar/AppSidebar.tsx`:
```tsx
return (
  <Sidebar variant="inset" {...props}>
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <NavOrg />     {/* Switcher de organización */}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      <NavNotifications items={data.upper} />     {/* Inbox */}
      <NavMain items={data.navMain} allDisabled={shouldDisableNav} />
      <NavConfig items={data.navConfig} allDisabled={shouldDisableNav} />
      <NavSecondary items={data.navSecondary} className="mt-auto" />
    </SidebarContent>
    <SidebarFooter>
      <NavUser onHasGroupChange={handleHasGroupChange} />
    </SidebarFooter>
  </Sidebar>
);
```

Estructura:
- **Header:** switcher de "tenant" (org en la app de referencia; en JouveERP **no aplica** — saltarlo, queda solo el logo).
- **Content:**
  - Nav superior (notifications inbox)
  - NavMain (módulos principales con sub-items collapsibles)
  - NavConfig (Settings + Files)
  - NavSecondary (Support, themes — `mt-auto` lo empuja al fondo)
- **Footer:** user dropdown (avatar + email + logout).

### 7.5 NavMain — sub-items expandibles ✅

`components/layout/sidebar/NavMain.tsx` (lógica clave):
```tsx
const segments = useSelectedLayoutSegments();
const [manuallyToggled, setManuallyToggled] = useState<Record<string, boolean>>({});

const isUrlActive = (url: string) => {
  if (url === "#") return false;
  const urlSegments = url.split("/").filter(Boolean);
  return urlSegments.length === segments.length &&
    urlSegments.every((segment, i) => segments[i] === segment);
};

const shouldMenuBeOpen = (item) => {
  const hasActiveChild = item.items?.some((sub) => isUrlActive(sub.url));
  const isParentActive = isUrlActive(item.url);
  return hasActiveChild || isParentActive;
};

// Open by default if route matches; manualToggle override si user lo cierra a propósito
const isMenuOpen = (item) => manuallyToggled[item.title] ?? shouldMenuBeOpen(item);
```

**Patrón "auto-open + manual override":** el submenú se abre automáticamente cuando estás en una de sus rutas hijas. Si el user lo cierra explícitamente, se respeta el override.

```tsx
<Link
  href={item.url}
  onClick={(e) => {
    if (item.disabled) { e.preventDefault(); return; }
    if (item.url !== "#") router.prefetch(item.url);   // ← prefetch en hover
  }}
>
```

**Prefetch en click de Link** — Next.js ya hace prefetch en hover, pero acá lo refuerza para que la navegación se sienta instantánea.

### 7.6 NavOrg — switcher con Command palette ✅ (adaptación: NO multi-org en JouveERP)

`components/layout/sidebar/NavOrg.tsx` (esqueleto):
```tsx
export function NavOrg() {
  const { activeOrganization, organizations, switchOrganization } = useValidatedOrganization();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          {/* Avatar org + nombre + chevron */}
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-56 rounded-lg p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder="Search organizations..." />
          <CommandList>
            <CommandEmpty>No organization found.</CommandEmpty>
            <CommandGroup heading="Organizations">
              {organizations.map((org) => (
                <CommandItem
                  key={org.id}
                  value={org.id}
                  keywords={[org.name]}
                  onSelect={() => switchOrganization(org.id)}
                >
                  {/* avatar + nombre + check si es activo */}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t p-1">
          <button onClick={() => { setPopoverOpen(false); setTimeout(() => setDialogOpen(true), 0); }}>
            <Plus className="size-4" /> Add organization
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

**Patrones a robar (aunque no usemos multi-org):**
- `Command` con `shouldFilter` y `keywords={[org.name]}` para búsqueda fuzzy interna.
- `setPopoverOpen(false); setTimeout(() => setDialogOpen(true), 0)` — cerrar popover **antes** de abrir dialog (evita conflicto de focus traps de Radix).
- `w-[--radix-popover-trigger-width]` — el popover hereda el ancho del trigger.

**Para JouveERP:** este componente lo **no necesitamos**. En el header del sidebar va directo el logo "JouveERP" o un summary del estado fiscal.

### 7.7 NavUser — dropdown user con logout ✅

`components/layout/sidebar/NavUser.tsx`:
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
      <UserAvatar userId={user.id} firstName={...} lastName={...} profilePictureUrl={...} avatarColor={...} size="md" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{fullName}</span>
        <span className="truncate text-xs">{email}</span>
      </div>
      <ChevronsUpDown className="ml-auto size-4" />
    </SidebarMenuButton>
  </DropdownMenuTrigger>
  <DropdownMenuContent
    className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
    side={isMobile ? "bottom" : "right"}
    align="end"
  >
    <DropdownMenuLabel>{/* avatar + name + email otra vez */}</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={() => router.push("/settings/profile")}>
      <UserPen className="size-4" /> Profile
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={handleSignOut}>
      <LogOut className="size-4" /> Log out
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

`side={isMobile ? "bottom" : "right"}` — el dropdown sale a la derecha en desktop (saliendo del sidebar), abajo en mobile.

### 7.8 AppSidebarHeader con breadcrumbs ✅

`components/layout/sidebar/AppSidebarHeader.tsx`:
```tsx
interface Breadcrumb {
  label: string;
  href?: string;
  hideOnMobile?: boolean;
  active?: boolean;
}

export function AppSidebarHeader({ breadcrumbs = [] }: { breadcrumbs?: Breadcrumb[] }) {
  return (
    <header className="flex shrink-0 items-center gap-2">
      <div className="flex items-center justify-between w-full px-8 py-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <BreadcrumbSeparator className={crumb.hideOnMobile ? "hidden md:block" : ""} />}
                  <BreadcrumbItem className={crumb.hideOnMobile ? "hidden md:block" : ""}>
                    {crumb.href ? (
                      <BreadcrumbLink href={crumb.href} className="text-xs">{crumb.label}</BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className={`text-xs ${crumb.active ? "text-foreground" : ""}`}>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-3">
          {/* Outage badge condicional */}
          {/* Logo del producto */}
        </div>
      </div>
    </header>
  );
}
```

**Patrón:** cada `page.tsx` arma sus breadcrumbs y los pasa al header. El header **no descubre** breadcrumbs leyendo la URL (sería frágil); cada página declara los suyos.

```tsx
// app/(main)/close-management/[id]/page.tsx
const breadcrumbs = [
  { label: "Close Management", href: "/close-management", hideOnMobile: true },
  { label: closePeriod.name, active: true },
];
return (
  <>
    <AppSidebarHeader breadcrumbs={breadcrumbs} />
    {/* contenido */}
  </>
);
```

`hideOnMobile` esconde los crumbs intermedios en pantalla chica para que solo se vea el actual.

---

## 8. Supabase clients (browser, server, proxy)

### 8.1 Tres clients ✅

`lib/supabase/client.ts` (browser):
```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`lib/supabase/server.ts` (server components / server actions):
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The setAll method was called from a Server Component.
            // This can be ignored if you have proxy refreshing user sessions.
          }
        },
      },
    },
  );
}
```

> En Next 16 `cookies()` es **async**. La app de referencia lo refleja con `await cookies()`. El catch silencia el caso "estamos en un Server Component que no puede setear cookies" — el proxy refresca antes.

`lib/supabase/proxy.ts` — la usa el `proxy.ts` (middleware) para refrescar la sesión en cada request:
```ts
export async function updateSession(request: NextRequest, extraRequestHeaders?: Headers) {
  let supabaseResponse = NextResponse.next({ request: { headers: buildRequestHeaders() } });

  const supabase = createServerClient(/* ... */, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request: { headers: buildRequestHeaders() } });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: DO NOT REMOVE auth.getUser() — esto refresca el JWT
  const { data: { user } } = await supabase.auth.getUser();

  // ... auth redirect logic ...

  return supabaseResponse;
}
```

**El call a `auth.getUser()` es lo que dispara el refresh del JWT cuando hay refresh_token cerca de expirar.** Sin esto, el user se desloguea solo aunque tenga refresh_token válido. Comentario inline lo destaca.

---

## 9. Auth flow + active organization (NO copiar literal — JouveERP es single)

### 9.1 active_organization_id en user_metadata

```ts
// switching:
await supabase.auth.updateUser({
  data: { active_organization_id: newOrgId },
});
window.location.reload();
```

El JWT de Supabase carga el `user_metadata` en cada token. Cambiar `active_organization_id` y recargar fuerza un nuevo JWT con el contexto actualizado.

### 9.2 validateAndCorrectActiveOrganization (auto-correction) ❌ no aplica directo

`lib/utils/organization-utils.ts` — en cada page load valida que el `active_organization_id` siga siendo válido:
- Si el user fue removido de esa org → cambia al primera disponible.
- Si el user ya no tiene ninguna org → setea null y muestra `NoOrganizationAccess`.
- Si nunca tuvo activa → setea la primera de su lista.

**Para JouveERP:** no hay multi-tenancy, pero el **patrón general** ("validar contexto en cada page load y auto-corregir") sirve para cosas como "el user fue desactivado mientras estaba logueado" — `withAuth` ya cubre esto chequeando sesión. No hace falta replicar.

### 9.3 useValidatedOrganization hook ❌ no aplica directo

```tsx
const {
  activeOrganization, organizations,
  loading, error, wasAutoSwitched,
  switchOrganization, refreshOrganizations,
} = useValidatedOrganization();
```

Encapsula la lógica de validación + switching para que cualquier componente la use. **Para JouveERP** un equivalente sería `useCurrentUser()` que solo expone `{ user, roles }` desde `getCurrentUserContext()`.

### 9.4 shouldSkipAuthRedirect ✅

`lib/auth/public-pages.ts`:
```ts
export const DONT_AUTH_REDIRECT_PREFIXES = [
  "/auth", "/signin", "/report-builder/shared", "/report-gen", "/api/pdf",
] as const;

export function shouldSkipAuthRedirect(pathname: string): boolean {
  return DONT_AUTH_REDIRECT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
```

Usado en el proxy para no redirigir al login en rutas públicas. **Importante:** comentario inline aclara que esto es solo para redirección, **NO para data access** (eso lo hace RLS).

---

## 10. Server actions

### 10.1 Patrón base ✅

```tsx
"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrganization } from "@/lib/utils/server-organization-utils";

export async function getAccountsWithCategorization() {
  try {
    const supabase = await createClient();
    const orgId = await getCurrentUserOrganization();

    const { data, error } = await supabase
      .from("chart_of_accounts")
      .select("id, account_number, account_name, account_type, account_categorization")
      .eq("organization_id", orgId)
      .order("account_number", { ascending: true });

    if (error) throw new Error(`Failed to fetch accounts: ${error.message}`);
    return (data || []).map(/* normalize */);
  } catch (error) {
    console.error("Error fetching accounts:", error);
    throw error;
  }
}
```

**Convenciones:**
- Una primera línea: `"use server"`.
- Siempre un `getCurrentUserOrganization()` (o equivalente) que lanza si no hay sesión válida.
- `try/catch` con `console.error` + re-throw — Next captura el error y la UI lo recibe en el `useMutation.onError` o como Server Action error.
- Especificar columnas en `.select(...)` — nunca `select *`.

**Para JouveERP:** mismo patrón pero el helper se llama `getCurrentUserContext()` y devuelve `{ userId, roles }` (sin `organizationId`).

### 10.2 Result-type pattern (cuando hace falta error rico) ✅

```ts
interface LookupSuccess {
  success: true;
  data: CompanyLookupResult;
}
interface LookupError {
  success: false;
  error: string;
}
type LookupResponse = LookupSuccess | LookupError;

export async function lookupCompanyAction(...): Promise<LookupResponse> {
  if (!registrationNumber.trim()) {
    return { success: false, error: "Registration number is required" };
  }
  try {
    const data = await lookupCompany(...);
    return { success: true, data };
  } catch {
    return { success: false, error: "Company not found" };
  }
}
```

Usado cuando el error es **esperado** (validation, lookup miss) y la UI debe diferenciarlo de un error real. Para errores inesperados, se hace throw normal.

### 10.3 RPC calls ✅

```ts
const { data, error } = await supabase.rpc(
  "create_organization_for_new_user",
  { org_name: data.orgName, business_num: data.orgNum, ... },
);
```

Para **lógica que necesita transacciones de DB o multi-table inserts atómicos**, hacen una RPC SQL function en lugar de varios calls desde el server action. Ventaja: atómico + RLS aplicada por el `SECURITY DEFINER` o el rol del caller.

---

## 11. Forms — react-hook-form + zod

### 11.1 Setup completo ✅

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const InviteFormSchema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  email: z.email({ error: "Please enter a valid email address" }),
  role: z.enum(["admin", "member"]),
});

export function TeamForm() {
  const form = useForm<z.infer<typeof InviteFormSchema>>({
    resolver: zodResolver(InviteFormSchema),
    defaultValues: { firstName: "", lastName: "", email: "", role: "member" },
  });

  const onSubmit = async (formData: z.infer<typeof InviteFormSchema>) => {
    const result = await inviteTeamMember(formData);
    if (result.success) {
      toast.success("Invitation sent");
      form.reset();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First name</FormLabel>
              <FormControl>
                <Input placeholder="First name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* ... */}
        <Button
          type="submit"
          disabled={!canInvite || isInviting || !form.formState.isValid}
        >
          {isInviting ? <><Loader2 className="animate-spin" /> Sending...</> : <><Send /> Send invite</>}
        </Button>
      </form>
    </Form>
  );
}
```

**Patrón clave:**
- `<Form {...form}>` — re-export de `FormProvider` de react-hook-form. Provee el context para los `FormField` hijos.
- `<FormField name="..." render={({ field }) => (...)}/>` — encapsula `<Controller>` y conecta el shadcn Form context.
- `<FormItem>` genera un id único (`React.useId`) que `<FormLabel htmlFor>` y `<FormControl id>` consumen — accesibilidad correcta.
- `<FormMessage>` muestra el error de zod en el slot del field — se conecta automáticamente vía context.
- `form.reset()` después del submit exitoso.
- `disabled={!form.formState.isValid}` para deshabilitar submit hasta que sea válido.

### 11.2 Form primitivo (shadcn) ✅

`components/ui/form.tsx` es ~150 LOC que orquestan:
```tsx
const Form = FormProvider;
const FormFieldContext = React.createContext<FormFieldContextValue>({} as any);
const FormItemContext = React.createContext<FormItemContextValue>({} as any);

const FormField = <TFieldValues, TName>({ ...props }: ControllerProps<TFieldValues, TName>) => (
  <FormFieldContext.Provider value={{ name: props.name }}>
    <Controller {...props} />
  </FormFieldContext.Provider>
);

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;
  return { id, name: fieldContext.name, formItemId: `${id}-form-item`, formDescriptionId: ..., formMessageId: ..., ...fieldState };
};

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn("grid gap-2", className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }) {
  const { error, formItemId } = useFormField();
  return <Label data-error={!!error} className={cn("data-[error=true]:text-destructive", className)} htmlFor={formItemId} {...props} />;
}
```

**Cada `FormItem` genera un id**. `FormLabel` y `FormControl` lo consumen para vincular `htmlFor` y `aria-describedby`. Es **accesibilidad gratis**.

---

## 12. Tablas

### 12.1 Primitivo shadcn ✅

`components/ui/table.tsx`:
```tsx
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn("w-full caption-bottom text-sm border-separate border-spacing-0", className)} {...props} />
    </div>
  );
}

function TableRow({ className, ...props }) {
  return <tr className={cn("hover:bg-muted/50 data-[state=selected]:bg-muted transition-colors [&_td]:border-b", className)} {...props} />;
}

function TableHead({ className, ...props }) {
  return <th className={cn("text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)} {...props} />;
}

function TableCell({ className, ...props }) {
  return <td className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)} {...props} />;
}
```

**Detalles:**
- `border-separate border-spacing-0` en `<table>` para que `border-b` en `<td>` funcione (con `border-collapse` los borders se mergan raro).
- `hover:bg-muted/50` y `data-[state=selected]:bg-muted` — selection state via Radix attribute.
- `whitespace-nowrap` por default en celdas — el `overflow-x-auto` del container maneja el scroll horizontal.
- `[&:has([role=checkbox])]:pr-0` — si la celda contiene un checkbox, sin padding right (mejor alineación visual).

### 12.2 Tablas grandes ✅ (Fase D+ cuando movements crezcan)

La app de referencia tiene **TanStack React Table + TanStack React Virtual** como deps. Para JouveERP:

```bash
pnpm add @tanstack/react-table @tanstack/react-virtual
```

Patrón típico (ver `frontend/src/features/reporting/components/financial-table/*` — son ~20 archivos con ejemplos):
- `useReactTable({ data, columns, getCoreRowModel, getSortedRowModel, getFilteredRowModel, state: { sorting, columnFilters }, ... })`.
- `useVirtualizer({ count, getScrollElement, estimateSize, overscan: 10 })`.
- Render con `virtualizer.getVirtualItems().map(...)` — solo se renderan las filas visibles.

**Cuándo usarlo en JouveERP:**
- Movimientos > 500: TanStack Table.
- Movimientos > 5000: agregar TanStack Virtual.
- Antes de eso, el primitivo de shadcn alcanza.

### 12.3 Realtime updates en tablas ✅

```tsx
useEffect(() => {
  const channel = supabase
    .channel("organization_members_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "organization_members" },
      () => {
        console.log("[Team] Organization members changed, refreshing data");
        fetchTeamMembers();
      },
    )
    .subscribe();
  fetchTeamMembers();
  return () => supabase.removeChannel(channel);
}, [fetchTeamMembers, supabase]);
```

**Patrón pragmático:** subscribe a `postgres_changes`, en cada evento simplemente **refetch** todo. No intenta hacer optimistic updates ni merging — la tabla se vuelve a pedir entera. Más simple, menos bugs.

**Para JouveERP:** mismo patrón en transactions, accounts, invoices.

---

## 13. Dialogs, sheets, alert-dialog, command palette

### 13.1 Patrón state-driven (no URL-driven) ✅

```tsx
const [dialogOpen, setDialogOpen] = useState(false);

<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
  <DialogContent>{/* form */}</DialogContent>
</Dialog>
```

La app de referencia **no usa** modales por URL (`?modal=foo`). Razón: los modales son ephemeral, refresh cierra. Más simple.

**Excepción:** modales que necesitan deep-linking (compartir URL al colega) — ver `useDeepNavigation` en §15.5.

### 13.2 AlertDialog para destructivos ✅

`components/ui/alert-dialog.tsx` (extiende `@radix-ui/react-alert-dialog`):

Diferencia con Dialog: **no se puede cerrar con click afuera ni Escape por default**. Forzás al user a elegir Cancel o Confirm.

Uso típico:
```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="ghost"><Trash2 /></Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete invitation?</AlertDialogTitle>
      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => handleDelete(id)} className="bg-destructive">Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### 13.3 useConfirm hook (genérico) ✅

`hooks/use-confirm.tsx` — la versión imperativa de AlertDialog:

```tsx
export function useConfirm() {
  const [state, setState] = useState({ open: false, description: "", resolve: null });

  const confirm = useCallback((options): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ open: true, ...options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  }, [state]);

  const ConfirmDialog = useCallback(() => (
    <AlertDialog open={state.open} onOpenChange={(open) => !open && handleCancel()}>
      <AlertDialogContent>{/* render with state.description, state.title, etc. */}</AlertDialogContent>
    </AlertDialog>
  ), [state, handleConfirm, handleCancel]);

  return { confirm, ConfirmDialog };
}
```

Uso:
```tsx
const { confirm, ConfirmDialog } = useConfirm();

const handleDelete = async () => {
  const ok = await confirm({
    title: "Delete account?",
    description: "All transactions will be unlinked. This cannot be undone.",
    destructive: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  await deleteAccount(id);
};

return (
  <>
    <Button onClick={handleDelete}>Delete</Button>
    <ConfirmDialog />   {/* hay que renderizarlo en algún lado del árbol */}
  </>
);
```

**Patrón de promise resolution** evita el ping-pong de `setOpen(true)` + escuchar callbacks. **Lo robamos para JouveERP.**

### 13.4 Sheet (drawer lateral) ✅

`components/ui/sheet.tsx` — alias de Dialog con animación slide en lugar de fade. Para paneles laterales (notification sidebar, edit drawer).

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent side="right" className="w-[400px]">
    <SheetHeader>
      <SheetTitle>Edit transaction</SheetTitle>
    </SheetHeader>
    {/* form */}
  </SheetContent>
</Sheet>
```

`side="right" | "left" | "top" | "bottom"`.

### 13.5 Command palette (Cmd+K) ✅ (Fase J)

```tsx
import { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Type a command or search..." />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      <CommandItem onSelect={() => router.push("/transactions/new")}>
        <Plus /> Nuevo movimiento
      </CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>
```

Atajo Cmd+K (registrarlo en un hook con `useEffect`):
```tsx
useEffect(() => {
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((o) => !o);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

---

## 14. Loading / Empty / Error / Skeleton

### 14.1 loading.tsx genérico ✅

`app/(main)/loading.tsx`:
```tsx
import { AppSidebarHeader } from "@/components/layout/sidebar/AppSidebarHeader";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const breadcrumbs = [
    { label: "App", href: undefined, hideOnMobile: true },
    { label: "Loading...", active: true },
  ];

  return (
    <>
      <AppSidebarHeader breadcrumbs={breadcrumbs} />
      <div className="flex flex-1">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="space-y-6">
            <Skeleton className="h-8 w-[200px]" />
            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[90%]" />
              <Skeleton className="h-4 w-[80%]" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-[120px] rounded-xl" />
              <Skeleton className="h-[120px] rounded-xl" />
              <Skeleton className="h-[120px] rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

Genérico — sirve para cualquier ruta que no tenga su propio `loading.tsx`. Mantiene el header con breadcrumbs "Loading..." para que el shell no flickee.

### 14.2 Skeletons feature-specific ✅

`features/settings/components/SettingsDetailsSkeleton.tsx`:
```tsx
export function SettingsDetailsSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div className="grid gap-6">
      <Card className="max-w-3xl gap-0">
        <CardHeader className="border-b">
          {children ? (
            <><div className="h-5 w-40" /><div className="h-4 w-56" /></>
          ) : (
            <><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-56" /></>
          )}
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-16 rounded-md" />
            </div>
            {/* ... */}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

Patrón: **el skeleton imita la forma del contenido real**. Mismo card, mismo layout, mismas dimensiones aproximadas — solo los textos reemplazados por `<Skeleton>` blocks.

### 14.3 Empty state ✅

`components/ui/empty.tsx` (shadcn-extended):
```tsx
function Empty({ className, ...props }) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12", className)} {...props} />
  );
}

const emptyMediaVariants = cva("flex shrink-0 items-center justify-center mb-2", {
  variants: {
    variant: {
      default: "bg-transparent",
      icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg",
    },
  },
});
```

Uso:
```tsx
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
    <EmptyTitle>No transactions yet</EmptyTitle>
    <EmptyDescription>Create your first transaction to get started.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button asChild><Link href="/transactions/new">New transaction</Link></Button>
  </EmptyContent>
</Empty>
```

`text-balance` evita line breaks feos. `border-dashed` sutil + `rounded-lg` da el "container vacío" look sin gritar.

### 14.4 NoOrganizationAccess (gate) ❌ adaptarlo a JouveERP como NoAccess genérico

`components/shared/NoOrganizationAccess.tsx` — para users que están loggeados pero sin acceso (en la app de referencia: en grupo pero no en ninguna org). Usa `Card` central con icon + copy + CTAs.

```tsx
<div className="flex min-h-[calc(100vh-200px)] items-center justify-center p-6">
  <Card className="w-full max-w-md text-center">
    <CardHeader>
      <div className="flex justify-center mb-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <CardTitle>No Organization Access</CardTitle>
      <CardDescription>...</CardDescription>
    </CardHeader>
    <CardContent>{/* explanation */}</CardContent>
    <CardFooter>
      <Button>Contact admin</Button>
    </CardFooter>
  </Card>
</div>
```

**Para JouveERP:** equivalente "Tu user fue desactivado" o "No tenés permiso para ver esto" reusable.

### 14.5 ProtectedContent wrapper ✅

`components/shared/ProtectedContent.tsx`:
```tsx
export function ProtectedContent({ children }) {
  const { shouldDisableNav, isGroupOnly, hasNoAccess, loading, ... } = useAccessState();

  if (loading) return null;   // o skeleton

  if (hasNoAccess) return <NoOrganizationAccess />;
  if (isGroupOnly && !pathStartsWithGroupAllowed) return <GroupOnlyEmptyState />;

  return <>{children}</>;
}
```

**Patrón:** un wrapper en el layout que decide si mostrar contenido o un empty state. **Para JouveERP:** equivalente a `withAuth` en el server pero del lado client — chequea que el user tenga al menos un rol válido.

---

## 15. Hooks reutilizables

### 15.1 useIsMobile ✅

```tsx
const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
```

Usa `matchMedia` (cambia con resize Y rotation) + `window.innerWidth` para el initial value. **`!!isMobile`** retorna boolean (no `undefined`) para evitar que el caller necesite handling especial pre-mount.

### 15.2 useGroupOnlyState ❌ no aplica

Pattern: hook que combina varios queries para devolver un estado derivado complejo. **Para JouveERP** un equivalente sería `useUserAccessState` que retorna `{ hasAnyRole, canManage, ... }`.

### 15.3 useDeepNavigation ✅

`components/shared/useDeepNavigation.ts` — Zustand store + URL params para "abrir el panel X cuando llegues a tal ruta":

```ts
import { create } from "zustand";

class OpenCloseTaskMentionDeepNavigationIntent {
  action = "open-close-task-mention" as const;
  href = "/close-management" as const;
  constructor(public taskId: string, public commentId: string) {}
}

type DeepNavigationIntent = OpenCloseTaskMentionDeepNavigationIntent | OpenCloseTaskDeepNavigationIntent | ...;

const DEEP_NAVIGATION_STORAGE_KEY = "deep-navigation:intent";
const DEEP_NAVIGATION_PARAM_NAMES = [...];
```

**Patrón:** un click en una notificación pone una "intent" en sessionStorage + URL params. Cuando el componente target se monta, lee la intent, abre el dialog/panel correspondiente y limpia la intent.

**Para JouveERP** sirve para casos como "click en email de factura vencida → abre dialog de cobranza con ese cliente preseleccionado".

### 15.4 useValidatedOrganization ❌

(Ya cubierto en §9.3 — no aplica directo, pero la **forma del hook** sirve de modelo para `useCurrentUser()`.)

---

## 16. Toasts (sonner)

### 16.1 Patrón de invocación ✅

```tsx
import { toast } from "sonner";

toast("Invitation sent successfully", {
  description: (
    <div className="flex items-center">
      <CircleCheck className="mr-2 h-4 w-4 text-[#008C6D]" />
      <span>An invitation has been sent to the email address</span>
    </div>
  ),
});

toast("Failed to update role", {
  description: (
    <div className="flex items-center">
      <TriangleAlert className="mr-2 h-4 w-4 text-yellow-600" />
      <span>An error occurred while updating the team member role</span>
    </div>
  ),
});
```

**Para JouveERP:** sin colores, así que los icons van con `text-foreground` o `text-muted-foreground`. El icono igual comunica el tipo (CheckCircle = ok, TriangleAlert = warn, etc.).

### 16.2 PostHog tracking junto al toast ✅

```tsx
posthog.capture("team_invite_sent", { role: formData.role });
toast("Invitation sent successfully", { /* ... */ });
```

Patrón: cada acción significativa del user → capture + toast. **El toast es feedback al user, el capture es producto data.**

---

## 17. Logging y observability

### 17.1 Frontend logger (cliente) — no-op + OTLP en server side ✅

`lib/logger.ts`:
```ts
type LogAttributes = Record<string, string | number | boolean | undefined>;

const SERVER_LOG_SEVERITY = { info: 9, warn: 13, error: 17 } as const;

function emit(severityNumber: number, body: string, attributes?: LogAttributes) {
  if (process.env.NODE_ENV !== "production") return;

  void import("@/lib/otel-logger").then(({ emitOtelLog }) => {
    emitOtelLog(severityNumber, body, attributes);
  }).catch((error) => {
    console.error("Failed to emit server log", error);
  });
}

export const serverLog = {
  info(body, attrs) { emit(SERVER_LOG_SEVERITY.info, body, attrs); },
  warn(body, attrs) { emit(SERVER_LOG_SEVERITY.warn, body, attrs); },
  error(body, attrs) { emit(SERVER_LOG_SEVERITY.error, body, attrs); },
};
```

**Solo en prod**, dynamic import del exporter para que el bundle de client no lo cargue. Severity numbers vienen de `@opentelemetry/api-logs`.

### 17.2 OTel exporter → PostHog logs ✅

`lib/otel-logger.ts`:
```ts
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({ "service.name": "reference-frontend" }),
  processors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: "https://eu.i.posthog.com/i/v1/logs",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_POSTHOG_KEY}`,
          "Content-Type": "application/json",
        },
      }),
    ),
  ],
});

const logger = loggerProvider.getLogger("reference-frontend");

export function registerOtelLogger() { logs.setGlobalLoggerProvider(loggerProvider); }
export function emitOtelLog(severityNumber, body, attributes) {
  logger.emit({ body, severityNumber, attributes });
}
```

PostHog tiene endpoint OTLP-compat. **Lo bueno:** los logs aparecen en el mismo dashboard que los events de producto. **Lo malo:** atado a PostHog (si cambiamos provider, hay que reescribir).

### 17.3 instrumentation.ts (Next 16) ✅

```ts
export async function register() {
  if (process.env.NEXT_PUBLIC_POSTHOG_DEBUG !== "true") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerOtelLogger } = await import("@/lib/otel-logger");
  registerOtelLogger();
}
```

`instrumentation.ts` se ejecuta una vez al boot del runtime (Node solamente, no edge). **Solo activa OTel si `POSTHOG_DEBUG=true`** — opt-in. Para JouveERP arrancamos sin OTel y lo encendemos solo si necesitamos.

### 17.4 PostHog client init ✅

`instrumentation-client.ts`:
```ts
import posthog from "posthog-js";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: "/ingest",                  // reverse proxy via next.config rewrites
  ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  defaults: "2025-11-30",
  person_profiles: "identified_only",   // solo crea persona profile cuando identificás
  capture_pageview: false,              // capture manual via PostHogPageView
  capture_performance: false,           // WebVitals component lo hace
  capture_exceptions: true,
});
```

### 17.5 PostHog reverse proxy ✅

`next.config.ts`:
```ts
async rewrites() {
  return [
    { source: "/ingest/report/", destination: "https://eu.i.posthog.com/report/" },
    { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
    { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
  ];
},
skipTrailingSlashRedirect: true,   // PostHog usa trailing slash en ciertas rutas
```

**Por qué reverse proxy:**
- Esquiva ad-blockers (que bloquean `*.posthog.com` por nombre).
- Same-origin → no CORS preflight.
- Sourcemaps suben al backend de PostHog vía `withPostHogConfig`.

### 17.6 PostHogIdentify provider ✅

```tsx
// components/providers/PostHogIdentify.tsx
useEffect(() => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.id !== identifiedUserRef.current) {
    posthog.identify(user.id, {
      email: user.email,
      first_name: user.user_metadata?.first_name,
      last_name: user.user_metadata?.last_name,
      created_at: user.created_at,
    });
  }
}, []);

// Org / group context
posthog.group("organization", activeOrganization.id, { name: activeOrganization.name });
posthog.group("accounting_firm", groupId, { name: groupName });
posthog.people.set({ active_organization_id, user_role, total_organizations });
posthog.register({ user_id, organization_id, organization_name, ... });   // super properties
```

`posthog.register` setea **super properties** que se incluyen en cada event. Sobreviven a refresh. **Para JouveERP:** registramos `user_id` + `roles` como super props.

### 17.7 WebVitals via Next.js native ✅

`components/providers/WebVitals.tsx`:
```tsx
"use client";
import { useReportWebVitals } from "next/web-vitals";
import posthog from "posthog-js";

export function WebVitals() {
  useReportWebVitals((metric) => {
    posthog.capture(metric.name, metric);
  });
  return null;
}
```

Next 16 expone `useReportWebVitals`. La app de referencia lo prefiere a la captura interna de PostHog porque "el dynamic import de PostHog no funciona con Turbopack".

### 17.8 Backend: Winston + nestjs-cls ✅ (cuando haya backend Nest)

`api/src/common/services/structured-logger.service.ts`:
```ts
const structuredFormat = format((info) => {
  const { level, timestamp, service, ...rest } = info;
  // ... cleanup, sort alphabetical, etc.
  const ordered = { timestamp, service, message, level, ...sortedRest };
  Object.assign(info, ordered);
  return info;
});

const developmentFormat = format.printf((info) => {
  const coloredTimestamp = chalk.gray(String(timestamp));
  const coloredService = chalk.cyan(`[${service}]`);
  const coloredMessage = chalk.white(message);
  const mainLine = `${coloredTimestamp} ${coloredLevel} ${coloredService} ${coloredMessage}`;
  // ... pretty-print extras as dimmed JSON
});
```

**Lo más interesante:** `nestjs-cls` (continuation-local-storage) propaga `userId` y `organizationId` por toda la request automáticamente. El logger los inyecta en cada log line sin que el caller los pase.

```ts
// guard
this.cls.set("userId", authContext.user.id);
this.cls.set("organizationId", authContext.organization.id);

// cualquier service después:
this.logger.log("Processing invoice", { invoiceId });
// → output: { timestamp, service, level, message: "Processing invoice", userId: "...", organizationId: "...", invoiceId: "..." }
```

**Para JouveERP:** si llegamos a tener Nest, copiamos esto literal.

---

## 18. Security

### 18.1 next.config.ts security headers ✅

```ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },                           // XSS via MIME confusion
  { key: "X-Frame-Options", value: "SAMEORIGIN" },                               // clickjacking
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "interest-cohort=()" },                    // opt-out de FLoC
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

async headers() {
  return [{ source: "/(.*)", headers: securityHeaders }];
}
```

### 18.2 CSP estricto con nonce + shadow rollout ✅

`lib/security/csp.ts` exporta dos builders:
- `buildContentSecurityPolicy(nonce)` — strict, nonce-based, `'strict-dynamic'`. Se emite como `Content-Security-Policy-Report-Only`.
- `buildLooseContentSecurityPolicy()` — permisivo pero estructurado. Se emite como `Content-Security-Policy` (enforced).

**Shadow rollout:** ambos headers van en cada response. El strict observa violations vía `/ingest/report/` (PostHog ingesta como `$csp_violation` events). Cuando los reports están limpios por X días, se cambia el strict a enforce.

```ts
// Comentarios inline:
// "The strict policy uses 'strict-dynamic' so trusted (nonce-tagged) scripts
// can dynamically load further scripts (e.g., Intercom widget bootstrap)
// without us having to enumerate every third-party CDN host in script-src."

// "Inline styles fall back to 'unsafe-inline': Tailwind / next/font emit
// <style> tags that aren't reliably nonce-tagged by Next.js, and mixing
// nonces with 'unsafe-inline' on style-src would invalidate the latter
// in modern browsers."
```

`proxy.ts` (root) genera nonce per-request:
```ts
const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
extraRequestHeaders.set("x-nonce", nonce);
extraRequestHeaders.set("content-security-policy", strictCsp);

const response = await updateSession(request, extraRequestHeaders);
response.headers.set("Content-Security-Policy", LOOSE_CONTENT_SECURITY_POLICY);
if (!isDev) {
  response.headers.set("Content-Security-Policy-Report-Only", strictCsp);
}
```

Y `app/layout.tsx` forwardea el nonce a next-themes:
```tsx
const nonce = (await headers()).get("x-nonce") ?? undefined;
<ThemeProvider nonce={nonce}>  {/* permite que el inline script pre-hidratación pase CSP */}
```

**Para JouveERP:** lo implementamos en Fase A.5 (proxy.ts) directamente con strict-only, no shadow rollout. Somos un app chico y nuevo, no hay assets externos legacy.

### 18.3 Validación de extra sources de CSP ✅

```ts
function parseExtraSources(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 0)
    .filter((s) => /^(https:\/\/|wss:\/\/)[^\s'";]+$/.test(s));
}
```

**Por qué:** un env var como `CSP_EXTRA_SOURCES="https://foo.com 'unsafe-inline'"` podría inyectar keywords arbitrarios. La regex bloquea `'unsafe-eval'`, `'self'`, `*`, `;`, etc. Solo acepta `https://` o `wss://` origins.

---

## 19. Migrations + RLS

### 19.1 Naming + headers ✅

```
20260218170000_add_suppliers_table.sql
20260218180319_add_supplier_reconciliation.sql
20260218191142_add_suppliers_rls_policies.sql
```

Timestamp `YYYYMMDDHHMMSS`. CLI de Supabase genera el formato.

Header estándar:
```sql
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET row_security = off;   -- temporal durante la migration

-- ... DDL ...

ALTER TABLE "public"."<table>" ENABLE ROW LEVEL SECURITY;
CREATE POLICY ... ON "<table>" ...;
```

> **Detalle:** `SET row_security = off` permite a la migration setear data con seed sin que las RLS policies bloqueen el INSERT inicial. Al final del archivo se habilita RLS.

### 19.2 RLS policies — naming en inglés con verbo ✅

```sql
CREATE POLICY "Users can view suppliers from their organizations"
  ON "public"."suppliers" FOR SELECT
  USING (("organization_id" IN (
    SELECT "organization_members"."organization_id"
    FROM "public"."organization_members"
    WHERE ("organization_members"."user_id" = "auth"."uid"())
  )));

CREATE POLICY "Users can insert suppliers for their organizations"
  ON "public"."suppliers" FOR INSERT
  WITH CHECK (...);
```

**Convenciones:**
- Nombre human-readable: `"<Subject> can <verb> <entity> [<condition>]"`.
- Siempre `TO authenticated` (nunca `TO public`).
- USING vs WITH CHECK: USING para filtrar lo que el user **ve**; WITH CHECK para validar lo que **escribe**.

**Para JouveERP:** mismo patrón pero el subquery va contra `user_roles` + `user_has_role()` helper. Ver §B.1 del roadmap.

### 19.3 Generated types pipeline ✅

`scripts/generate-supabase-types.sh`:
```bash
#!/bin/bash
set -e
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTFILE="$ROOT_DIR/packages/shared/src/db/generated/database.types.ts"

mkdir -p "$(dirname "$OUTFILE")"

(
  cd "$ROOT_DIR"
  if ! pnpm dlx supabase status >/dev/null 2>&1; then
    pnpm dlx supabase start
  fi

  pnpm dlx supabase gen types typescript --local --schema public,pgmq_public,embedding_store \
    | node "$ROOT_DIR/scripts/strip-partition-types.mjs" > "$OUTFILE"
)

pnpm exec prettier --write "$OUTFILE"
```

`strip-partition-types.mjs`:
```js
import { readFileSync } from "fs";

const PARTITION_TABLE_RE =
  /^      (?:booked_entries_p\d+|booked_entries_dimensions_p\d+|embeddings_[0-9a-f-]{32,}): \{.*?\n      \}\n/gms;

const input = readFileSync("/dev/stdin", "utf8");
process.stdout.write(input.replace(PARTITION_TABLE_RE, ""));
```

**Para qué:** las tablas particionadas (hash-by-org, embeddings UUID) generan tipos duplicados que bloatean el output. El script los strippea — el tipo del parent table queda.

**Para JouveERP:** no vamos a particionar tablas en Fase A-D, así que el strip script no aplica todavía.

### 19.4 Convenciones de schema ✅

- Tablas: `snake_case` (`booked_entries`, `organization_members`).
- Columnas: `snake_case`. Org scope = **`organization_id`** (nunca `org_id`, `tenant_id`).
- Functions: `snake_case` con doble underscore para scoped (`anom_detection__claim_anomaly_jobs`, `auth_user_group_ids`).
- Indexes: `idx_table_column` o autogenerados.
- FKs: `ON DELETE CASCADE` donde tiene sentido (member ↔ org), `ON DELETE SET NULL` cuando hay ambigüedad (booked_entry ↔ supplier — borrar supplier no debería borrar entries).
- `unique (organization_id, voucher_number, voucher_year)` — composite uniques con scope explícito.

---

## 20. Tests

### 20.1 Vitest config (la app de referencia usa Jest legacy; nosotros vamos directo a Vitest) ✅

La app de referencia usa Jest aún. Para JouveERP **Vitest** (más rápido en Next 16). Config equivalente:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

### 20.2 Playwright e2e setup ✅

`frontend/playwright.config.ts`:
```ts
export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/playwright/.auth/user.json" },
      testIgnore: /.*\.unauth\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      name: "chromium-no-auth",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /.*\.unauth\.spec\.ts/,
    },
  ],

  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

**Patterns:**
- `setup` project corre antes y guarda storage state autenticado en `e2e/playwright/.auth/user.json`.
- Dos projects: `chromium` usa el storage (autenticado), `chromium-no-auth` no (para tests de redirect a login, etc.).
- `webServer.reuseExistingServer: !process.env.CI` — local reusa el dev server que ya tenés corriendo; CI levanta uno nuevo.

### 20.3 RLS pentest tests ✅ (gold standard)

`api/src/security/__tests__/vouchers-rls.spec.ts`:

```ts
import { Client } from "pg";

const DB_CONFIG = { host: "127.0.0.1", port: 54322, user: "postgres", password: "postgres", database: "postgres" };
const TEST_USER_ID = "2393ee3f-2eb9-4b62-a72d-08389ecb7a2b";   // de seeds
const TEST_ORG_ID = "0771ea74-ded5-4b15-9258-16d6dd3e53bd";

describe("Vouchers RLS", () => {
  let client: Client;
  beforeAll(async () => { client = new Client(DB_CONFIG); await client.connect(); });
  afterAll(async () => { await client.end(); });

  it("vouchers table has RLS enabled", async () => {
    const result = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'vouchers'`);
    expect(result.rows[0]?.relrowsecurity).toBe(true);
  });

  it("has exactly 4 RLS policies (SELECT, INSERT, UPDATE, DELETE)", async () => {
    const result = await client.query(`
      SELECT polname, polcmd FROM pg_policy
      WHERE polrelid = 'public.vouchers'::regclass ORDER BY polcmd`);
    expect(result.rows.length).toBe(4);
    const cmds = result.rows.map((r) => r.polcmd).sort();
    expect(cmds).toEqual(["a", "d", "r", "w"]);   // INSERT, DELETE, SELECT, UPDATE
  });

  it("all policies use organization_id scoped to auth.uid()", async () => {
    const result = await client.query(`
      SELECT polname,
             coalesce(pg_get_expr(polqual, polrelid), '') || ' ' ||
             coalesce(pg_get_expr(polwithcheck, polrelid), '') as expr
      FROM pg_policy WHERE polrelid = 'public.vouchers'::regclass`);
    for (const row of result.rows) {
      expect(row.expr).toContain("organization_members");
      expect(row.expr).toContain("auth.uid()");
    }
  });

  it("authenticated user can select vouchers from their organization", async () => {
    const authClient = new Client(DB_CONFIG);
    await authClient.connect();

    // Insert as postgres (bypasses RLS)
    await client.query(`INSERT INTO public.vouchers (organization_id, voucher_number, voucher_year) VALUES ($1, 999, 2024)`, [TEST_ORG_ID]);

    // Emulate auth.uid() para el authClient
    await authClient.query(`SET ROLE authenticated`);
    await authClient.query(`SET request.jwt.claims = '{"sub": "${TEST_USER_ID}"}'`);

    const result = await authClient.query(`SELECT id FROM public.vouchers WHERE organization_id = $1 AND voucher_number = 999`, [TEST_ORG_ID]);
    expect(result.rows.length).toBe(1);
  });

  it("authenticated user CANNOT select vouchers from another organization", async () => {
    // Same setup, different org → 0 rows
    expect(result.rows.length).toBe(0);
  });
});
```

**Lo que hace estos tests valiosos:**
- Validan **que la RLS existe** (`relrowsecurity`).
- Validan **cantidad correcta de policies** (4: una por operación).
- Validan **que el predicate referencia la auth correcta** (parsea `pg_get_expr`).
- Validan **comportamiento real** con SET ROLE authenticated + JWT claims.

**Para JouveERP:** un spec por cada tabla con datos sensibles desde Fase B. Helper compartido `pentest-helpers.ts`.

### 20.4 pentest-helpers ✅

`api/src/security/__tests__/pentest-helpers.ts`:
```ts
import { createHmac } from "crypto";

export const API_URL = "http://127.0.0.1:3001";
export const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

export function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signUserJwt(userId: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: userId, aud: "authenticated", role: "authenticated", iss: "supabase-demo",
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const signature = b64url(createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}
```

Genera JWTs válidos que el Supabase local acepta. **Lo robamos directo** para JouveERP.

---

## 21. Convenciones de código

### 21.1 "use client" / "use server" ✅

- `"use client"` solo donde se usa state, refs, browser APIs, hooks de React. Si un componente no necesita nada de eso, queda server.
- `"use server"` en archivos enteros (no funciones individuales) que exportan **solo async functions** ejecutables como server actions.

### 21.2 Tipos de props con ComponentProps ✅

```tsx
function Button({ className, variant, size, asChild = false, ...props }:
  React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }
) { ... }

export function NavSecondary({ items, ...props }: {
  items: { title: string; url: string; icon: LucideIcon; onClick?: () => void }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) { ... }
```

`React.ComponentProps<"button">` extrae los props nativos del elemento HTML. `React.ComponentProps<typeof Sidebar>` extrae los del componente Radix wrapped — útil para forwarding props transparentemente.

### 21.3 cva (class-variance-authority) para variantes ✅

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border bg-background hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3", lg: "h-10 px-6", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
```

Estándar en shadcn. **Lo usamos tal cual.**

### 21.4 data-slot attributes ✅

```tsx
<th data-slot="table-head" className={...} />
<div data-slot="form-item" className={...} />
```

Cada componente shadcn pone `data-slot="<name>"` para que css selectors externos puedan engancharse sin depender de class names. Útil para tests (`getByRole` + filtering por data-slot) y para custom CSS en globals.css.

### 21.5 Comentarios explicativos en código no-obvio ✅

La app de referencia tiene comentarios verbosos en partes oscuras. Ejemplos reales:

```tsx
// Loaded client-side only so its useQuery doesn't create a pending
// ["anomaly-counts"] cache entry during SSR. Without this,
// HydrationBoundary defers hydration of that key to useEffect (which
// never runs on the server), and useSuspenseQuery on the anomalies
// page suspends into a server-action call → "fetch waterfall" error.
const AnomaliesCountBadge = dynamic(() => import("...").then((m) => m.AnomaliesCountBadge), { ssr: false });
```

```ts
// IMPORTANT: DO NOT REMOVE auth.getUser()
// Re-derive headers from `request` on each NextResponse.next() so that
// mutations to request.cookies (made inside the Supabase setAll callback)
// are reflected in the new response.
```

**Pattern:** comentar el **por qué**, no el qué. El código ya dice qué hace; el comentario explica la razón histórica (bug que se evitó, regla de la lib que no es obvia, etc.).

---

## 22. Qué copiar a JouveERP — checklist accionable

✅ Adoptar tal cual:
1. **pnpm 10** + `packageManager` field + engines node ≥20
2. **Husky** pre-commit (lint-staged) + pre-push (regen tipos)
3. **CI workflows**: ci.yml + migration-order-check.yml
4. **Generated types committed** + auto-check en CI
5. **Estructura `features/<x>/{actions,components,hooks,lib,schemas,types}`**
6. **Path alias `@/*`** + tsconfig `strict: true`
7. **shadcn `new-york` + zinc base** + override a paleta monocroma (`oklch(L 0 0)`)
8. **Geist + Geist Mono** via `next/font/google`
9. **@theme inline** + Tailwind v4 + tw-animate-css
10. **cn() helper** sola línea
11. **Sidebar con cookie persistence + Cmd+B**
12. **NavMain pattern** (auto-open + manual override por route segments)
13. **AppSidebarHeader** con breadcrumbs declarativos por página
14. **3 supabase clients** (browser, server, proxy)
15. **proxy.ts con CSP estricto + nonce per-request**
16. **Helper `getCurrentUserContext()`** en cada server action
17. **Result-type pattern** para errores esperados
18. **Form primitive** completo (con `useId` accesibilidad)
19. **shadcn Table primitive** + TanStack Table cuando volumen lo justifica
20. **AlertDialog para destructivos**
21. **`useConfirm` hook** con promise resolution
22. **`useIsMobile` hook**
23. **loading.tsx genérico** + skeletons feature-specific
24. **Empty + EmptyHeader + EmptyMedia** patrón
25. **Sonner toaster** con CSS vars del theme
26. **PostHog reverse proxy + posthog-js** + identify pattern
27. **WebVitals via `useReportWebVitals`**
28. **next.config security headers**
29. **Naming de migrations** + `SET row_security = off` durante DDL
30. **RLS policies con verbo + entity + condición** en human-readable name
31. **Pentest tests** un spec por tabla sensible
32. **Playwright** con setup project + storage state
33. **`data-slot`** attributes
34. **cva** para variantes

❌ NO copiar (específico de la app de referencia, no aplica):
1. **Multi-org via `organization_members` + `active_organization_id`**
2. **Switching org via `auth.updateUser({ data: ... })` + reload**
3. **`useValidatedOrganization` con auto-correction**
4. **`group_id` + accounting firms**
5. **NestJS API** (al menos hasta Fase E)
6. **Redux Toolkit** (TanStack Query + Zustand opt-in alcanzan)
7. **Drizzle ORM** (typed Supabase client + generated types alcanza)
8. **SSE relay** (Inngest UI alcanza para Fase E)
9. **Embeddings** (no hay caso de uso aún)
10. **Temporal** (Inngest free tier alcanza por ahora)
11. **`shadow rollout` de CSP** — somos app nueva, va estricto desde día 1

⚠️ Adaptar:
1. **`getCurrentUserOrganization` → `getCurrentUserContext`** (sin orgId)
2. **`useValidatedOrganization` → `useCurrentUser`** (sin switching)
3. **`organization_id` en cada tabla → tagging por `channel_id` o `business_unit_id`** según el caso (ver roadmap §0)
4. **`NavOrg` switcher → logo estático** o nombre del grupo "DZ & Sons"
5. **Logger frontend → JouveERP no usa OTel hoy**, simple console.log redactado

---

## 23. Snippets pegables (ready-to-paste)

### 23.1 cn helper
```ts
// lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

### 23.2 useConfirm
Ya pegado en §13.3.

### 23.3 useIsMobile
Ya pegado en §15.1.

### 23.4 Browser supabase client tipado
```ts
// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

### 23.5 Server supabase client tipado
```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/database.types";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {
            // Server Component context — ignore (proxy refreshes session)
          }
        },
      },
    },
  );
}
```

### 23.6 Service role client
```ts
// lib/supabase/service.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

### 23.7 Generated types script
```bash
# scripts/db-types.sh
#!/bin/bash
set -e
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTFILE="$ROOT_DIR/lib/db/database.types.ts"
mkdir -p "$(dirname "$OUTFILE")"
(
  cd "$ROOT_DIR"
  if ! pnpm dlx supabase status >/dev/null 2>&1; then
    pnpm dlx supabase start
  fi
  pnpm dlx supabase gen types typescript --local --schema public > "$OUTFILE"
)
pnpm exec prettier --write "$OUTFILE"
```

### 23.8 Husky pre-push (adaptado a single-app)
```bash
#!/usr/bin/env sh
. "$(dirname "$0")/_/husky.sh"

# Regenerate Supabase types if migrations changed
if git show-ref --verify --quiet refs/remotes/origin/main; then
  merge_base="$(git merge-base HEAD origin/main)"
  has_new_migrations=$(git diff --diff-filter=A --name-only "$merge_base"...HEAD -- "supabase/migrations/*.sql" | wc -l | xargs)
  if [ "$has_new_migrations" -gt 0 ]; then
    pnpm run db:types:generate
    if ! git diff --quiet lib/db/database.types.ts; then
      echo "Error: Supabase types are out of date. Commit the regenerated file."
      git checkout -- lib/db/database.types.ts
      exit 1
    fi
  fi
fi

pnpm test
```

### 23.9 lint-staged config
```js
// lint-staged.config.mjs
export default {
  "*.{ts,tsx}": ["prettier --write"],
  "*.{json,md,yml,css}": ["prettier --write"],
};
```

### 23.10 GitHub Actions migration-order check
Adaptar el yaml de §4.2 cambiando `staging` → `main`.

---

## 24. Archivos clave para volver a leer cuando implementemos

| Tema | Archivo (app de referencia) |
|---|---|
| pnpm + scripts root | `~/Desktop/reference-app/package.json` |
| Husky | `~/Desktop/reference-app/.husky/pre-push` |
| CI principal | `~/Desktop/reference-app/.github/workflows/ci.yml` |
| Migration-order check | `~/Desktop/reference-app/.github/workflows/migration-order-check.yml` |
| Root layout providers | `~/Desktop/reference-app/frontend/src/app/layout.tsx` |
| globals.css con oklch | `~/Desktop/reference-app/frontend/src/app/globals.css` |
| Main protected layout | `~/Desktop/reference-app/frontend/src/app/(main)/layout.tsx` |
| AppSidebar | `~/Desktop/reference-app/frontend/src/components/layout/sidebar/AppSidebar.tsx` |
| NavMain (auto-open route-aware) | `~/Desktop/reference-app/frontend/src/components/layout/sidebar/NavMain.tsx` |
| NavOrg switcher con Command | `~/Desktop/reference-app/frontend/src/components/layout/sidebar/NavOrg.tsx` |
| NavUser dropdown | `~/Desktop/reference-app/frontend/src/components/layout/sidebar/NavUser.tsx` |
| AppSidebarHeader breadcrumbs | `~/Desktop/reference-app/frontend/src/components/layout/sidebar/AppSidebarHeader.tsx` |
| Sidebar primitive (cookie + Cmd+B) | `~/Desktop/reference-app/frontend/src/components/ui/sidebar.tsx` |
| Form primitive | `~/Desktop/reference-app/frontend/src/components/ui/form.tsx` |
| Button primitive | `~/Desktop/reference-app/frontend/src/components/ui/button.tsx` |
| Table primitive | `~/Desktop/reference-app/frontend/src/components/ui/table.tsx` |
| Empty primitive | `~/Desktop/reference-app/frontend/src/components/ui/empty.tsx` |
| Sonner toaster | `~/Desktop/reference-app/frontend/src/components/ui/sonner.tsx` |
| Skeleton | `~/Desktop/reference-app/frontend/src/components/ui/skeleton.tsx` |
| Theme provider | `~/Desktop/reference-app/frontend/src/components/layout/ThemeContext.tsx` |
| Query provider | `~/Desktop/reference-app/frontend/src/components/providers/QueryProvider.tsx` |
| PostHog identify | `~/Desktop/reference-app/frontend/src/components/providers/PostHogIdentify.tsx` |
| WebVitals | `~/Desktop/reference-app/frontend/src/components/providers/WebVitals.tsx` |
| useConfirm hook | `~/Desktop/reference-app/frontend/src/hooks/use-confirm.tsx` |
| useIsMobile | `~/Desktop/reference-app/frontend/src/hooks/use-mobile.ts` |
| useValidatedOrganization | `~/Desktop/reference-app/frontend/src/hooks/use-validated-organization.ts` |
| Server action ejemplo | `~/Desktop/reference-app/frontend/src/features/close-management/actions/account-reconciliation-actions.ts` |
| Form ejemplo (TeamClient) | `~/Desktop/reference-app/frontend/src/features/settings/components/TeamClient.tsx` |
| Skeleton feature ejemplo | `~/Desktop/reference-app/frontend/src/features/settings/components/SettingsDetailsSkeleton.tsx` |
| Supabase server client | `~/Desktop/reference-app/frontend/src/lib/supabase/server.ts` |
| Supabase proxy/middleware | `~/Desktop/reference-app/frontend/src/lib/supabase/proxy.ts` |
| Root proxy.ts (CSP + nonce) | `~/Desktop/reference-app/frontend/src/proxy.ts` |
| CSP builders | `~/Desktop/reference-app/frontend/src/lib/security/csp.ts` |
| Public pages helper | `~/Desktop/reference-app/frontend/src/lib/auth/public-pages.ts` |
| Logger frontend | `~/Desktop/reference-app/frontend/src/lib/logger.ts` |
| OTel logger | `~/Desktop/reference-app/frontend/src/lib/otel-logger.ts` |
| getCurrentUserOrganization helper | `~/Desktop/reference-app/frontend/src/lib/utils/server-organization-utils.ts` |
| organization-utils (validation) | `~/Desktop/reference-app/frontend/src/lib/utils/organization-utils.ts` |
| next.config.ts | `~/Desktop/reference-app/frontend/next.config.ts` |
| eslint.config.mjs | `~/Desktop/reference-app/frontend/eslint.config.mjs` |
| components.json shadcn config | `~/Desktop/reference-app/frontend/components.json` |
| playwright.config.ts | `~/Desktop/reference-app/frontend/playwright.config.ts` |
| RLS pentest spec | `~/Desktop/reference-app/api/src/security/__tests__/vouchers-rls.spec.ts` |
| pentest helpers (JWT signing) | `~/Desktop/reference-app/api/src/security/__tests__/pentest-helpers.ts` |
| Migration ejemplo (suppliers) | `~/Desktop/reference-app/supabase/migrations/20260218170000_add_suppliers_table.sql` |
| RLS policies ejemplo | `~/Desktop/reference-app/supabase/migrations/20260218191142_add_suppliers_rls_policies.sql` |
| Generated types script | `~/Desktop/reference-app/scripts/generate-supabase-types.sh` |
| strip-partition-types.mjs | `~/Desktop/reference-app/scripts/strip-partition-types.mjs` |
| StructuredLoggerService (API) | `~/Desktop/reference-app/api/src/common/services/structured-logger.service.ts` |
| OrganizationAuthGuard (API) | `~/Desktop/reference-app/api/src/guards/organization-auth.guard.ts` |
| AuthService (API) | `~/Desktop/reference-app/api/src/modules/auth/auth.service.ts` |

---

## 25. Lecciones meta

1. **Comments explain WHY, not WHAT.** Leerse 50 comentarios de la app de referencia deja claro: 90% justifican una decisión no-obvia. El otro 10% es un "DO NOT REMOVE" gritado.
2. **Defense in depth.** RLS en DB + chequeo en server action + `withAuth` guard + ProtectedContent en client. Cada capa redundante.
3. **Shadow rollout antes de breaking changes.** CSP estricto observa antes de enforcer. Tipos generados se chequean en CI antes de fallar localmente.
4. **Auto-correction sobre rejection.** Si el active_organization_id es stale, switchea silenciosamente a uno válido y recarga. No le pegas un error 403 al user.
5. **Idempotencia en server actions y workflows.** `if (state.status === "done") return;` al inicio de cada job. Server actions con `force_create` flag para retries seguros. Inngest functions con `idempotency: "event.data.idempotency_key"`.
6. **Cookie state > URL state para UI ephemeral.** Sidebar abierto/cerrado, theme. URL state se reserva para deep-linking (paneles, modales que querés compartir).
7. **PostHog reverse proxy es estándar.** No es paranoia, es lo que hacen todos los proyectos serios para esquivar ad-blockers.
8. **`nestjs-cls` para context propagation.** Pasar `userId` por argumento en cada función es ruido; CLS lo propaga automáticamente.
9. **Pentest test por tabla, no por feature.** Cuando agregás una tabla con datos sensibles, agregás su `<table>-rls.spec.ts`. Es mecánico.
10. **Generated types committed.** El argumento "no commitear archivos generados" se rompe en cuanto el archivo es la única fuente de truth tipada del schema. Commitear + auto-check en CI > regenerar siempre.

---

Fin del documento. ~2200 líneas de patrones extraídos.
