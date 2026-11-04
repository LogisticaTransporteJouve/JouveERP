# Bases contables: costo con rubro y centro (roadmap 1.1 + 1.2 + 1.8, 2026-11-02)

- [x] **Compras con cuenta de gasto y centro de costo** (fiscal e interno, alta
      y edición). Default: el del proveedor; si no tiene, la sugerencia de la
      IA del escaneo. La base rechaza una cuenta que no sea hoja activa de
      resultado negativo.
- [x] **Proveedor con cuenta de gasto y centro de costo por defecto**, en su
      ficha.
- [x] **Egreso manual de caja con cuenta de gasto y centro** (alta y edición):
      asienta contra esa cuenta en vez de `gastos`; sin cuenta, igual que
      antes. Los movimientos de documentos no la llevan.
- [x] **Resultado de gestión por centro de costo:** filtro y tabla "Por
      centro de costo"; la herramienta de IA `getManagementPnL` también.
- [ ] **Centro de costo del camión en combustible y mantenimiento.** El
      camión ya tiene centro (`cost_centers.vehicle_id`, margen por camión);
      falta que vincular una carga o un service a una compra sin centro le
      ponga el del camión.
- [ ] **Percibido por centro para pagos con OP:** el movimiento de la OP no
      lleva el centro de las compras que paga (podría repartirse por
      imputación).
- [ ] **Compras y egresos cargados antes** quedan sin cuenta ni centro (van a
      `compras`/`gastos` y a "Sin centro"): no hay backfill; se corrigen
      editándolos en un período abierto.
- [ ] Cuenta de gasto por ítem de compra (hoy la compra entera va a una
      cuenta): solo si aparece un caso real.
