# Plan de ejecución — IA + cierre de gaps (runbook)

> Cómo ejecutar todo cuando llegues a casa, en **Claude Code** (no Cowork).
> Cada ítem = **una corrida = un PR draft**. Pegás el prompt, revisás el PR,
> mergeás, seguís. Fuente de verdad: `docs/ai-overview.md`, `docs/pendientes.md`,
> `docs/roadmap.md`, `CLAUDE.md`.
>
> **Antes de empezar:** `pnpm install`; levantar Supabase local + Next + Inngest
> (ver `README.md`); `git` con remoto configurado (si todavía no, trabajá en
> ramas locales y abrí los PR draft cuando conectes el remoto — el resto del flujo
> es igual).

---

## Convenciones globales (recordatorio)

- Rama por ítem: `feat/<scope>` / `chore/<scope>` / `docs/<scope>`. **No commitear a `main`.**
- Conventional commits en **inglés**, **sin** `Co-Authored-By`.
- PRs **siempre draft**: `gh pr create --draft` (Summary / Migrations / Test plan).
- Migraciones timestamped con **RLS en la misma migración**; regenerar
  `lib/db/database.types.ts`. Nunca editar una migración mergeada.
- CI verde obligatorio: lint + typecheck + test + build + migration-order + types-drift.
- Usar las skills: `/new-feature`, `/new-migration`, `/new-inngest-fn`.

## Plantilla de prompt (goal por fase)

```
Trabajás en JouveERP. Leé CLAUDE.md, docs/ai-overview.md y docs/pendientes.md.
Implementá <ÍTEM>: <SCOPE>.
Seguí las convenciones del repo (skills /new-feature, /new-migration,
/new-inngest-fn; estudiá features/invoices y features/aging como template).
Migraciones timestamped con RLS en la misma migración; regenerá
lib/db/database.types.ts. Tests donde el patrón lo pide (matriz de permisos en
permissions.test.ts, Zod schema.test.ts, input de tools). Lint + typecheck +
test + build en verde. Abrí PR draft (gh pr create --draft) con Summary /
Migrations / Test plan. No commitees a main. Parate al terminar para que revise.
```

---

## Orden de ejecución

### Track 0 — seguro, sin código (hacelo primero)

| Ítem | Scope | Aceptación |
|---|---|---|
| **Sync roadmap** | Actualizar `docs/roadmap.md` a la realidad: cerrar Fase K (K.7–K.11 hechas, PR #48 mergeado); agregar **Fase N (HR/Sueldos)** con breakdown (empleados, sueldos, asistencia, vacaciones, documentos); listar treasury; agregar **Pagos recurrentes** y **Document Intelligence (I.2)** como fases; corregir §6 orden. Ver `docs/pendientes.md` §1. | roadmap refleja el código; PR draft `docs:` |

### Track A — build IA (serial, respetar dependencias)

| Ítem | Depende | Scope (ver ai-overview §9) | Aceptación |
|---|---|---|---|
| **AI.0** | — | `pnpm add ai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/openai`; permisos `ai:chat`/`ai:read`/`ai:admin` en `permissions.ts` + matriz test; migración `audit_events.actor_type` (`'user'\|'ai-agent'\|'system'`, default `'user'`). Sin agente aún. | deps instaladas; matriz 100%; types regen |
| **Pagos recurrentes** (no-IA) | — | Feature `recurring_payments` (CRUD + tabla + RLS + permiso). Insumo del cash-flow. `/new-feature` + `/new-migration`. | slice completo + test; types regen |
| **AI.1** | AI.0 | `features/ai/tools/` registry; ~8–10 tools de lectura (invoices, client aging, treasury, transactions, purchase invoices, supplier aging, libro IVA, mayor) envolviendo los actions existentes; unit tests de tools. **Tool SQL diferido.** | tools tipados + tests |
| **AI.2** | AI.1 | `agent.ts` (Experimental_Agent, `stepCountIs`), `lib/model-fallback.ts` (Sonnet 4.6 + fallback), `app/api/ai/chat/route.ts` streaming + base prompt. **Incluir el tope diario 500K acá** (bucket `ai:tokens:daily`, `enforceRateLimit`). | chat responde; tope activo |
| **AI.3** | AI.2 | `app/(dashboard)/ai/page.tsx` + `useChat`; historial `ai_chat_sessions`/`ai_chat_messages` + RLS + persistencia; UI §4 (layout, componentes, estados, empty state, mobile). | chat usable; historial persiste |
| **AI.4** | AI.3 | Completar catálogo de tools; artifacts inline (tabla/chart) + `tool-renderers.ts`. | artifacts renderizan |
| **AI.5** | AI.1 + Pagos recurrentes + AI.3 | Tabla `ai_insights` + RLS; cron Inngest analyst (`/new-inngest-fn`, template `aging-weekly-summary`) que arma **cash-flow proyectado** + **delta de cobranzas**; insight cards + "preguntar sobre esto". | 2 insights generan cards |
| **AI.6** | AI.2/AI.3 | `ai_usage` + RLS + **medidor de tokens** (RPC `ai_usage_today` + UI consumo/tope); rate limiting; generadores de insight restantes; extender `document-expiry-alerts`. | medidor visible; usage logueado |

### Track A' — Document Intelligence (después de AI.0; en paralelo al chat)

| Ítem | Depende | Scope (ver ai-overview §5-bis + §9 AI.8) | Aceptación |
|---|---|---|---|
| **AI.8** | AI.0 (+ files K.10 + items K.8, ya existen) | Tabla `ai_document_extractions` + RLS; función Inngest **clasificar (Haiku) → extraer (Sonnet, `generateObject` + Zod por tipo)** + post-inferencia + match/dedupe; UI **revisar-y-crear** (split preview + form pre-llenado, §5-bis Pantallas). **Arrancar por factura de compra** (con ítems) y extender a recibo/OP/remito/cheque. | factura de compra: escanear → revisar → crear con ítems |

### Track B — independientes (worktrees, en paralelo con A)

| Ítem | Scope | Aceptación |
|---|---|---|
| **Spec accounting** | `docs/accounting-patterns.md` (chart-of-accounts, journal-entries, libro-mayor, libro-iva, balance, transactions, cost-centers, inflation). | doc completo |
| **Spec HR** | `docs/hr-patterns.md` (empleados, sueldos, asistencia, vacaciones, documentos). | doc completo |
| **Tests sensibles** | Tests de `admin-users` (RBAC) y `afip-admin` (credenciales). | cobertura básica |

> `CLAUDE.md` ya está creado (este repo). Si falta algo, ajustarlo.

---

## Notas

- **Tope diario:** se construye en **AI.2** (no esperar a AI.6) para evitar gasto
  runaway desde el primer chat. Valor: 500K tokens/día/org (config).
- **Modelos:** todo **Sonnet 4.6**; **Haiku 4.5** para clasificación de documentos
  y títulos de chat. Opus 4.8 descartado del MVP.
- **Sin infra nueva:** Inngest (no Temporal/Modal), Claude vía AI SDK, Supabase,
  bucket `files`. No agregar colas/sandboxes.
- **Document Intelligence ≠ chat:** usa `generateObject` directo, no el agente.
  Por eso solo depende de AI.0, puede ir en paralelo al track de chat.
- Al cerrar cada ítem: actualizar `docs/pendientes.md` (tildar) y `docs/roadmap.md`
  (regla §7.13: en el mismo PR).
```
