# 2026-11-04 — Presupuesto de Inngest: el descarte de bajar `arca-issued-sync` quedó reemplazado

**Decisión.** En
`docs/decisions/2026-11-04-presupuesto-de-ejecuciones-de-inngest.md`, la línea
"**Descartado.** Bajar la frecuencia de `arca-issued-sync` y de las tareas de
IA" ya no vale:

- `arca-issued-sync` pasó a correr de noche (#366):
  `docs/decisions/2026-11-04-arca-issued-sync-nocturno.md`.
- Las tareas de IA dejaron el cron de 15 minutos por un scheduler por tarea
  (#371):
  `docs/decisions/2026-11-04-tareas-ia-programacion-por-eventos-en-vez-de-polling.md`.

El resto de esa decisión (leer todo en un paso en los crons que casi nunca
encuentran trabajo) sigue vigente. Su cifra de "~26.000 por mes" es anterior a
los dos cambios.

**Por qué un archivo aparte.** La decisión vieja es de otro PR; esta carpeta
no edita archivos de otros PRs salvo para marcar un ítem (`docs/decisions.md`).
