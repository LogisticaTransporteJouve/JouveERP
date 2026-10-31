# Contribuir a JouveERP

Los comandos están en [`README.md`](README.md); las reglas no negociables, en
[`CLAUDE.md`](CLAUDE.md). Este archivo describe el flujo.

## Ramas

- Nunca se commitea ni pushea a `main` (los hooks y `.claude/settings.json` lo
  bloquean).
- Una rama por cambio: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`,
  `docs/<scope>`. Las ramas de agentes (`claude/...`) mantienen su nombre.

## Flujo diario

1. `git switch -c feat/<scope> origin/main`
2. Cambios + tests. Si tocás la DB: migración nueva (`/new-migration`),
   `pnpm db:types:generate`, `supabase test db`.
3. `pnpm lint && pnpm typecheck && pnpm test` antes de pushear (el hook de
   pre-push lo corre igual).
4. Probá el flujo real en `pnpm dev:up`, no solo los tests.

## Commits

Conventional commits **en inglés** (`feat:`, `fix:`, `chore:`, `docs:`,
`refactor:`, `test:`). Sin `Co-Authored-By` ni footers de atribución: el hook
`commit-msg` rechaza el trailer.

## Pull requests

- Siempre **draft** (`gh pr create --draft --base main`). El humano lo pasa a
  ready y mergea.
- La plantilla empieza por `## Resumen`; completá Seguridad, Verificación y
  `## Follow-ups` (lo que queda fuera de alcance va ahí, no en el PR).
- Apuntar a ≤500 LOC; ≤1000 si una migración + UI lo justifican.

## Hooks

`pnpm install` los instala (`.husky/install.mjs`):

- `pre-commit`: lint-staged (ESLint + Prettier) y palabras prohibidas.
- `commit-msg`: palabras prohibidas en el mensaje y sin `Co-Authored-By`.
- `pre-push`: si cambian migraciones, tipos regenerados y `check:migrations`;
  después lint, typecheck y tests.

Las palabras prohibidas se leen de la variable `FORBIDDEN_WORDS`; exportala en
tu shell (en CI es un secret).

## CI

`ci.yml` corre en cada PR (también en draft): gates de workflows y skills,
palabras prohibidas, formato de los archivos cambiados, lint, typecheck, test,
build, el job `e2e` (Playwright) y el job `database` (migraciones desde cero,
squawk, plpgsql_check, pgTAP, diff de tipos, pentests por rol contra
PostgREST). `preview.yml` despliega en Vercel cuando el PR deja de ser draft.

## Migraciones

- `YYYYMMDDHHMMSS_<scope>.sql`, timestamp posterior al último de `main`
  (si quedó viejo: `pnpm db:restamp`).
- RLS en la misma migración; `SET LOCAL` para timeouts; `SECURITY DEFINER` con
  `search_path = ''` y `REVOKE` explícito.
- Nunca se edita una migración mergeada.

## Deploy y rollback

- Mergear a `main` no despliega. Producción se actualiza con **Actions → Promote
  to production → Run workflow** (desde `main`): exige CI verde en ese commit,
  pide aprobación (`production-gate`), aplica migraciones, despliega en
  Vercel, sincroniza Inngest y hace un smoke test.
- Rollback de código: correr el promote con un SHA anterior de `main`.
  Rollback de schema: migración nueva que deshace el cambio; nunca borrar ni
  editar la aplicada.
