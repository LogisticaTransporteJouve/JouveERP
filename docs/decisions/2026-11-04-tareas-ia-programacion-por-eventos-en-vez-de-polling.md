# 2026-11-04 — Tareas IA: programación por eventos en vez de polling

**Pregunta (owner).** "¿Por qué consultar cada 15 minutos si cada tarea tiene
su propio horario?"

**Decisión.** Opción D sobre B: un `ai-workflow-scheduler` por ocurrencia
(`step.sleepUntil(next_run_at)`, `cancelOn` sobre `ai/workflow.changed`, se
reprograma mandándose el `ai/workflow.scheduled` siguiente) más un
`ai-workflows-reconcile` diario (04:52 AR, fuera de 6–9 AM Pacific) como red
de seguridad. Se borra `ai-workflows-materialize` (cron `*/15`); su re-envío
de corridas en cola y el cierre por `expired` pasan al reconcile. Detalle en
`docs/ai-cfo.md` (Tareas IA recurrentes).

|                                          | A. Poll cada 15 min                          | B. sleepUntil + cancelOn                        | C. Evento con `ts` futuro                                      | **D. B + reconcile diario**                           |
| ---------------------------------------- | -------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| Corre una vez, a la hora                 | sí (en la grilla)                            | sí, exacto                                      | sí, exacto                                                     | sí, exacto                                            |
| Editar antes de la hora                  | sí                                           | sí (cancela el viejo)                           | sí, pero el evento viejo igual arranca un run que sale _stale_ | sí                                                    |
| Pausar / borrar                          | sí                                           | sí                                              | sí (run _stale_ por cada evento viejo)                         | sí                                                    |
| Acción repetida                          | sí                                           | sí (id con versión)                             | sí (id con versión)                                            | sí                                                    |
| Paso que tira error                      | reintenta; si se agotan, la pasada siguiente | reintenta; si se agotan, **la cadena se corta** | igual que B                                                    | reintenta; si se agotan, la recupera el reconcile     |
| Inngest pierde la programación           | no aplica                                    | **la tarea no vuelve a correr**                 | **igual**                                                      | la recupera la pasada siguiente (corre tarde una vez) |
| Runs/día con 0 / 10 / 100 tareas diarias | 96 / 96 / 96                                 | 0 / 10 / 100                                    | 0 / 10 / 100                                                   | 1 / 11 / 101                                          |
| Steps/día con 0 / 10 / 100               | 96 / 106 / 192                               | 0 / 50 / 500                                    | 0 / 40 / 400                                                   | 2 / 53 / 503                                          |
| Cancelable / visible                     | —                                            | sí: run durmiendo en el dashboard               | no: no se puede cancelar un evento programado                  | sí                                                    |
| Límites que pesan                        | ninguno                                      | sleep máx. (tramos de 6 días)                   | horizonte máx. de `ts` (no verificado)                         | sleep máx.                                            |

Las cifras salen de ejecutar las cuatro opciones
(`lib/inngest/functions/ai-workflow-scheduling.compare.test.ts`, 42 tests en
verde): un modelo en proceso de Inngest (`tests/helpers/inngest-sim.ts`:
entrega con `ts`, dedupe de ids e `idempotency` por 24 h, `cancelOn` con `if`
o `match`, `step.run` memoizado con reintentos, `sleepUntil`, `sendEvent`,
cron) corre las definiciones reales de `ai-workflow-scheduler` y
`ai-workflows-reconcile` y las candidatas A y C sobre un store en memoria con
la misma idempotencia que `runs.ts`. Por opción: "fires exactly once per
occurrence, at the due time", "an edit before the due time drops the old
occurrence and runs the new one", "pause stops it and resume starts it again;
delete stops it", "a repeated create or edit (retried action) does not
double-run", "a step that throws is retried and still runs the occurrence
once", "after retries run out or Inngest loses the schedule, only A and D
recover" y el costo por día. Las funciones reales, además, con
`InngestTestEngine` (`@inngest/test` 1.0.0) en
`ai-workflow-scheduler.test.ts`.

**Por qué cadena de eventos y no un loop en un run.** El loop suma ~4–5 steps
por ocurrencia en un solo run ("B as one looping run grows by ~5 steps per
occurrence": 120 steps en 30 días, el tope de 1.000 a las ~250 ocurrencias) y
re-ejecuta toda su historia en cada paso. La cadena deja cada run en 4–5
steps y cualquier deploy toma la ocurrencia siguiente con el código nuevo.

**Por qué `if` y no `match` en `cancelOn`.** El SDK (`InngestFunction.getConfig`)
reemplaza `if` por `match` cuando están los dos. Con `match` solo, el
`changed` de una reanudación que llega después de su `scheduled` cancela la
programación nueva ("`match` alone would let the change event cancel the new
schedule it precedes"); con `version !=` no ("the shipped `if` keeps that
schedule alive").

**Por qué un id propio para las vencidas en el reconcile.** Se probó primero
con el mismo id de la programación: una tarea cuyo scheduler falló el mismo
día queda deduplicada (el evento original tiene menos de 24 h) y se
recupera recién un día después. Ahora una tarea vencida lleva
`…-reconcile-<fecha>`; una futura conserva su id. Costo: una tarea semanal o
mensual recibe un gemelo por ocurrencia (su evento tiene más de 24 h), que
pierde el compare-and-set y no corre nada ("D: a weekly task gets one
reconcile twin per occurrence").

**Versión.** `updated_at` (lo mueve el trigger `set_updated_at` en cada
escritura, también al avanzar `next_run_at`): sin columna nueva. No hay acción
de editar tarea: crear, pausar/reanudar y borrar anuncian el cambio, y una
edición futura tiene que llamar a `announceWorkflowChange`.

**Límites de Inngest** (inngest.com no era accesible desde esta sesión):
verificado en el SDK 4.25 — `cancelOn` con `if`/`match` y que `match` pisa a
`if`, `step.sleepUntil` acepta `Date`, `ts` es "milisegundos desde epoch,
default ahora", sin tope documentado en el tipo. Supuesto, sin verificar en la
doc: sleep máximo 7 días en Hobby y 1 año en planes pagos (por eso los tramos
de 6 días), 1.000 steps por run, dedupe de ids de evento por 24 h (ya lo
suponía `RESEND_WINDOW_MS`), y que un evento con `ts` futuro se entrega en
esa fecha con algún horizonte máximo (C queda descartada igual).

**Granularidad.** La grilla de 15 minutos (`runTimeSchema`, `CHECK
run_minute in (0, 15, 30, 45)`) queda como decisión de producto: el
scheduler duerme hasta el instante exacto, así que ahora podría ser cualquier
minuto.

**Descartado.** A (96 runs/día aunque no haya tareas, y atado a la grilla);
B sola y C (una programación perdida o un paso que agota reintentos deja la
tarea sin correr para siempre); C además no se puede cancelar y deja un run
_stale_ por cada edición; el loop de B (tope de steps); `singleton` por tarea
(semántica con runs dormidos sin verificar).
