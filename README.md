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

## Estado del PR #44 (snapshot 2026-05-14)

Snapshot para retomar contexto rápido en otra sesión sin re-leer la
conversación.

**Branch:** `docs/codebase-review-may-2026` → PR draft #44.

### Qué está implementado

| Pieza | Estado | Notas |
|---|---|---|
| **Specs** (5) | ✅ | review-2026-05-14, files-patterns, files-reference, chat-patterns, notifications-patterns, user-avatars. |
| **Migraciones SQL** (11) | ✅ | `20260514150000` → `20260514151100`. user_profiles, avatars bucket, chat schema, chat RPCs, chat realtime, notifications, chat admin RPCs, mentions+search, bugfixes, notification_settings, push_subscriptions. |
| **Profile** | ✅ | `/profile` con upload foto, nombre/apellido, color avatar monocromo. |
| **Chat** | ✅ | self / DMs / grupos, send, reply inline, edit, soft-delete, reactions, typing indicators, @-mentions con dedupe de notif, búsqueda FTS con ⌘K, channel admin (rename/add/remove/leave/mute), markdown, virtualización con `@tanstack/react-virtual`. |
| **Notifications** | ✅ | bell + popover + realtime, browser notifications nativas (in-page), push real con service worker + Inngest dispatch, preferences per-type en `/profile`. |
| **Tests** | ✅ | 221 unit + 9 integration gated por `RUN_INTEGRATION=1` + 4 E2E Playwright. |
| **Files subsystem** | 🚫 | Diferido a propósito. Spec completo, código pendiente. |

### Acciones operativas pendientes (no son código)

1. **Regenerar tipos.** Hoy hay archivos puente
   (`lib/db/database.ts` + `lib/db/database.types.extensions.ts`)
   porque no se levantó Supabase local durante el dev. Después de:
   ```bash
   pnpm dlx supabase stop --project-id sumary-dev  # libera port 54322
   pnpm dlx supabase start
   pnpm db:types:generate
   ```
   Borrar los dos archivos puente y revertir los 4 imports en
   `lib/supabase/{server,client,service,proxy}.ts` de `@/lib/db` a
   `@/lib/db/database.types`.

2. **VAPID keys** (opcional, solo si querés push real con app cerrada):
   ```bash
   pnpm dlx web-push generate-vapid-keys
   ```
   Pegar en `.env.local` y en Vercel env:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY=BL...`
   - `VAPID_PRIVATE_KEY=...`
   - `VAPID_SUBJECT=mailto:soporte@logisticajouve.com.ar`
   - `NEXT_PUBLIC_APP_URL=https://tu-dominio.com`

   Sin esas vars el toggle "Activar push" muestra "no configurado" y
   el bell in-app sigue funcionando normal.

### Servicios externos usados

| Servicio | Para qué | Costo |
|---|---|---|
| Supabase | Postgres + Auth + Realtime + Storage | $0 plan actual |
| Inngest | Workflows del `notifications-dispatch` | $0 free tier |
| Vercel | Hosting + HTTPS | $0 free tier |
| Push services del browser (FCM/Mozilla/Apple) | Web Push estándar | $0 sin cuenta |

**NO usamos:** OneSignal, Pusher, Firebase API, Resend (email digest
descartado), Twilio, OpenAI/Anthropic API (eso viene en Fase I).

### Decisiones del owner registradas

- **No mandamos emails de notificación.** Solo in-app + push real.
- **Files queda fuera de este PR.** Spec listo, código va aparte.
- **Push real con Web Push directo**, sin proveedor comercial.
- **Sidebar de chat abierto a todos los authenticated** (sin
  permission gate en v1).

### Bugs ya arreglados en este PR

1. Notif duplicada por mención (`chat_message` + `chat_mention`):
   `notify_on_chat_mention` borra el `chat_message` del mismo
   mensaje antes de insertar.
2. Solo-admin que sale del grupo lo deja huérfano: trigger
   `ensure_group_has_admin` auto-promueve al miembro más viejo.
3. `chat_channel_members` fuera del realtime: agregado a la
   publication + hook se suscribe.

### Cuando termines de probar

1. Si todo OK: sacar el draft → review (opcional con `/ultrareview`) → squash merge.
2. Si encontrás algo: pegame el error y lo arreglo.

---

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
