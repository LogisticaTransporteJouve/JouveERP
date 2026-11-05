# Notas de rollback w11 y controles por permiso (auditoría w12, 2026-11-04)

Auditoría w12, S4. Las migraciones ya están en `main` y no se editan. Lo que
dicen mal sus encabezados sobre un rollback a `production-latest` se corrige
acá. Sus ítems «Aprobar» están en [`antes-de-promover.md`](antes-de-promover.md),
que ya tiene el texto corregido.

## Encabezados de migraciones mergeadas (w12 S7 F2)

- [ ] **`20261104190201_purchase_nc_nd_follow_factura_edit`** (líneas 25-26).
      Dice "older code writes the same columns; the NC/ND follow". No es así:
      `updatePurchaseInvoiceAction` de `production-latest` no manda
      `account_id` ni `cost_center_id`, y el trigger es `after update of
      account_id, cost_center_id`. Con el código anterior el trigger no corre
      y ninguna NC/ND se mueve. El rollback no cambia nada.
- [ ] **`20261104190300_shipment_invoice_link_guard`** (líneas 33-36). Dice
      que el próximo «Facturar flete» emite «under the next key». El
      `issueFreightInvoice` de `production-latest` no manda clave de
      idempotencia, así que `issueFiscalInvoiceAction` usa una al azar
      (`findSourceInvoiceSlot` no existe ahí). Su aviso dice «La factura se
      emitió pero no se vinculó…» aunque la factura falló (cosmético). La
      reserva de 15 minutos sí es correcta. El mismo texto («emite con la
      clave siguiente») está en el párrafo de rollback de
      [`2026-11-04-tesoreria-vinculos-de-facturacion-auditoria-w11.md`](../decisions/2026-11-04-tesoreria-vinculos-de-facturacion-auditoria-w11.md):
      vale para `main`, no para `production-latest`.
- [ ] **`20261104190302_check_import_run_guard`** (líneas 31-32). Dice "older
      code writes the column only through commit_import_run".
      `production-latest` no tiene importador (`commit_import_run` nace en
      `20261103110000`) y nunca escribe `checks.import_run_id`.
- `20261104190200`: el ítem de `antes-de-promover.md` decía que el código
  anterior lee las filas por nombre. `production-latest` no llama a
  `get_vehicle_margin`. Corregido ahí; el encabezado de la migración no lo
  dice.

## Pendiente: historial de almacenaje con más de 1000 períodos anulados (w12 S6 F3)

- [ ] `listStorageBillingRunsAction` lee `storage_billing_void_run_ids` (setof
      uuid) en una sola llamada. PostgREST corta la respuesta en
      `max_rows = 1000` sin error. Pasado ese número, algunos períodos
      liberados se siguen mostrando como facturados en el historial y en el
      diálogo de «Facturar». No se corrigió en w12: paginarla necesita un
      orden total, y no se pudo comprobar (sin servidor ni documentación de
      PostgREST a mano) que PostgREST acepte `order=storage_billing_void_run_ids`
      sobre una función que devuelve escalares. Si no lo acepta, la lectura
      falla entera y el historial deja de verse. Arreglo propuesto, con
      migración: que la función devuelva `table (id uuid)` (o que el
      historial lea una vista con una columna `is_void` por período) y
      paginarla con `.order("id")` como los períodos. Hoy no hay períodos de
      almacenaje en producción.

## Controles por permiso (w12 S8 F1–F2)

Hecho en código, sin migración: ver
[`../decisions/2026-11-04-controles-de-escritura-por-permiso-w12.md`](../decisions/2026-11-04-controles-de-escritura-por-permiso-w12.md).
