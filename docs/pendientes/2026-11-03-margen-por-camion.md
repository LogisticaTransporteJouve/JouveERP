# Margen por camión (2026-11-03)

- [ ] Aprobar la migración `20261104050000_vehicle_margin` junto con el
      deploy: sin ella fallan la sección "Margen por camión", el vínculo en
      Centros de costo y `getVehicleEconomics` con permiso de gestión. Rollback:
      el código anterior no lee `cost_centers.vehicle_id` ni llama a
      `get_vehicle_margin`.
- [ ] Vincular cada camión con su centro en Contabilidad › Centros de costo
      (dato, no código).
- [ ] Una carga de combustible que apunta solo al pago (OP) y no a la compra
      cuenta dos veces si la compra lleva el centro del camión; un
      `trips.cost` cargado también como compra con ese centro, igual.
- [x] Lo "Sin clasificar" cargado con el centro del camión entra en su costo
      de centro (`20261104092100`); antes no estaba en ninguna fila.
- [ ] El margen por camión es siempre devengado y nominal (no sigue la base ni
      el ajuste por inflación de la pantalla).
- [x] En devengado, un desembolso de préstamo en USD sin cotización ya no
      aparece en "USD sin cotización" (`20261104102000`); tampoco los
      movimientos de cheques, ajustes de saldo inicial ni pagos de impuestos.
- [ ] El "USD sin cotización" de un centro suma ingresos y costos pendientes
      juntos (`get_vehicle_margin`, columna `pending`); debería mostrar solo
      los costos.
