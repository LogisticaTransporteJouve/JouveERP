# JouveERP

ERP logístico para Transporte Jouve (DZ & Sons S.A) — Argentina, single-CUIT,
dos divisiones comerciales (DZ Instalaciones + Logística Jouve), cuatro canales
de facturación (fiscal/interno × DZ/Jouve).

## Stack

- **Next.js 16** (App Router) + React 19
- **shadcn/ui** + Tailwind v4 + Geist
- **Supabase** (auth + Postgres + RLS + Storage + Realtime)
- **TanStack Query** (server state) + Zustand opt-in (client state)
- **Zod 4** + react-hook-form
- **Inngest** (workflows durables)
- **Sentry** + PostHog (vía reverse proxy `/ingest/*`)
- **pnpm 10**
- **Vitest** + **Playwright** (E2E)

## Documentación

- **[`docs/roadmap.md`](docs/roadmap.md)** — **plan maestro y única fuente
  de verdad sobre el estado**. Qué está hecho, qué está en vuelo, qué viene
  después. Decisiones cerradas, design system, convenciones, anti-patrones,
  riesgos, métricas, y changelog histórico por fase en el anexo.
- [`docs/sumary-frontend-patterns.md`](docs/sumary-frontend-patterns.md) —
  referencia técnica de patrones (tooling, navegación, tablas, forms, hooks,
  CSP, RLS, tests). Snippets pegables.
- [`docs/ai-patterns.md`](docs/ai-patterns.md) — plan completo de Fase I (IA).
- [`docs/chat-patterns.md`](docs/chat-patterns.md),
  [`docs/notifications-patterns.md`](docs/notifications-patterns.md),
  [`docs/user-avatars.md`](docs/user-avatars.md) — specs del subsistema social.
- [`docs/files-patterns.md`](docs/files-patterns.md) +
  [`docs/files-reference.md`](docs/files-reference.md) — spec de adjuntos
  polimórficos (entra en K.10 + M.4) y motor de OCR (Fase I.2).

## Pendientes que necesitan una decisión

El sistema ya hace el trabajo; lo que falta acá son **datos o reglas que solo el
dueño o el contador conocen**. Cuando tengamos cada input, se construye. (Lista
viva en [`docs/pendientes.md`](docs/pendientes.md).)

1. **Envío de email** (resumen semanal de deudores + alertas de vencimientos).
   Los crons ya calculan todo, pero no se manda nada. *Falta:* elegir proveedor
   (recomendado **Resend**) y cargar su API key como secret — la carga el dueño,
   no se commitea.
2. **H.5 — facturar el depósito en AFIP.** Ya se calcula días-pallet × tarifa,
   pero la tarifa es un estimado. *Falta:* las **tarifas reales** por cliente
   (por pallet, por día/mes, mínimos) para cablear la emisión AFIP.
3. **Ajuste por inflación (RG 4667).** La carga de coeficientes existe; falta el
   asiento de reexpresión. *Falta:* el **método del contador** (qué cuentas son
   no-monetarias y a qué cuenta va el RECPAM).
4. **L.6 / L.7 — exports AFIP.** Régimen de información CITI/SIAP (archivo TXT
   posicional mensual de ventas y compras) + CAEA (contingencia). *Falta:* el
   **formato posicional exacto** de AFIP, o confirmar que no se necesitan aún.

> Descartados por decisión del dueño: **M.5** (aprobaciones por monto) y **M.6**
> (portal de cliente). Ver decisiones #19 / #20 en `docs/roadmap.md`.

## Desarrollo local

Tres procesos en paralelo. Lo más cómodo es abrir tres terminales en VS Code
(cada uno con `cwd` en la raíz del repo):

```bash
# Terminal 1 — Supabase (Postgres + Auth + Storage)
pnpm dlx supabase start

# Terminal 2 — Next.js
pnpm dev

# Terminal 3 — Inngest dev runtime (descubre funciones en /api/inngest)
pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

La UI de Inngest queda en <http://localhost:8288>. Si no tocás workflows
en una sesión, podés saltearte el terminal 3 — los endpoints siguen
funcionando, solo que `inngest.send(...)` no dispara nada hasta que el
dev runtime esté arriba.

### Variables de entorno

Ver `.env.local.example` para la lista completa. Mínimo para correr:
Supabase local (URL + anon key + service key), AFIP cert/key/CUIT
(homologación alcanza para dev). VAPID keys son opcionales — sin ellas
el push real no funciona pero el bell in-app sí.

### Seed de usuarios

```bash
pnpm seed:dev                              # crea tomas@jouve.test / Test1234!
pnpm seed:dev otro@jouve.test Test1234!    # crea uno extra
```

El primer user logueado se vuelve `owner` automáticamente vía
`bootstrapOwnerIfNeeded`.

## Tests

```bash
# Unit + schema (Vitest). 220+ tests, corre en <2s.
pnpm test

# Integration suite contra Supabase local (triggers, RPCs, RLS).
# Requiere `pnpm dlx supabase start` previo.
RUN_INTEGRATION=1 pnpm test

# E2E (Playwright). Requiere `pnpm dev` corriendo en otra terminal.
pnpm test:e2e

# E2E con UI interactiva (panel de Playwright)
pnpm test:e2e:ui

# E2E AFIP-emit smoke (homologación). Requiere AFIP creds + POS habilitado.
RUN_AFIP_E2E=1 pnpm test:e2e
```

Las E2E usan el usuario seedeado por `pnpm seed:dev` por default. Si
querés sobreescribir, exportá `E2E_USER_EMAIL` y `E2E_USER_PASSWORD`.

## Convenciones

Resumen — el detalle está en `docs/roadmap.md` §2:

- **Conventional Commits en inglés** (`feat:`, `fix:`, `chore:`, `docs:`).
  Sin `Co-Authored-By` ni footers de "Generated with Claude Code".
- **Branches**: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`. Una rama = un PR.
- **PRs ≤500 LOC** cuando se pueda, ≤1000 si una migración + UI lo justifican.
  Abrir siempre como **draft** (`gh pr create --draft`).
- **CRUD = Dialog** centrado, no Sheet derecho.
- **Sin colores de marca** — paleta 100% monocromática.
- **CI verde obligatorio** para mergear.
