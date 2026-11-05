# 2026-11-05 — Las guardas de liquidaciones valen para todos y la flota usa la regla de factura anulada (w13)

**Decisión.** Auditoría w13, frente T1 (w13-s2 F1, w13-s3 F1, w13-s1 F1,
w13-s6 F3 y F4, w13-s5 F1). Sigue la
[decisión w12](2026-11-04-cargas-y-liquidaciones-vinculo-de-factura-w12.md).

- **Guardas de liquidación y rendición** (`20261105090000`).
  `guard_shipment_freight_settlement`, `guard_shipment_driver_settlement` y
  `guard_trip_driver_settlement` pasan a `SECURITY DEFINER`, con el mismo
  cuerpo. Buscaban la liquidación o la rendición de la carga en tablas que
  operaciones no lee, así que para operaciones no encontraban nada y
  dejaban pasar el cambio. Ahora una carga de una liquidación o rendición
  viva conserva cliente, estado, flete o cobranza y viaje, y su viaje
  conserva el chofer, edite quien edite. Es el mismo arreglo que w12 hizo
  con `guard_billed_shipment`.
- **Ingreso de flota** (`20261105090001`). Una carga cuenta como facturada
  si está vinculada a una factura que todavía la factura
  (`billing_invoice_is_void` falso). Vale para `v_trip_revenue`,
  `ai_fleet_margin` (por viaje, chofer, vehículo y cliente) y el conteo de
  facturadas de `ai_shipments_summary`. Una carga con su factura fiscal
  acreditada por el total ya no suma su flete como ingreso: cuenta como por
  facturar y el viaje se lee como no definitivo, igual que en la lista de
  cargas.
- **La regla se lee igual para todos.** Las vistas y funciones de flota son
  invoker, y operaciones lee cargas, viajes y «Rentabilidad de flota» pero
  no facturas. Por eso la regla pasa por `shipment_invoice_is_void`
  (`SECURITY DEFINER`): responde solo sí o no, solo por una carga y solo a
  los roles que leen cargas (owner, admin, operations) y al service role.
  La lista de cargas, por la misma razón, lee `billing_void_invoice_ids`
  con el cliente de servicio, después del chequeo de `shipments:read`, y
  solo por las facturas de las cargas que ya leyó.
- **Borrador sin ítems** (`lib/source-invoice-key.ts`). La cabecera y los
  ítems de una factura se escriben en dos pasos. Si el proceso muere entre
  ellos, queda un borrador que nadie envía. `findSourceInvoiceSlot` ya no
  lo toma como la factura viva de la carga o la liquidación: pasa a la
  clave siguiente, como ya hacía el re-vínculo de almacenaje. Mientras el
  primer «Facturar» escribe los ítems, la reserva de la carga o de la
  liquidación impide un segundo.

**Alternativas descartadas.**

- Dejar la regla invoker en las cifras de flota: operaciones vería como
  facturada una carga que la lista ya le muestra como libre.
- Liberar la carga al emitir la NC con un trigger sobre `invoices`: suma un
  escritor más de `shipments.invoice_id`. La próxima «Facturar flete» sigue
  siendo la que la desvincula.
- Reenviar el borrador sin ítems para que falle: depende de un evento de
  Inngest y del usuario que lo creó. Saltarlo no escribe nada.
