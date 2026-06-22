-- HR gap #4 (docs/hr-patterns.md §9): alinear el tope de `hours_lost` con la
-- regla de dominio. El Zod del action valida ≤ 24 (horas perdidas en UN día),
-- pero la columna `numeric(5,2)` admitía hasta 999.99 — defensa en profundidad
-- faltante. attendance_records es una fila por (empleado, día), así que el
-- máximo razonable es 24.
--
-- Solo agrega un check constraint; no cambia tipos. Las filas existentes ya
-- cumplen (todas las escrituras pasaron por el Zod ≤ 24).

set row_security = off;

alter table public.attendance_records
  add constraint attendance_records_hours_lost_max
  check (hours_lost is null or hours_lost <= 24);
