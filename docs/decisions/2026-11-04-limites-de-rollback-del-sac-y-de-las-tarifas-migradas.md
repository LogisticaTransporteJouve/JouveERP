# 2026-11-04 — Límites de rollback del SAC y de las tarifas migradas

**Decisión.** Dos cambios ya mergeados no toleran un rollback de código una
vez que se usan, y se documentan como límite operativo (en `pendientes.md`,
"Límites de rollback") en vez de mitigarse en el schema:

- **SAC** (`20261103050100`): el código anterior a #315 busca el período por
  año y mes con `maybeSingle()`; con un período `kind = 'sac'` en junio o
  diciembre ve dos filas y la planilla de ese mes falla. No crear un SAC
  hasta que el deploy quede firme; con uno creado, no volver antes de #315.
- **Tarifas migradas** (`20261104080500`): la nota de rollback de la
  migración ("el código anterior puede editar el precio de una fila
  migrada") es falsa: `guard_storage_tariff_migrated` rechaza el cambio
  venga de donde venga. El "Aumentar %" anterior a #337 no filtra las
  migradas y su cierre por lotes falla entero (las no migradas del lote
  también), deja dos filas vigentes por cliente y avisa que aplicó. Con
  código anterior a #337 no se usa "Aumentar %". La migración mergeada no se
  edita; la corrección vive acá y en `pendientes.md`.

**Descartado.** Que el guard saltee en silencio (`return null`) el cierre de
una fila migrada: convertiría también una edición del código nuevo en un
"ok" sin efecto, y el cliente migrado igual no quedaría aumentado (el
tarifario pisa la fila nueva). Para el SAC no hay mitigación de schema que
no rompa el código nuevo: la consulta vieja no filtra por `kind` y lee la
tabla directo. Estampar migraciones a futuro (ver `CONTRIBUTING.md`,
Migraciones): bloquea `pnpm db:restamp` y toda migración nueva hasta que el
reloj pasa el máximo de `main`; se estampa con la hora UTC real.
