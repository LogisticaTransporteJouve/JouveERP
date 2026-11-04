# 2026-11-04 — Se retira la búsqueda global (⌘K)

**Decisión (owner).** Sale la búsqueda global: el botón y el atajo ⌘K del
topbar, su diálogo, `searchGlobalAction`, la herramienta `searchGlobal` del
AI CFO y la función Inngest `search-index-refresh`. Nadie la va a usar todavía.
⌘K queda solo para la búsqueda de chat, dentro de `/chat`. El AI CFO encuentra
clientes, proveedores y empleados con `searchClients` / `searchSuppliers` /
`searchEmployees`.

**Por qué.** Mantenerla cuesta (un cron por minuto que refresca la vista
materializada, y cada módulo nuevo tiene que sumarse al índice y a los
permisos por tipo) sin un uso hoy. La herramienta del AI CFO se va con ella:
sin el cron, `search_index` deja de refrescarse y respondería con datos
viejos, y el contrato posterior borra `search_global`.

**Expand/contract.** Este cambio es solo código. Quedan en la DB la vista
materializada `search_index`, `search_global`, `refresh_search_index*`, los
triggers `search_index_mark_dirty` y `search_index_state`, para que un
rollback a un SHA anterior siga buscando (su cron vuelve a refrescar el
índice). Se borran en una migración de contrato cuando la próxima promoción
quede firme (`docs/pendientes.md`).

**Descartado.** Dejar la herramienta `searchGlobal` del AI CFO sola: leería un
índice que ya nadie refresca. Borrar los objetos de la DB en el mismo cambio:
rompe el rollback de código.
