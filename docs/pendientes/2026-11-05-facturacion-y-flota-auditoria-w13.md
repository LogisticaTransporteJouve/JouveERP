# Vínculos de facturación y flota, auditoría w13 (2026-11-05)

Ver [la decisión](../decisions/2026-11-05-facturacion-y-flota-auditoria-w13.md).

- [x] **Operaciones ya no edita una carga de una liquidación o rendición
      viva, ni cambia el chofer de su viaje** (w13-s2 F1, `20261105090000`).
      Las tres guardas corren como `SECURITY DEFINER`.
- [x] **Una carga cuya factura ya no la factura cuenta como por facturar**
      en la rentabilidad de flota, el margen por camión, las herramientas de
      flota de la IA y el resumen de cargas (w13-s3 F1, w13-s1 F1,
      w13-s6 F4, `20261105090001`).
- [x] **Un borrador sin ítems no es la factura viva de una carga o una
      liquidación** (w13-s5 F1): `findSourceInvoiceSlot` pasa a la clave
      siguiente.
- [x] **La marca «factura anulada» de la lista de cargas no depende de quien
      mira** (w13-s6 F3): se lee con el cliente de servicio.
- [x] Corregido el pendiente w12 que decía «ingreso cero»
      ([w12](2026-11-04-cargas-y-liquidaciones-vinculo-de-factura-w12.md)).
- [x] No verificado contra una base real: las dos migraciones y los pgTAP
      `settlement_guards_definer`, `fleet_revenue_void_invoice` y los de
      margen de flota, liquidaciones y rendiciones que ya existían. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
- [x] El borrador sin ítems que quedó bajo la clave anterior sigue en
      `invoices` como borrador: nadie lo envía ni lo puede anular desde la
      app. No factura nada (no tiene ítems ni CAE), pero aparece en la lista
      de comprobantes. Borrarlo a mano o con un barrido es una decisión
      aparte. — hecho: `issue-invoice-reconcile` marca fallido el borrador sin ítems (`20261105100000_fail_itemless_invoice_drafts.sql`).
- [x] Las cifras de flota llaman a `shipment_invoice_is_void` una vez por
      carga facturada. Con el volumen de hoy no pesa; si la rentabilidad se
      vuelve lenta, materializar la regla en una columna es el siguiente
      paso. — ya no aplica: las cifras de flota ya no llaman a `shipment_invoice_is_void` (sin lectores, `20261105130000_billing_void_note_chain.sql:36`); el costo por carga sigue en el ítem de `shipment_invoice_billed_ratio` (w14).
