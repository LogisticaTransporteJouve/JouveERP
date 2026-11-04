# Follow-ups de operaciones (2026-11-04, roadmap 4.x)

- [x] **Rendiciones:** varios medios de pago por carga; PDF interno de la
      rendición; listado paginado; "Asentar diferencia al chofer" (desde
      2026-11-04: "Resolver diferencia", ver arriba); marca de recibos anulados o editados en Recibos.
- [x] **Liquidaciones:** "Liquidar período" (una por cliente, en borrador o
      confirmadas por `confirm_freight_settlement_document`); envío del
      remito R por email (el X de Otras ventas va como su comprobante);
      la reserva para facturar se libera en el acto si la factura ya falló.
- [x] **Cheques vendidos:** anular una venta cargada por error (sin cheques
      movidos y con el período abierto); rechazo sin débito como deuda con el
      comprador que se paga después; pasivo contingente y deuda en Tesorería.
- [x] **Mora:** prorrateo de pagos y NC en el período (saldo diario); varias
      ND de una vez (cada una idempotente).
- [x] **Depósito:** tarifa general por área (precedencia en
      `20261104080400`); lote y área en el export y la trazabilidad;
      historial de bloqueos y desbloqueos con motivo.
- [x] **Cargas y tarifas:** búsqueda por remito; el escaneo de un remito
      muestra su carga; el flete de una carga nueva sale de la tarifa de flete
      del cliente; las tarifas de cliente de `storage_tariffs` que facturan
      igual pasan al tarifario.
- [x] **IA:** `getFreightSettlements` y `getDriverSettlements` (lectura).
- [ ] Aprobar las migraciones `20261104080000`–`20261104080500` junto con el
      deploy (después de `20261104030000`): sin ellas fallan el listado de
      rendiciones (columna `driver_settlement_id`), `/aging/mora`
      (`balance_days`), las ventas de cheques (`status`), las tarifas de
      almacenaje (`area_id`, `migrated_to_client_tariffs_at`), el historial de
      bloqueos y el envío de liquidaciones por email.
- [ ] pgTAP verde en CI (stack fresco: `driver_settlement_differences`,
      `check_sale_followups`, `late_interest_proration`, `deposit_followups`,
      `storage_tariffs_to_client_tariffs`); sin verificar contra datos de
      producción ni en el navegador: las migraciones y las pantallas.
- [ ] Rollback: el código anterior factura una tarifa general por área como
      general de todas las áreas (no cargarlas hasta que el deploy quede
      firme) y cobra la mora sobre el saldo de hoy. No edita las tarifas
      migradas ni cierra bien con "Aumentar %": ver "Límites de rollback".
