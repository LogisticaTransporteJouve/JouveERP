# 2026-11-04 — Presupuesto de ejecuciones de Inngest

**Decisión.** El plan gratis de Inngest da 50.000 ejecuciones por mes, y
cuenta cada corrida más cada paso. Un cron frecuente que casi nunca encuentra
trabajo lee todo en un solo paso, o lo hace sin pasos cuando hace una sola
cosa (el reintento de la función alcanza). `issue-invoice-reconcile` lee todo
en un paso: de 4 a 2 ejecuciones por corrida vacía.

**Por qué.** Al ritmo del 2026-11-04 eran ~110.000 por mes, el doble del
límite. ~86.000 eran de `search-index-refresh` (cada minuto con un paso), que
se va con la búsqueda global que el owner decidió sacar. Sin ella, quedan
~26.000.

**Descartado.** Bajar la frecuencia de `arca-issued-sync` y de las tareas de
IA: cambia cuándo ve el usuario lo nuevo, y no hace falta.
