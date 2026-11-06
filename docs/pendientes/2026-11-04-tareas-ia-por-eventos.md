# Tareas IA por eventos (2026-11-04)

- [x] Sin polling: `ai-workflow-scheduler` duerme hasta el `next_run_at` de
      cada tarea, `cancelOn` + _stale guard_ ante crear, pausar, reanudar o
      borrar, y `ai-workflows-reconcile` diario (04:52 AR) reemplaza al cron
      `ai-workflows-materialize` cada 15 min. Comparación de opciones,
      evidencia y límites en
      `docs/decisions/2026-11-04-tareas-ia-programacion-por-eventos-en-vez-de-polling.md`.
- [x] **Después de promover:** correr `ai-workflows-reconcile` a mano desde el
      dashboard de Inngest. Las tareas existentes no tienen scheduler
      durmiendo; sin la corrida manual, las que vencen antes de la primera
      pasada de las 04:52 corren tarde, en esa pasada. Lo mismo después de
      un rollback y vuelta adelante. — hecho: corrido el 2026-11-05 14:27, run `01M6PC04YZSG7F9SGTBTTT9NFR` (`antes-de-promover.md`).
- [x] Rollback: el código anterior vuelve a registrar el cron de 15 min y
      no conoce `ai-workflow-scheduler`; los runs dormidos fallan al
      despertar (función inexistente) y el cron cubre esas tareas. Sin
      cambio de schema (la migración `20261104120600` solo cambia el
      comentario de la tabla). — ya no aplica: `ai-workflow-scheduler` ya está en `production-latest` (`bbe08b38`): un rollback vuelve a un SHA que ya lo tiene.
- [ ] No verificado contra Inngest real (sin dev server en esta sesión ni
      acceso a inngest.com): el comportamiento se probó con
      `InngestTestEngine` y el modelo `tests/helpers/inngest-sim.ts`. Los
      límites de sleep (7 días Hobby), 1.000 steps y dedupe de 24 h son
      supuestos de la doc, no verificados.
- [ ] Editar una tarea (título, pedido u horario) no existe todavía; cuando
      se agregue, tiene que llamar a `announceWorkflowChange`.
