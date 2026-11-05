# 2026-11-05 — Lecturas fallidas en pantallas de edición y reclamos del escaneo (w16)

**Decisión.** Auditoría w16 (S6 F1, F2; S8 F1, F2, F3; S5 F1, F2). Solo
código de la app, sin migración.

**Detalle de una compra.** «Pagado» y «Saldo» salen de
`v_purchase_invoice_open` (OPs emitidas, NCs contra la factura y saldo
inicial aplicado), la misma cifra que «Pagar» y la orden de pago. Antes
«Saldo» restaba solo las OPs y la NC interna de un remito imputado. Se ven
también «Acreditado» (NCs) y «Saldo inicial aplicado» cuando no son cero.

- Sin `payment_orders:read` (el `fiscal_reader`) no se muestran «Pagado» ni
  «Saldo»: bajo RLS no ve las OPs, y la compra parecía impaga.
- Si la lectura de pagos falla, «Pagado» y «Saldo» dicen «—» y debajo «No se
  pudieron leer los pagos.». Si falla solo la lista de órdenes de pago, las
  cifras quedan y dice «No se pudieron leer las órdenes de pago imputadas.».
- Si la lectura de ítems falla, dice «No se pudieron leer los ítems.» en vez
  de «Sin detalle (cargada solo por totales)».

**Nuevo préstamo.** El «Canal» sale de los canales del layout
(`useScope()`), no de `listInvoicingChannelsAction`, que pedía
`invoices:issue`. Con la lectura fallida dice «No se pudieron cargar los
canales.», como los demás diálogos.

**Puntos de venta sin leer.** «Nuevo comprobante», «Emitir factura de venta»
desde un escaneo y «Facturar almacenaje» dicen «No se pudieron cargar los
puntos de venta.» con «Reintentar». El escaneo ya no dice «Sin POS
habilitado» ante una falla. «Facturar almacenaje» dice también una falla de
canales. `components/pos-read-error-reach.test.ts` exige el aviso en cada
componente que llama a `useEnabledPos` o a `useInvoicingChannels` (salvo los
de AFIP, que usan suspense).

**Editar recibo u orden de pago.** El cliente o proveedor se ve sin el botón
«Cambiar»: la actualización no lo cambia, igual que el canal y la moneda. Se
lee con TanStack (`useClientByIdOptional`, `useSupplierByIdOptional`). Si la
lectura falla, dice «No se pudo leer el cliente del recibo.» (o «…el
proveedor de la orden de pago.») con «Reintentar». Las imputaciones listan los
comprobantes del cliente o proveedor guardado aunque esa lectura falle, y
guardar no pide elegir uno.

**Pallets.** Las opciones de cliente se leen por páginas (`legal_name` +
`id`). Si la lectura falla, «Nuevo pallet», «Cargar varios» y los filtros de
Pallets y Trazabilidad dicen «No se pudieron cargar los clientes.» con
«Reintentar».

**Escaneo: escrituras del pipeline.** `saveExtractionResult` y
`markExtractionFailed` escriben solo sobre un borrador `pending_review` que
todavía no se guardó (`detected_type` nulo). Un `save` reintentado después de
que su primer intento ya escribió no devuelve a «Pendientes» un borrador ya
confirmado. `onFailure` tampoco marca `failed` un borrador confirmado o ya
guardado. `classify-and-extract` no paga la visión de un borrador ya
guardado. La toma (`claimExtraction`) y la carga previa rechazan un borrador
que ya tiene `created_entity`. Los ids de los pasos y el evento no cambian.

**Escaneo: toma vieja sin entidad.** Una toma de más de 10 minutos sin
entidad vinculada:

| Tipo                      | Antes                             | Ahora                                                                                                                       |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Factura de compra         | se libera al abrir el borrador    | igual                                                                                                                       |
| Cheques                   | «La extracción ya fue procesada.» | se libera y se reintenta: un cheque ya cargado lo rechaza su clave (tipo, banco, número)                                    |
| Recibo, OP, factura venta | «La extracción ya fue procesada.» | dice que un intento anterior no registró qué creó, que se revise si el comprobante existe, y el borrador se puede descartar |

Recibos, OPs y facturas de venta no se liberan solos: ninguno tiene una
clave que rechace un segundo, y una toma vieja sin entidad puede venir de un
alta que sí se hizo y cuyo vínculo falló dos veces. Liberarla podría duplicar
un recibo o emitir otra factura.

**Rollback.** Solo código. Volver atrás devuelve las cifras y mensajes
anteriores. Las corridas en vuelo siguen: los pasos memorizados no cambian de
forma, y el código viejo acepta lo que deja el nuevo.
