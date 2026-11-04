# Sueldos, préstamos y almacenaje: guardas de vínculos, auditoría w10 (2026-11-04)

Ver [la decisión](../decisions/2026-11-04-tesoreria-prestamos-y-almacenaje-auditoria-w10.md).

- [x] **Un pago de sueldo no cambia de liquidación** (`20261104170000`).
- [x] **La marca de importación de un préstamo la pone solo el importador**,
      **una cuota no cambia de préstamo** y **una cuota pagada no cambia de
      número** (`20261104170001`).
- [x] **Un período de almacenaje con factura vigente no se borra**
      (`20261104170002`).
- [x] **El diálogo de almacenaje sigue la regla del servidor**: una reserva
      pendiente no cuenta como facturada, la superposición es por canal y el
      mensaje de re-vínculo manda a los comprobantes del cliente.
- [x] **El re-vínculo de una factura huérfana deja su `storage.invoiced`**
      con `relinked: true`.
- [ ] No verificado contra una base real: las tres migraciones y el pgTAP
      `treasury_loan_storage_w10`.
- [ ] Sigue abierto, como en w9: `storage_billing_runs` acepta PATCH de su
      período y sus totales para owner, admin y finance, y un INSERT directo
      de una reserva.
