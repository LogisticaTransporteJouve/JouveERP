# Documentación de JouveERP

Índice único de `docs/`. Comandos y setup: [`../README.md`](../README.md).
Flujo de trabajo: [`../CONTRIBUTING.md`](../CONTRIBUTING.md). Reglas para
agentes: [`../CLAUDE.md`](../CLAUDE.md), [`../AGENTS.md`](../AGENTS.md).

## Estado y decisiones

- [`pendientes.md`](pendientes.md) — qué falta hoy (fuente vigente de estado).
- [`decisions.md`](decisions.md) — registro fechado de decisiones de diseño.
- [`roadmap.md`](roadmap.md) — plan maestro histórico y changelog por fase.

## Arquitectura por subsistema

- [`frontend-patterns.md`](frontend-patterns.md) — tooling, navegación, tablas,
  forms, hooks, CSP, migraciones, RLS, tests.
- [`mobile-patterns.md`](mobile-patterns.md) — layout móvil.
- [`accounting-patterns.md`](accounting-patterns.md) — plan de cuentas, asientos,
  libros IVA/mayor, balances, centros de costo.
- [`hr-patterns.md`](hr-patterns.md) — empleados, sueldos, asistencia,
  vacaciones, documentos.
- [`files-patterns.md`](files-patterns.md) + [`files-reference.md`](files-reference.md)
  — adjuntos polimórficos y OCR.
- [`chat-patterns.md`](chat-patterns.md), [`notifications-patterns.md`](notifications-patterns.md),
  [`user-avatars.md`](user-avatars.md) — subsistema social.

## IA

- [`ai-overview.md`](ai-overview.md) — chat, insights, Document Intelligence.
- [`ai-cfo.md`](ai-cfo.md) — registry de acciones y permisos por rol.
- [`ai-build-plan.md`](ai-build-plan.md) — runbook de ejecución.
- [`ai-patterns.md`](ai-patterns.md) — patrones de diseño.

## Otros

- [`audit/`](audit/) — auditorías.
- [`manual/`](manual/) — manual HTML para usuario final.
