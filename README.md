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
- [`docs/chat-patterns.md`](docs/chat-patterns.md),
  [`docs/notifications-patterns.md`](docs/notifications-patterns.md),
  [`docs/user-avatars.md`](docs/user-avatars.md) — specs del subsistema
  social (chat, notifs, avatares). Implementados en PR #44.
- [`docs/files-patterns.md`](docs/files-patterns.md) +
  [`docs/files-reference.md`](docs/files-reference.md) — spec de archivos
  + reference con el engine de OCR. Sin implementar todavía.

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
```

Las E2E usan el usuario seedeado por `pnpm seed:dev` (`tomas@jouve.test` /
`Test1234!` por default). Si querés sobreescribir, exportá `E2E_USER_EMAIL`
y `E2E_USER_PASSWORD` antes de correr.

## Probar el subsistema social (chat + notifs + perfil)

Después de levantar Supabase + Next + Inngest dev, regenerar tipos y crear
al menos un user con `pnpm seed:dev`, hacer este recorrido manual para
validar end-to-end:

1. **Perfil.** Entrar a `/profile` → setear nombre + apellido + foto +
   color → guardar. El avatar del sidebar y del header debería
   actualizarse al instante.
2. **Self-chat + markdown.** Ir a `/chat` → debe redirigir al canal
   propio "Mis notas" → mandar un mensaje con markdown:
   `**hola** _mundo_ \`código\`` → verificar que renderiza con el
   formato correcto. También probar listas (`- uno`), blockquote
   (`> cita`), links autodetectados.
3. **DMs.** Crear un segundo user en otra terminal:
   `pnpm seed:dev otro@jouve.test Test1234!` → recargar la app.
   Tocar "Nuevo" → tab Persona → seleccionar al otro user → se abre
   un DM nuevo. Mandar un mensaje.
4. **Realtime + bell.** Abrir incognito → loguearse como ese otro user
   → ver el DM en el sidebar → mandar respuesta. En la primera
   ventana, el mensaje aparece sin refresh y el bell suma badge.
5. **Reactions + reply.** Hover sobre un mensaje → botón de emoji →
   reaccionar. Botón de responder → escribir reply → enviar. El
   reply muestra una cita del original arriba.
6. **@-mentions.** En un grupo, escribir `@` → debería aparecer popover
   de miembros navegable con `↑/↓/Enter/Tab`. Al mencionar a alguien
   y enviar, el recipient recibe una notif tipo `chat_mention` (no
   `chat_message` — el sistema deduplica).
7. **Búsqueda.** `⌘K` (o `Ctrl+K`) abre el dialog de búsqueda. Buscar
   una palabra de un mensaje anterior → verificar match con highlight.
8. **Channel admin.** En un grupo, abrir el menú del header →
   "Configurar grupo" → renombrar, agregar/quitar miembros, salir.
9. **Push real (opcional).** Si configuraste las VAPID keys
   (`pnpm dlx web-push generate-vapid-keys` y pegaste en
   `.env.local`):
   - `/profile` → "Activar push en este dispositivo" → permitir.
   - Cerrar el tab.
   - Desde la otra ventana mandar un mensaje.
   - El SO debería mostrar una notificación nativa.
10. **Notification preferences.** `/profile` → sección Notificaciones →
    desactivar "Mensajes de chat" → mandar un mensaje desde la otra
    ventana → no debería aparecer en el bell ni dispararse push.

## Convenciones

- Conventional Commits en inglés (`feat:`, `fix:`, `chore:`, `docs:`).
- Branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`. Una rama = un PR.
- PRs ≤500 LOC cuando se pueda, ≤1000 si una migración + UI lo justifican.
- CI verde obligatorio.
