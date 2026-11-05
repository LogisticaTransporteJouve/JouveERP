# Decisiones — Vencimiento de las ventas y tareas automáticas

Pendientes: `docs/pendientes/2026-11-05-vencimiento-de-ventas-y-tareas.md`.
Migraciones: `20261105200000`, `20261105200001`.

## Una venta vence 7 días después de su fecha

`20261105200000`. Todas las facturas de venta de producción vienen de ARCA, y
ARCA guarda `fch_vto_pago` vacío o igual a la fecha. Como la cobranza tomaba
`fch_vto_pago` (o la fecha si no tenía), cada factura abierta quedaba vencida
al día siguiente de emitirse: tarea «Cobranza vencida», aging vencido e
interés por mora desde el día 1.

Decisión del owner: un comprobante de venta (factura o ND) vence **7 días
después de su fecha**, salvo que traiga un vencimiento posterior.

```
vencimiento = fch_vto_pago   si fch_vto_pago > fecha
              fecha + 7      si no (vacío, igual o anterior)
```

- **Una sola regla:** `public.invoice_effective_due_date(fecha, fch_vto_pago)`.
  `v_aging_documents` la expone como `due_date` y cuenta `days_overdue` y
  `bucket` desde ahí. Todo lo que lee cobranzas sale de esa columna:
  `v_client_aging` y su versión por canal, las fotos del aging, la cuenta
  corriente del cliente, los intereses por mora (`late_interest_candidates`:
  vencimiento, desde cuándo se cobra y qué está vencido), el resumen de la IA
  (`ai_client_sales_summary.overdue_ars`, que antes usaba «fecha + 30» sin
  vencimiento), las tareas de cobranza y el flujo de caja (que ubica cada
  cobro en el mes de `due_date`).
- **El 7** está en la función SQL y en `SALES_INVOICE_DUE_DAYS`
  (`lib/aging.ts`), que solo lo usa para decirlo en textos. Un test de Vitest
  lee la función y falla si los dos difieren.
- **No se toca `fch_vto_pago`:** es dato fiscal. El detalle de la factura y el
  PDF siguen mostrando el «Vto. pago» de AFIP.
- **Los clientes no tienen plazo de pago:** si mañana lo tienen, entra en esta
  función y no en cada lector.
- **Compras no cambia:** los proveedores siguen con `fch_vto_pago` (o la
  fecha).
- Un cheque rechazado sigue venciendo el día del rechazo.

## Una tarea automática solo se cierra sola

`20261105200001`. «Marcar como hecha» sobre una «Cobranza vencida» la cerraba
aunque la factura siguiera impaga, y la sincronización no la volvía a abrir:
la cobranza desaparecía de la lista sin cobrarse.

Decisión del owner: una tarea automática no se cierra a mano mientras su
documento tenga algo pendiente.

- **Quién decide si está saldado:** solo `sync_automatic_tasks`, la misma
  consulta que la abre. La guarda `guard_automatic_task_close` rechaza
  (`23514`, `jouve_guard`) pasar a hecha una tarea automática salvo dentro de
  la sincronización, que se marca con `jouve.syncing_tasks` (local a la
  transacción). No hay una segunda definición de «saldado» en la guarda: con
  el documento saldado la sincronización la cierra en la corrida siguiente
  (cron `tasks-daily`, 06:17), así que cerrarla a mano no agregaba nada.
- **Reabrir** sigue permitido.
- **La app:** la acción devuelve «Esta tarea se cierra sola cuando se cobre.»
  (o pague, renueve…); la lista no ofrece «Hecha» en una automática y el
  detalle muestra lo que la resuelve más «Se cierra sola cuando …».
- **Las que se cerraron a mano antes** pasan a la sincronización
  (`auto_closed`): se reabren si su documento todavía pide acción y quedan
  cerradas si no. En producción hay una: INELEC, Factura A 0003-00022273,
  cerrada a mano el 2026-11-05.
- La migración corre la sincronización una vez para que las tareas abiertas
  tomen el vencimiento nuevo enseguida.

## Qué pasa con las tareas de cobranza abiertas

Con la regla nueva una factura recién emitida no está vencida, así que no
pide tarea. La sincronización ya trata ese caso: la tarea abierta de un
documento que dejó de pedir acción se cierra sola (`auto_closed`), y una
cerrada así se reabre, con el vencimiento nuevo, cuando el documento vuelve a
pedirla (el día 8 si sigue impaga). Las 19 de producción (facturas del 2 al 4
de noviembre) quedan cerradas solas y vuelven entre el 10 y el 12 de
noviembre, vencidas el 9, 10 u 11, si para entonces no se cobraron. Si el
promote es posterior, las que ya vencieron con la regla nueva siguen
abiertas, con el vencimiento nuevo.

## «Ir al documento» abre el registro

La tarea guarda la tabla y el id de su documento, pero el enlace iba a la
lista del módulo. Ahora va al registro cuando tiene página propia:

| Tarea                                                   | Enlace                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Cobranza vencida                                        | `/invoices/<id>`; «Cobrar» abre el recibo (`?cobrar=1`)       |
| Pago a proveedor                                        | `/purchases/<id>`; «Pagar» abre la orden de pago (`?pagar=1`) |
| Cuota de préstamo                                       | `/loans/<préstamo>`                                           |
| Documento de empleado                                   | `/employees/<empleado>`                                       |
| Cheque propio, documento de flota, km mensual, impuesto | la página del módulo (no tienen detalle)                      |

«Cobrar» y «Pagar» son el mismo botón del detalle del comprobante,
abierto al llegar: aparecen en la tarea con los mismos permisos que en esa
página (`RECEIPT_FORM_PERMISSIONS`; `payment_orders:read` más
`PAYMENT_ORDER_FORM_PERMISSIONS`), y la página decide si queda algo por
cobrar o pagar. Si falla la lectura del préstamo o del empleado, el enlace
queda en la página del módulo.

## Responsables con iniciales

La lista de tareas y la de recurrentes muestran a cada responsable como sus
iniciales (nombre y apellido de `user_profiles`, o las dos primeras letras
del mail), con el nombre en el tooltip y en la etiqueta accesible. El
selector del detalle sigue con nombres completos. `getInitials` usa ahora
dos letras del mail también en los avatares del chat.
