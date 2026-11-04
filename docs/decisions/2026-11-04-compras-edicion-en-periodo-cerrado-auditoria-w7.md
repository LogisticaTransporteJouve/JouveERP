# 2026-11-04 — Compras: la edición en período cerrado se decide antes de escribir

**Decisión 1: la regla de ítems en período cerrado se pregunta antes del
encabezado.** El encabezado y los ítems de una compra son dos escrituras
(un PATCH y `replace_purchase_invoice_items`). En vez de juntarlas en una RPC
(el PATCH tiene ~30 campos opcionales), la regla de la RPC pasó a una función
de solo lectura, `purchase_items_change_refused`, que la acción llama antes
del PATCH y la RPC sigue llamando adentro. Un rechazo no escribe nada. Si los
ítems fallan igual después del encabezado (una carrera), la acción audita lo
guardado y lo dice.

**Decisión 2: los ítems que el usuario no toca se guardan como están.** El
formulario de edición carga el neto, el IVA y el total guardados de cada ítem
y los vuelve a mandar mientras no cambien la cantidad, el precio o la
alícuota; recalcula neto × alícuota solo en la línea editada. Una compra de
ARCA guarda el IVA de ARCA y una edición de notas no debe cambiarlo. Cambiar
solo la descripción no recalcula.

**Decisión 3: sin leer los ítems, no se mandan.** `items: []` borra los
ítems; se manda solo si se leyeron y el usuario apagó «con detalle». Mientras
cargan o si falló la lectura, la casilla queda deshabilitada y no se mandan.

**Decisión 4: el CUIT de un proveedor con compras en un período cerrado no
cambia.** Se rechaza en la base (trigger en `suppliers`, `SECURITY DEFINER`
para ver las compras aunque el rol que edita no las lea), así cubre cualquier
escritura y no solo la acción. Se prefirió rechazar a
"congelar" el CUIT en cada compra: corregir un CUIT mal cargado sigue siendo
posible reabriendo el período.

**Descartado.** Deshabilitar «Guardar» hasta que lleguen los ítems: frenaba
editar notas cuando la lectura de ítems falla, sin necesidad.
