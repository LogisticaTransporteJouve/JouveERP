# 2026-11-03 — Remitos únicos y tarifarios por cliente (4.1 + 4.2)

**Decisión (4.1).** El remito del cliente vive en la carga
(`shipments.remito_number`), no en una entidad aparte. Es único por cliente
entre las cargas no canceladas, comparado sin mayúsculas ni espacios en los
bordes, con un índice único parcial: la columna es nueva, así que no hay
duplicados previos que limpiar. Una carga cancelada libera el número (puede
volver en la carga que la reemplaza); sacarla de cancelada mientras otra
tiene su número falla. El formulario consulta `shipment_remito_conflict`
mientras se escribe, muestra la carga que ya lo tiene y no deja guardar.

**Decisión (4.2).** Tabla nueva `client_tariffs` (concepto almacenaje/carga/
descarga, unidad, precio, ARS/USD, vigencia inclusive) en lugar de agregar
columnas a `storage_tariffs`: un precio por concepto deja cambiar solo la
descarga sin duplicar el resto. Sin superposición por cliente y concepto, con
un trigger guard bajo lock (no `exclude using gist`, que pide `btree_gist`).
La facturación de almacenaje cobra cada día con la tarifa del cliente vigente
ese día (y carga/descarga con la del día de ingreso/egreso) y usa
`storage_tariffs` para el resto, así un cambio de precio a mitad de mes se
prorratea. USD se convierte al oficial del último día del período facturado o
el anterior; sin cotización no se factura. Permisos: los de almacenaje
(`storage_billing:read`/`issue`, RLS owner/admin/finance), sin permiso nuevo.

**Descartado.** Migrar las tarifas de `storage_tariffs` con cliente al
tarifario en esta tanda (cambia lo que se factura sin que nadie lo cargue);
concepto flete (el flete de la carga sigue a mano); cobrar con la general
los días de una tarifa en USD sin cotización.
