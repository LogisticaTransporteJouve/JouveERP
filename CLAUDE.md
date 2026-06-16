# CLAUDE.md — JouveERP

ERP contable/financiero argentino, **single-CUIT** (DZ & Sons S.A.), 2 divisiones
(DZ Instalaciones, Logística Jouve) × fiscal/interno = 4 canales de facturación.
No hay multi-tenancy: una sola `business_units` (`dz_sons`).

**Stack:** Next.js 16 (App Router) + React 19 · Supabase (Postgres + RLS +
realtime) · Inngest (background/cron) · TanStack Query · shadcn/ui + Tailwind v4
(monocromo oklch) · Zod 4 · react-hook-form · AFIP (WSAA/WSFEv1) · `@react-pdf/renderer`.
Package manager **pnpm**. Tests Vitest (+ Playwright).

## Estructura

- `features/<dominio>/{actions,components,hooks,lib,schemas,types,index.ts}` —
  slices autocontenidos. Solo importan de `@/components/ui/*`, `@/lib/*`,
  `@/hooks/*`. **Importar de otra feature → prohibido** (subir a `@/lib/`).
- `app/(dashboard)/<ruta>/page.tsx` — server components con prefetch + `Hydrate`.
- `app/api/<x>/route.ts` — route handlers.
- `lib/` — `auth/`, `supabase/`, `inngest/`, `query/`, `pdf/`, `db/database.types.ts`, …
- `supabase/migrations/` — SQL timestamped con RLS.

## Convenciones (no negociables)

- **Server actions:** `"use server"` → `requireUserContext()` +
  `userCan(ctx.roles, "<perm>")` → `getServiceClient()` → devolver
  `ActionResult<T>` (`lib/query/run-action.ts`). Sin `select *`.
- **Cliente:** `runAction(() => xAction(..))` dentro de `useSuspenseQuery` /
  `useSuspenseInfiniteQuery`; query keys en `features/<f>/lib/<f>-keys.ts`.
- **RBAC:** roles + matriz en `lib/auth/permissions.ts`; cobertura **100%** en
  `lib/auth/permissions.test.ts`. **RLS en cada tabla.**
- **Migraciones:** `YYYYMMDDHHMMSS_<scope>.sql`, **RLS en la misma migración**
  (helper `public.user_has_role(text[])`), regenerar `lib/db/database.types.ts`
  (CI diff-ea). Timestamp > el máximo en `main`. **Nunca editar una mergeada.**
- **Background/cron:** Inngest (no Temporal). Registrar en `app/api/inngest/route.ts`.
- **Auditoría:** `logAudit()` → `audit_events` (`lib/actions/audit.ts`).
- **UI:** CRUD en `Dialog` centrado (no Sheet). **100% monocromo** (sin color de
  marca; peligro = copy + iconos). `lucide-react`, Geist Sans/Mono.
- **Git:** conventional commits en **inglés**; **sin** `Co-Authored-By` ni footer;
  PRs **siempre draft** (`gh pr create --draft`); no commitear a `main`.
- ESLint: `no-explicit-any` error; sin `as`.

## Skills de desarrollo

En `.claude/skills/`: **`/new-feature`**, **`/new-migration`**, **`/new-inngest-fn`**.
Invocalas al agregar dominios, migraciones o jobs.

## Docs

- `docs/roadmap.md` — plan maestro. ⚠️ **Hoy desactualizado** — ver `docs/pendientes.md`.
- `docs/pendientes.md` — qué falta (auditoría docs vs código).
- `docs/ai-overview.md` — feature IA: chat, insights proactivos, Document
  Intelligence (escaneo/OCR/extracción) + UI + tablas + plan AI.0–AI.8.
- `docs/ai-build-plan.md` — **runbook de ejecución** (orden, prompts por fase).
- `docs/ai-patterns.md` — patrones de diseño IA (referencia).
- `docs/{chat,files,notifications}-patterns.md`, `files-reference.md`,
  `sumary-frontend-patterns.md`, `user-avatars.md` — specs por subsistema.
- `docs/manual/` — manual HTML para usuario final.

## Comandos

Ver `README.md`. Esenciales: `pnpm dev` (Next), `pnpm test` (Vitest),
`pnpm dlx supabase gen types typescript --local --schema public > lib/db/database.types.ts`
(regen tipos tras una migración).
