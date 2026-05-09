# JouveERP

ERP logístico para Transporte Jouve (DZ & Sons S.A) — Argentina, single-CUIT,
dos divisiones comerciales (DZ Instalaciones + Logística Jouve), cuatro canales
de facturación (fiscal/interno × DZ/Jouve).

## Stack

- **Next.js 16** (App Router) + React 19
- **shadcn/ui** + Tailwind v4 + Geist
- **Supabase** (auth + Postgres + RLS)
- **TanStack Query** (server state) + Zustand opt-in (client state)
- **Zod 4** + react-hook-form
- **Inngest** (workflows durables — Fase E)
- **pnpm 10**
- **Vitest** (Playwright a partir de Fase E)

## Documentación

- [`docs/roadmap.md`](docs/roadmap.md) — plan de 10 fases, ~57 PRs, decisiones
  cerradas, design system, convenciones de trabajo.
- [`docs/sumary-frontend-patterns.md`](docs/sumary-frontend-patterns.md) —
  referencia técnica de patrones (tooling, navegación, tablas, forms, hooks,
  CSP, RLS, tests). Snippets pegables.

## Desarrollo local

A partir de Fase E hacen falta tres procesos en paralelo. Lo más cómodo es
abrir tres terminales en VS Code (cada uno con `cwd` en la raíz del repo):

```bash
# Terminal 1 — Supabase (Postgres + Auth + Storage)
pnpm dlx supabase start

# Terminal 2 — Next.js
pnpm dev

# Terminal 3 — Inngest dev runtime (descubre funciones en /api/inngest)
pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

La UI de Inngest queda en <http://localhost:8288>. Ahí ves las funciones
registradas, mandás eventos manualmente para probarlas y revisás runs +
retries paso por paso.

Si no tocás workflows en una sesión, podés saltearte el terminal 3 — los
endpoints siguen funcionando, solo que `inngest.send(...)` no dispara nada
hasta que el dev runtime esté arriba.

## Convenciones

- Conventional Commits en inglés (`feat:`, `fix:`, `chore:`, `docs:`).
- Branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`. Una rama = un PR.
- PRs ≤500 LOC cuando se pueda, ≤1000 si una migración + UI lo justifican.
- CI verde obligatorio.
