# Cargas y viajes: En curso automático, acompañante y filtros (2026-11-12)

Parte H del plan «DZ y sueldos» (E–I), sobre la limpieza de Cargas y Viajes que ya está en la
rama (formularios de 4 campos, sin Liquidaciones, Rendiciones, contra entrega ni «Facturar flete»).

## H — lo que entra

- [x] **Migraciones** `20261112120000_trip_companion` (`trips.companion_employee_id`, FK a
      `employees` con `on delete set null`, índice parcial) y `20261112120100_shipment_auto_start`:
      `sync_shipment_trip_status(ids, actor)` (SECURITY DEFINER, solo `service_role`) pone
      **En curso** las cargas de un viaje no cancelado con fecha de hoy o anterior (hora argentina)
      y, solo para las cargas que recibe, vuelve a **No iniciada** las que ya no están en un viaje
      de hoy; `change_shipment_status` reprogramar una carga En curso pide la fecha, la vuelve a No
      iniciada y la saca del viaje (dos filas de historial). pgTAP en `shipments_status_test`.
- [x] **Cron diario** `shipments-auto-start` (00:07 hora argentina) y sincronización inmediata
      después de asignar o quitar cargas, crear un viaje con cargas, cambiar la fecha o el estado
      de un viaje, borrarlo o crear una carga en un viaje. Si la sincronización falla, la acción
      igual guarda y avisa «Se guardó, pero no se actualizó el estado de las cargas.»; el cron
      arregla las que tenían que empezar.
- [x] «Nuevo viaje» con **Acompañante** (empleado activo, sin permiso de RRHH) y **Cargas sin
      viaje**; columna Acompañante en Viajes; filtros de Cargas (Fecha programada, Estado, Cliente,
      Viaje) en la URL y en el servidor; `getShipments` del asistente con `statuses` y `assigned`;
      `proposeShipmentStatus` ya no ofrece iniciar; `proposeTrip` acepta acompañante; se retiró el
      insight `trip_margin` (el tipo queda para limpiar tarjetas abiertas).
- [ ] Aprobar las dos migraciones con el deploy. Rollback (el SQL queda): el código anterior
      ignora `companion_employee_id`, no llama a la sincronización (sin el cron, las cargas ya no
      empiezan solas) y muestra `in_progress` como «En progreso». Llama a `change_shipment_status`
      con los mismos argumentos; reprogramar una carga En curso sin fecha nueva lo rechaza el SQL
      («Indicá la nueva fecha.»).

## Contrato (después de promover, un release más tarde)

Columnas que la app ya no escribe, a borrar en una migración de contrato cuando el
código que las usaba no pueda volver:

- `shipments`: `origin`, `remito_number`, `freight_amount`, `cod_amount`, `notes`, `channel_id`.
- `trips`: `channel_id`, `origin`, `destination`, `cargo_description`, `km`, `revenue`, `cost`,
  `notes`.
- `claim_shipment_for_invoicing` si nada lo llama.

**No** se borran `shipments.destination` (es la «Dirección» de la carga) ni el estado
`in_progress` (es el En curso automático).

Antes de borrar: `remito_number` lo leen todavía el filtro `remito` de `listShipmentsAction`, el
asistente y Document Intelligence (remitos viejos); `getTripDetail` y el selector de viaje de
Combustible muestran `origin`/`destination` de viajes viejos solo si los tienen; `getVehicleUsage`
y `getTripDetail` leen `km`. Esos lectores se sacan en el mismo PR del contrato.
