SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

-- AI tasks are no longer polled every 15 minutes: each task's
-- ai-workflow-scheduler (Inngest) sleeps until its own next_run_at, and a
-- daily ai-workflows-reconcile re-schedules any task whose chain broke. Only
-- the table comment (20261016130000) still described the cron. No schema
-- change: updated_at, moved by the existing set_updated_at trigger, is the
-- version the scheduler compares.

comment on table public.ai_workflows is
  'Tareas de IA recurrentes de un usuario: un pedido en lenguaje natural con horario en hora de Buenos Aires. Un scheduler de Inngest por tarea duerme hasta next_run_at, encola la corrida en ai_workflow_runs y programa la siguiente; updated_at es la versión que invalida una programación vieja.';
