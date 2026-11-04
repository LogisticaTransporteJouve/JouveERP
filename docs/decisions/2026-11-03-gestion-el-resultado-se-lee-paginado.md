# 2026-11-03 — Gestión: el resultado se lee paginado

**Decisión.** `getManagementReportAction` y `getManagementPnlAction` leen
`get_management_pnl` de a 1000 filas, ordenado por toda la clave de
agrupación (mes, caja, subcaja, lado, cuenta, centro), hasta 50.000 filas; si
llega al tope la respuesta trae `partial` y la pantalla y la IA lo avisan.
`getManagementPnlAction` devuelve `{ rows, partial }`.

**Por qué.** PostgREST corta en 1000 filas sin error; mes × caja × cuenta ×
centro × lado puede pasarlas en un año con muchos centros.

**Descartado.** Agregar en el servidor (menos filas): la pantalla necesita la
apertura por cuenta y centro.
