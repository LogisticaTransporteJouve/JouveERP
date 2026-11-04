# Vínculos de facturación de fletes y almacenaje, auditoría w11 (2026-11-04)

Ver [la decisión](../decisions/2026-11-04-tesoreria-vinculos-de-facturacion-auditoria-w11.md).

- [x] **Una carga se vincula solo a una factura vigente de su cliente**
      (`20261104190000`). Si el vínculo se rechaza por una factura fallida,
      «Facturar flete» libera la carga.
- [x] **Una factura fiscal de almacenaje con NC por el total libera su
      período** (`20261104190001`). Aplica a la reserva, a la guarda de
      borrado y al historial. El mensaje de la guarda ahora es cierto.
- [x] **Un período facturado no suelta su factura** (`20261104190001`).
- [x] **La marca de importación de un cheque la pone solo el importador**
      (`20261104190002`).
- [x] **El re-vínculo de otro período o canal deja su `storage.invoiced`**.
- [x] **«Facturar almacenaje» ofrece solo los canales del lado del
      cliente** y preselecciona el único.
- [ ] No verificado contra una base real: las tres migraciones y los pgTAP
      `billing_links_w11`, `treasury_loan_storage_w10` (mensaje nuevo),
      `management_cash_checks` (desactiva `checks_guard_import_run` para su
      cheque importado a mano) y los demás que escriben estas tablas.
- [ ] `storage_billing_void_run_ids` devuelve hasta `max_rows` (1000) filas
      sin paginar. Si se pasara, un período con NC total figuraría facturado
      en el diálogo; la reserva igual lo libera. Hoy no llega ni cerca: la
      próxima reserva de cada cliente borra los suyos.
- [ ] Sigue abierto, como en w9 y w10: `storage_billing_runs` acepta PATCH
      de su período y sus totales para owner, admin y finance, y un INSERT
      directo de una reserva. La misma marca de importación de `clients`,
      `suppliers`, `employees`, `drivers`, `vehicles`, `client_tariffs`,
      `client_opening_balances` y `fleet_documents` sigue abierta a PATCH;
      ahí solo acota `undo_import_run`, que es de owner/admin.
