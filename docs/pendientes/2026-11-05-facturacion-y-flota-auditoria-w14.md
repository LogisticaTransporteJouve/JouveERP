# Borradores sin ítems, ingreso de flota y totales de listados, auditoría w14 (2026-11-05)

Ver [la decisión](../decisions/2026-11-05-facturacion-y-flota-auditoria-w14.md).

- [x] **Un borrador sin ítems se marca fallido y libera lo que facturaba**
      (w14-s5 F1, `20261105100000`). Lo hace `issue-invoice-reconcile`
      después de 15 minutos. Los borradores sin ítems ya no ocupan el lote
      de reenvío. Resuelve el pendiente w13 del borrador sin ítems que
      quedaba en `invoices`
      ([w13](2026-11-05-facturacion-y-flota-auditoria-w13.md)): ahora queda
      fallido, con el motivo.
- [x] **La flota cuenta cada carga por la parte que su factura todavía
      factura** después de sus NC y ND (w14-s3 F1, `20261105100001`).
- [x] **El resumen de cargas de la IA deja afuera las canceladas y avisa las
      cargas sin flete** (w14-s3 F2).
- [x] **Los totales de Comprobantes y Recibos buscan el cliente como su
      listado** (w14-s1 F1, `20261105100002`).
- [ ] Escribir la cabecera y los ítems de `issueFiscalInvoiceAction` en un
      solo RPC transaccional, como `import_arca_issued_invoice`, para que el
      borrador sin ítems no pueda existir. Hoy lo resuelve el reconciliador
      15 minutos después; mientras tanto la fuente sigue retenida.
- [ ] Un remito interno facturado en Ventas: sus cargas siguen vinculadas
      al remito, no a la factura fiscal. Una NC fiscal contra esa factura no
      baja el ingreso de flota de esas cargas, porque la NC interna del
      remito no cuenta (w12). Para seguirla habría que leer la factura por
      `source_remito_id`.
- [ ] Por viaje, `v_trip_revenue` redondea a centavos el ingreso de cada
      viaje. El reparto por cliente de `ai_fleet_margin` redondea solo el
      total del cliente. Con una parte que no es exacta, la suma por camión
      y la suma por cliente pueden diferir en centavos.
- [ ] Cada cifra de flota llama a `shipment_invoice_billed_ratio` una vez
      por carga (antes `shipment_invoice_is_void`, con el mismo costo).
      `shipment_invoice_is_void` queda sin lectores en SQL: se puede borrar
      cuando ningún código que corra la necesite.
- [ ] No verificado contra una base real: las tres migraciones y los pgTAP
      `fail_itemless_invoice_drafts`, `fleet_revenue_billed_share`,
      `list_totals_name_pattern` y `fleet_revenue_void_invoice` (sus cifras
      con la NC parcial pasan de 100 a 58,68).
