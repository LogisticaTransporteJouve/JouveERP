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
- **Inngest** (workflows durables a partir de Fase E)
- **pnpm 10**
- **Vitest** (Playwright a partir de Fase E)

## Documentación

- [`docs/roadmap.md`](docs/roadmap.md) — plan de 10 fases, ~57 PRs, decisiones
  cerradas, design system, convenciones de trabajo.
- [`docs/sumary-frontend-patterns.md`](docs/sumary-frontend-patterns.md) —
  referencia técnica de patrones (tooling, navegación, tablas, forms, hooks,
  CSP, RLS, tests). Snippets pegables.

## Cómo arrancar

El repo todavía no tiene código — solo documentación. La **Fase A.1**
(`chore: init Next.js + pnpm + Tailwind v4 + shadcn`) es el primer PR que
agrega el scaffold.

## Convenciones

- Conventional Commits en inglés (`feat:`, `fix:`, `chore:`, `docs:`).
- Branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`. Una rama = un PR.
- PRs ≤500 LOC cuando se pueda, ≤1000 si una migración + UI lo justifican.
- CI verde obligatorio.
