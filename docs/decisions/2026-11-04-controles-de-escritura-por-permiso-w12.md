# 2026-11-04 — Controles de escritura según el permiso de su acción (w12)

**Decisión.** Auditoría w12 (S8 F1–F5). Una pantalla muestra un botón o un
ítem de menú que escribe solo si el usuario tiene el permiso que pide su
server action, calculado con `userCan(ctx.access, …)` (roles menos
denegaciones). La página pasa `ctx.access` al componente (`actorAccess`),
como en Clientes y Proveedores. Quien solo lee ve la pantalla sin esos
controles; la action sigue siendo el control real.

- **Contabilidad** (`accounting:write`): Plan de cuentas (nueva cuenta,
  editar, agregar hija, borrar), Libro diario («Nuevo asiento»), Centros de
  costo (nuevo, editar, borrar), Cotización USD (cargar, borrar) y Ajuste
  por inflación (cargar coeficiente, generar asiento, desvincular, borrar).
  El contador externo (`fiscal_reader`) ve los libros sin controles de
  escritura.
- **Cargas** (`shipments:write`): «Nueva carga», «Editar», los cambios de
  estado y «Borrar». «Historial» queda para todos los que leen.
  «Facturar flete» pide además `invoices:issue`, como
  `invoiceFreightAction`: operaciones ya no lo ve.
- **Facturación de almacenaje**: «Facturar» pide `storage_billing:issue` e
  `invoices:issue`, como `invoiceStorageAction`.
- **Canal de «Facturar flete»**: con la carga sin canal, el diálogo lista
  solo los canales del lado del cliente (Ventas → fiscales, Otras ventas →
  internos) y elige el único, como el de almacenaje. Una carga con canal lo
  conserva.
- **Lecturas que fallan**: el Libro mayor no muestra totales (ni «Saldo
  final 0,00») mientras carga o si la lectura falló, y un refresco fallido
  conserva las filas ya leídas. En la revisión de un documento escaneado,
  si no se pudo leer la extracción, el visor y el panel muestran el error
  con «Reintentar» (que vuelve a leer la extracción) y no se inventa un
  estado.

**Rollback.** Solo código de la app, sin migración: volver atrás vuelve a
mostrar los controles, y las actions los siguen rechazando.
