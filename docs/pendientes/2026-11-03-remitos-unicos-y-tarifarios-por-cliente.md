# Remitos únicos y tarifarios por cliente (2026-11-03, roadmap 4.1 + 4.2)

- [x] **Remito del cliente en la carga** (`shipments.remito_number`): único
      por cliente entre las cargas no canceladas, sin distinguir mayúsculas ni
      espacios (índice `shipments_client_remito_unique`). El diálogo de carga
      avisa mientras se escribe (`shipment_remito_conflict`) y no deja guardar
      un repetido; el índice lo rechaza igual. Una carga cancelada libera su
      número.
- [x] **Tarifario por cliente** (`client_tariffs`): concepto (almacenaje,
      carga, descarga), unidad, precio, ARS/USD y vigencia, sin superposición
      por cliente y concepto (guard `guard_client_tariff_overlap`); RPC
      `client_tariff_at(cliente, concepto, fecha)`. Pestaña **Tarifario** en el
      detalle del cliente (`storage_billing:read`, edición con
      `storage_billing:issue`).
- [x] **Facturación de almacenaje** usa el tarifario del cliente día por día
      (carga el día de ingreso, descarga el de egreso) y cae a
      `storage_tariffs` (la del cliente, después la general) en lo que no
      cubre. USD al oficial del último día del período (o el anterior); sin
      cotización la preview lo marca y la factura no se emite.
- [x] Aprobar las migraciones `20261103080000_shipment_remito_number` y
      `20261103080100_client_tariffs` junto con el deploy: sin ellas fallan
      el listado de cargas (columna `remito_number`), la pestaña Tarifario y la
      facturación de almacenaje (lee `client_tariffs`). — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [ ] Tarifas de cliente en `storage_tariffs` que no pasaron al tarifario
      (más de una fila activa, con fin de vigencia o un cliente que ya tenía
      tarifario): pasarlas a mano revisando cada una
      (`20261104080500`). Las que pasaron quedan como respaldo congelado.
- [ ] Crear la carga desde un remito escaneado (hoy el escaneo muestra las
      cargas con ese remito y lleva a Cargas).
