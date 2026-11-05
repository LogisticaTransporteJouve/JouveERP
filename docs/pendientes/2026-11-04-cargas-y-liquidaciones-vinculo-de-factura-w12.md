# Cargas y liquidaciones: vínculo de factura, auditoría w12 (2026-11-04)

Ver [la decisión](../decisions/2026-11-04-cargas-y-liquidaciones-vinculo-de-factura-w12.md).

- [x] **Una carga cuya factura fiscal se acreditó por el total se libera**
      en su próxima «Facturar flete» (`20261104194000`), y se puede corregir
      o borrar antes.
- [x] **Una carga facturada no suelta su factura por PATCH**, y solo owner,
      admin, finance o el service role vinculan una (`20261104194000`).
- [x] **Una NC interna no libera una liquidación** (`20261104194000`).
- [x] **Solo los períodos que re-vinculó la reserva llevan `storage.invoiced`
      con `relinked`** (`20261104194001`).
- [ ] No verificado contra una base real: las dos migraciones y los pgTAP
      `carga_billing_link_w12`, `freight_settlements` (mensaje nuevo),
      `billing_links_w11`, `billing_claims` y los de margen de flota que
      insertan cargas facturadas.
- [ ] Hasta su próxima «Facturar flete», una carga con su factura fiscal
      acreditada por el total sigue apuntando a esa factura. Mientras tanto:
  - no entra en una liquidación (`guard_freight_settlement_item` y la lista
    de cargas a liquidar piden `invoice_id` nulo);
  - ~~el margen por camión y las cargas por facturar la cuentan como
    facturada, con ingreso cero (la factura menos la NC).~~ Corrección
    (auditoría w13): las contaban como facturada con **todo su flete** como
    ingreso (ninguna cifra de flota resta la NC), y el viaje se leía como
    definitivo. Resuelto en `20261105090001`: ahora cuentan como por
    facturar
    ([w13](2026-11-05-facturacion-y-flota-auditoria-w13.md)).

  Liberarla al emitir la NC (un trigger sobre `invoices`) lo resolvería,
  pero agrega un escritor más sobre `shipments.invoice_id`.

- [ ] Una liquidación cuyo remito interno se facturó en Ventas: la NC
      interna de ese pase ya no libera la liquidación. Si después la factura
      de Ventas se acredita por el total, el remito sigue congelado
      (`guard_billed_remito_frozen` mira solo que la factura esté vigente) y
      la liquidación no se puede cancelar. Antes se podía cancelar aunque la
      factura de Ventas siguiera facturando sus cargas. Hoy no hay
      liquidaciones en producción.
- [ ] `link_freight_settlement_invoice` no rechaza una factura acreditada
      por el total. Si llegara a pasar, el vínculo de cada carga lo rechaza
      `shipments_guard_invoice` y se revierte la transacción entera.
