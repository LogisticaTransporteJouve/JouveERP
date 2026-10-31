# CLAUDE.md — JouveERP

ERP contable/financiero argentino, **single-CUIT** (DZ & Sons S.A.), 2 divisiones
(DZ Instalaciones, Logística Jouve) × fiscal/interno = 4 canales de facturación.
No hay multi-tenancy: una sola `business_units` (`dz_sons`).

**Stack:** Next.js 16 (App Router) + React 19 · Supabase (Postgres + RLS +
realtime) · Inngest (background/cron) · TanStack Query · shadcn/ui + Tailwind v4
(neutral oklch + índigo Jouve) · Zod 4 · react-hook-form · AFIP (WSAA/WSFEv1) · `@react-pdf/renderer`.
Package manager **pnpm**. Tests Vitest (+ Playwright).

## Estructura

- `features/<dominio>/{actions,components,hooks,lib,schema.ts,schema.test.ts,index.ts?}` —
  slices autocontenidos. Base: importan de `@/components/ui/*`, `@/lib/*`,
  `@/hooks/*`. **Cross-feature:** tipos, schemas, query-keys y pickers pueden
  cruzar (ej. `accounts/schema`, `clients/schema`, `invoices/components/client-picker`);
  **lógica de negocio (actions) no cruza**, salvo la excepción documentada
  `issueFiscalInvoiceAction`. Si compartís lógica, subila a `@/lib/`.
- `app/(dashboard)/<ruta>/page.tsx` — server components con prefetch + `Hydrate`.
- `app/api/<x>/route.ts` — route handlers.
- `lib/` — `auth/`, `supabase/`, `inngest/`, `query/`, `pdf/`, `db/database.types.ts`, …
- `supabase/migrations/` — SQL timestamped con RLS.

## Convenciones (no negociables)

- **Server actions:** `"use server"` → `requireUserContext()` +
  `userCan(ctx.access, "<perm>")` → `getServiceClient()` → devolver
  `ActionResult<T>` (`lib/query/run-action.ts`). Sin `select *`.
- **Cliente:** `runAction(() => xAction(..))` dentro de `useSuspenseQuery` /
  `useSuspenseInfiniteQuery`; query keys en `features/<f>/lib/<f>-keys.ts`.
- **RBAC:** roles + matriz en `lib/auth/permissions.ts`; cobertura **100%** en
  `lib/auth/permissions.test.ts`. **RLS en cada tabla.**
- **Accesos por usuario:** `ctx.access` = roles + denegaciones del usuario
  (`user_permission_denies`), armado solo por `resolveAccess` (cercado por
  ESLint). Todo gate usa `userCan(ctx.access, …)`; denegar `<x>:read` oculta el
  módulo entero (salvo `ai`), no los datos que otro módulo muestra con su permiso. Las denegaciones se aplican en la app; la DB aplica el techo
  del rol (RLS). Solo el owner las edita (`users:manage_access`), en
  `/admin/users` vía el RPC `set_user_access`; un owner no se puede denegar.
- **Migraciones:** `YYYYMMDDHHMMSS_<scope>.sql`, **RLS en la misma migración**
  (helper `public.user_has_role(text[])`), timeouts con `SET LOCAL` al inicio
  (nunca `SET` pelado ni `row_security`), `SECURITY DEFINER` con
  `search_path = ''` + `REVOKE` de `public`/`anon`/`authenticated`; regenerar
  `lib/db/database.types.ts` con `pnpm db:types:generate` (CI diff-ea);
  `pnpm check:migrations` (squawk + gates) corre en pre-push y CI. Timestamp > el máximo en `main`. **Nunca editar una mergeada.**
- **Background/cron:** Inngest (no Temporal). Registrar en `app/api/inngest/route.ts`.
- **Auditoría:** `logAudit()` → `audit_events` (`lib/actions/audit.ts`).
- **UI:** CRUD en `Dialog` centrado (no Sheet). Neutral (oklch gris) con **un solo
  color: `primary` = índigo Jouve** (`#35358a`, del logo) en botones primarios, nav activo y
  foco; nada más lleva color (peligro = copy + iconos). `lucide-react`, Geist Sans/Mono.
- **Git:** conventional commits en **inglés**; **sin** `Co-Authored-By` ni footer;
  PRs **siempre draft** (`gh pr create --draft`); no commitear a `main`.
- ESLint: `no-explicit-any` error; cercas de seams en `eslint.fences.mjs`
  (proveedores IA, Sentry, `lib/`→feature, actions cross-feature, `Access`,
  `parseFloat` en dinero). Evitar `as` (no hay regla general; sí está
  prohibido hacia `Access`): narrowing con type guards / Zod.
- **Deploy:** `main` no se publica solo; `promote-to-production.yml` aplica las
  migraciones y después despliega el mismo commit. Un rollback de código vuelve
  a un SHA anterior sin revertir migraciones: el código tiene que tolerar el
  schema más nuevo.

## Idioma

Código, commits, nombres y comentarios en **inglés**; copy de UI, mensajes de
error al usuario y docs en **español (Argentina)**.

## Skills de desarrollo

Canónicas en `.agents/skills/<name>/` (symlinks en `.claude/skills/`); índice y reglas para
agentes en [`AGENTS.md`](AGENTS.md), mapa en `.agents/skills/README.md`.

- **Scaffolds:** **`/new-feature`**, **`/new-migration`**, **`/new-inngest-fn`** — invocalas al
  agregar dominios, migraciones o jobs.
- **Planificar / construir / revisar / shippear:** `/adv-planning`, `/adv-research`,
  `/auto-implement`, `/adv-review`, `/auto-ship-gate` (deja el PR en draft), `/auto-build`
  (la cadena completa).
- **Lentes:** `/enforce-ports-and-adapters` (slices y seams), `/enforce-clean-code` (DRY),
  `/enforce-comment-value`, `/enforce-role-isolation` (`userCan` + RLS por rol);
  `/enforce-reach`, `/enforce-outcomes`, `/enforce-effects`, `/enforce-claims`,
  `/enforce-data-integrity`, `/enforce-deploy-safety`, `/enforce-ui-state`;
  perf/telemetry en `.agents/skills/_shared/`.
- **Otros:** `/verify`, `/restamp-migrations`, `/nav-github`, `/nav-linear` (opcional),
  `supabase-postgres-best-practices`, `/tighten`.

`.claude/settings.json` bloquea `supabase db push`/`link`, push a `main`, force-push y leer `.env*`.

## Docs

Índice en [`docs/README.md`](docs/README.md); decisiones en `docs/decisions.md`;
flujo de trabajo en [`CONTRIBUTING.md`](CONTRIBUTING.md).

- `docs/roadmap.md` — plan maestro histórico; el estado vigente está en `docs/pendientes.md`.
- `docs/pendientes.md` — qué falta (auditoría docs vs código).
- `docs/ai-overview.md` — feature IA: chat, insights proactivos, Document
  Intelligence (escaneo/OCR/extracción) + UI + tablas + plan AI.0–AI.8.
- `docs/ai-cfo.md` — AI CFO: registry único de acciones (`features/ai/registry/`),
  permisos por rol y plan por fases (ve → pregunta/actúa → muestra → trabaja solo).
- `docs/ai-build-plan.md` — **runbook de ejecución** (orden, prompts por fase).
- `docs/ai-patterns.md` — patrones de diseño IA (referencia).
- `docs/accounting-patterns.md` — arquitectura contable (Fase L+D): plan de
  cuentas, asientos auto, libros IVA/mayor, balances, centros de costo.
- `docs/hr-patterns.md` — arquitectura RRHH (Fase N): empleados, sueldos,
  asistencia, vacaciones (LCT), documentos + crons.
- `docs/{chat,files,notifications}-patterns.md`, `files-reference.md`,
  `frontend-patterns.md`, `user-avatars.md` — specs por subsistema.
- `docs/manual/` — manual HTML para usuario final.

## Comandos

Tabla completa en `README.md`. Esenciales: `pnpm dev:up` (stack), `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm db:types:generate` (tras una migración),
`pnpm check:migrations`.
