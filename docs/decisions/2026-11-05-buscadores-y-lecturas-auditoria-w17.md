# 2026-11-05 — Buscadores de cliente y proveedor, lecturas fallidas y tomas del escaneo (w17)

**Decisión.** Auditoría w17 (S8 F1, F3; S5 F1, F2; S6 F2, F3; S3 F1 / S7 F3;
S7 F4). Solo código de la app, sin migración.

**Buscadores de cliente, proveedor y factura origen.**

- Una búsqueda fallida dice «No se pudieron buscar los clientes.» (o «…los
  proveedores.», «…las facturas.») con «Reintentar». Antes decía «Sin
  resultados. Probá creando un nuevo cliente.» e invitaba a cargarlo dos
  veces (un cliente de Otras ventas no tiene CUIT que lo frene).
- «Nuevo» (y «Crear proveedor «…»» de un escaneo) se ve solo con
  `clients:write` + `clients:read` (o `suppliers:write` + `suppliers:read`).
  Mientras no se sabe el permiso, no se ve. Sin permiso de alta, el texto
  vacío ya no sugiere crear.
- Sin `clients:read` (o `suppliers:read`) el buscador dice «No tenés permiso
  para ver clientes.» (o «…proveedores.») en vez de un buscador que falla.
  Al editar un recibo o una OP, ese usuario ve el mismo aviso y no «No se
  pudo leer el cliente del recibo.» con un «Reintentar» que no puede andar.
- El permiso lo leen `getClientPickerAccessAction` y
  `getSupplierPickerAccessAction` (por TanStack, 5 minutos). El servidor
  sigue rechazando la búsqueda y el alta sin permiso.
- Crear desde el buscador elige el creado. Si no se puede leer de vuelta,
  dice «El cliente se creó, pero no se pudo elegir: buscalo y elegilo.».

**Documentos.** Una lectura fallida de la lista dice «No se pudieron cargar
los documentos.» con «Reintentar», no «No hay documentos en este estado.».
La lista sigue trayendo los 100 más recientes de cada estado, y con 100
filas dice «Se muestran los 100 más recientes.».

**Detalle de factura, compra, recibo y orden de pago.** Una lectura fallida
va a la pantalla de error («Algo salió mal» con «Reintentar»). Solo un
comprobante que no está muestra «No encontramos lo que buscás».
`getInvoiceDetailAction` devuelve `data: null` cuando no lo encuentra (o el
`fiscal_reader` no lo ve), como las otras tres. El «Reintentar» del error del
dashboard usa `retry()` de Next, que vuelve a pedir los server components.
Un id mal formado en la URL ahora cae en la pantalla de error, no en «No
encontramos».

**Escaneo: tomas viejas.**

- La toma vieja se libera solo para el tipo de la acción: cheques en «Crear
  cheques en cartera» y factura de compra o NC/ND en el borrador de compra
  (filtro por `detected_type` en el mismo UPDATE). Antes, llamar a esas
  acciones con un recibo, una OP o una factura de venta tomados reabría el
  borrador y permitía crearlo de nuevo (una factura de venta pide CAE).
- En cheques, el vínculo final (`created_entity`) revisa el error y se
  reintenta una vez, como en los demás tipos. Si falla dos veces, el
  borrador queda tomado y se registra `ai.document.confirm.failed`.
- Una lectura fallida del borrador dice «No se pudo leer el documento.
  Reintentá.», no «No se encontró la extracción.». Una liberación fallida
  dice «No se pudo reabrir el documento. Reintentá.», no «ya fue procesado».

**AI CFO.** La descripción de `getFleetMargin` dice que el neto por vehículo
cuenta el combustible por su fecha en el rango y no es la suma de los netos
por viaje.

**Rollback.** Sin cambios de esquema. El código anterior no lee nada nuevo.
