# 2026-11-05 — Flota: ND acreditadas y regla de anulada (auditoría w15)

**Una ND cuenta neta de sus propias NC** (`20261105120100`). La parte que
una factura todavía factura de su carga es
`(total − NC de la factura + lo que todavía facturan sus ND) / total`, con
mínimo 0. Lo que factura una ND es su total menos las NC emitidas cuyo
origen es esa ND, con mínimo 0 por ND (`billing_invoice_live_debits`). Las
NC contra una ND llegan sobre todo por la sincronización con ARCA, que toma
el origen de `CbtesAsoc` sea cual sea el tipo. Antes nadie leía esas NC, así
que la carga seguía sumando la ND después de acreditada. Ahora la cifra de
flota coincide con `getClientMargin`, que ya restaba toda NC del cliente.
Las ND de intereses por mora siguen afuera, y también sus NC.

**La regla de anulada cuenta las ND.** Una factura fiscal ya no factura lo
que facturaba cuando sus NC emitidas suman su total **más lo que todavía
facturan sus ND** (menos 0,01). Antes alcanzaba con su total. Si se acredita
la factura entera pero queda viva una ND de flete, la carga, la liquidación o
el período de almacenaje siguen facturados, y la parte de la carga es la de
la ND (0,1 para una ND de $12.100 sobre $121.000), no 0. Así «la parte es 0
exactamente cuando la regla dice anulada» sigue valiendo, ahora con las ND.

- La regla es una sola para cargas, liquidaciones, almacenaje y el intento
  de factura de una fuente (`lib/source-invoice-key.ts`). Todas ahora
  dicen «anulada» en un caso menos: siempre del lado que conserva el
  vínculo, así que nada se factura dos veces.
- Para liberar una carga o cancelar una liquidación con una ND viva, hay
  que acreditar también la ND (con una NC sobre la ND o con una NC sobre la
  factura que cubra ambas). Los mensajes de las guardas siguen diciendo
  «una nota de crédito por el total»: ver pendientes.
- **Descartado:** dejar la regla como estaba y documentar que una ND viva
  sobre una factura acreditada no cuenta en flota. La regla habría liberado
  una carga que el cliente todavía debe por la ND, y la carga se habría
  podido facturar de nuevo sin esa ND.

**Viajes: «Ingreso manual».** La columna de Viajes y el campo del diálogo se
llaman «Ingreso manual». Son el ingreso tipeado (`trips.revenue`), que
Rentabilidad de flota usa solo para un viaje sin cargas; con cargas usa el
flete facturado (`v_trip_revenue`, decisión de w8). Así la lista no muestra
como «Ingreso» una cifra distinta de la de Rentabilidad para el mismo viaje.

- **Descartado:** mostrar en la lista el ingreso de `v_trip_revenue`. Se
  necesita `shipments:read`, igual que en `getTrips`, y la lista tendría dos
  columnas o una que cambia según el permiso. Rentabilidad de flota ya
  muestra esa cifra.
