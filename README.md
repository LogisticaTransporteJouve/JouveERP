# JouveERP

ERP contable/financiero de DZ & Sons S.A. (Transporte Jouve) — Argentina,
single-CUIT. Opera Logística Jouve con dos canales de facturación (fiscal e
interno); DZ Instalaciones se retiró el 2026-10-31.

## Stack

- **Next.js 16** (App Router) + React 19
- **shadcn/ui** + Tailwind v4 + Geist
- **Supabase** (auth + Postgres + RLS + Storage + Realtime)
- **TanStack Query** (server state) + Zustand opt-in (client state)
- **Zod 4** + react-hook-form
- **Inngest** (workflows durables y crons)
- **Sentry**
- **pnpm 10**
- **Vitest** + **Playwright** (E2E) + **pgTAP** (SQL)

## Documentación

Índice completo en [`docs/README.md`](docs/README.md). Para contribuir:
[`CONTRIBUTING.md`](CONTRIBUTING.md). Reglas para agentes: [`CLAUDE.md`](CLAUDE.md)
y [`AGENTS.md`](AGENTS.md).

## Requisitos

- Node (versión en `.nvmrc`) y pnpm (`corepack enable`).
- Docker corriendo (Supabase local).
- Supabase CLI en la versión de `scripts/supabase-cli-version` (la que usa CI).

`pnpm preflight` chequea todo lo anterior y dice qué falta.

## Puesta en marcha

```bash
pnpm install          # instala dependencias y los git hooks
pnpm preflight        # verifica Node, pnpm, Docker, Supabase CLI
cp .env.local.example .env.local   # completar (ver abajo)
pnpm dev:up           # Supabase + Next + Inngest dev
pnpm seed:dev         # crea tomas@jouve.test / Test1234!
```

El primer usuario que entra se vuelve `owner` automáticamente
(`bootstrapOwnerIfNeeded`). Desde `/admin/users` el owner invita usuarios y
edita los **accesos** de cada uno: roles y módulos/acciones ocultos.

## Qué corre dónde

| Proceso         | URL                      | Comando                                              |
| --------------- | ------------------------ | ---------------------------------------------------- |
| Next.js         | <http://127.0.0.1:3000>  | `pnpm dev` (`pnpm dev:lan` para exponerlo en la red) |
| Inngest dev     | <http://127.0.0.1:8288>  | `pnpm dev:inngest`                                   |
| Supabase Studio | <http://127.0.0.1:54323> | `supabase start`                                     |

`pnpm dev:up` levanta los tres (`Ctrl-C` baja Next e Inngest). Sin Inngest,
los endpoints funcionan pero `inngest.send(...)` no dispara nada.

## Comandos

| Comando                                          | Qué hace                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:up`                       | Next solo / todo el stack                                           |
| `pnpm lint` · `pnpm typecheck` · `pnpm test`     | ESLint (incluye las cercas de `eslint.fences.mjs`) · `tsc` · Vitest |
| `pnpm build`                                     | build de producción                                                 |
| `pnpm format` / `pnpm format:check`              | Prettier (CI chequea solo los archivos que cambia el PR)            |
| `pnpm test:e2e` / `pnpm test:e2e:ui`             | Playwright (requiere `pnpm dev`)                                    |
| `pnpm test:scripts`                              | self-tests de los scripts y gates de CI                             |
| `pnpm db:types:generate` / `pnpm db:types:check` | regenera / verifica `lib/db/database.types.ts`                      |
| `pnpm check:migrations`                          | squawk + reglas de migraciones nuevas contra `origin/main`          |
| `pnpm db:restamp`                                | re-timestampea migraciones de la rama que quedaron viejas           |
| `pnpm check:forbidden-words`                     | busca palabras prohibidas (lista en `FORBIDDEN_WORDS`)              |
| `pnpm db:reset`                                  | resetea la DB local y siembra datos                                 |
| `pnpm seed:dev` / `pnpm seed:all`                | usuario de dev / datos completos                                    |
| `pnpm eval:ai`                                   | evals de ruteo de IA contra el modelo real                          |

## Variables de entorno

Lista completa y comentada en `.env.local.example` (nunca commitear
`.env.local`). Mínimo para correr: Supabase local (URL, anon key, service key,
JWT secret) y AFIP en homologación (`AFIP_ENV`, `AFIP_CUIT`, `AFIP_CERT`,
`AFIP_KEY`). Opcionales: claves de IA, VAPID (push), Resend (email), Sentry.

## Tests

```bash
pnpm test                       # unit + schema (Vitest)
RUN_INTEGRATION=1 pnpm test     # integración contra Supabase local
supabase test db                # pgTAP (supabase/tests/)
pnpm test:e2e                   # Playwright; usuario de pnpm seed:dev
RUN_AFIP_E2E=1 pnpm test:e2e    # smoke de emisión AFIP (homologación)
```

Las E2E aceptan `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` para otro usuario.

## Base de datos

- Migraciones en `supabase/migrations/YYYYMMDDHHMMSS_<scope>.sql`, con RLS en la
  misma migración y timestamp posterior al último de `main`. Nunca se edita una
  migración mergeada.
- Timeouts con `SET LOCAL` al inicio del archivo; nunca `SET row_security`.
- Después de una migración: `pnpm db:types:generate` (CI compara byte a byte).
- `pnpm check:migrations` corre en el hook de pre-push y en CI.

## CI y deploy

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, test, build, formato de
  archivos cambiados, gates de workflows y skills, palabras prohibidas; el job
  `e2e` (Playwright contra un build de producción y Supabase local); y el job
  `database` (migraciones desde cero, squawk, pgTAP, diff de tipos y pentests
  por rol contra PostgREST, `pnpm test:security`).
- **Preview** (`preview.yml`): deploy de Vercel cuando el PR deja de ser draft.
- **Producción** (`promote-to-production.yml`, manual desde Actions): toma un
  commit de `main` con CI verde, pide aprobación, aplica las migraciones,
  despliega en Vercel, sincroniza Inngest, hace un smoke test y mueve el tag
  `production-latest`. Un SHA anterior hace rollback del código. Vercel no
  publica `main` solo.

## Problemas comunes

- **`supabase start` falla bajando imágenes** → reintentar o usar
  `supabase db start` (solo Postgres) para validar SQL.
- **`db:types:check` falla** → regenerar con la versión de CLI de CI.
- **CI dice "not after …" en migraciones** → `pnpm db:restamp`.
- **El hook de commit rechaza el mensaje** → sacá el `Co-Authored-By` o la
  palabra prohibida que nombra.
