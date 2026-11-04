# 2026-11-04 — Consultas de "Antes de promover" sobre el schema de hoy

**Decisión.** Cada consulta de **Antes de promover** (`docs/pendientes/antes-de-promover.md`)
corre sobre el schema de producción anterior a las migraciones que gatilla y
muestra lo que esas migraciones van a escribir: si la migración crea una
función o una columna, la consulta copia lo que calcula (`account_has_movements`
de `101100`, el cargo que resincroniza `102300`) y lee las columnas nuevas con
`to_jsonb(fila) ->> 'columna'`, que vale tanto antes como después de crearlas.
Lo que solo se puede ver con la migración aplicada (un asiento que quedó
`differs`) va como ítem **Después de promover** en su sección.

**Descartado.** Llamar a la función que crea la migración (falla en el schema
de hoy) o mostrar el importe actual en vez del que se va a escribir (no deja
ver qué cambia).
