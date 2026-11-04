# 2026-11-04 — Auditoría: impuestos y gestión

**Cheques en percibido.** Un cheque de terceros importado al arranque es una
partida de apertura: ni su ingreso a cartera ni su rechazo tocan el
resultado (la deuda y el cheque son anteriores al sistema; devengado ya era
neutro). El egreso de un cheque rechazado va a Servicios en negativo, del
lado del recibo que lo cobró (y a venta de bienes de uso en la parte que el
recibo imputó a una): antes era neutro, y el cobro original quedaba
sumado y un nuevo cobro sumaba otra vez. Devengado no cambia (el asiento va a
Deudores por cheques rechazados).

**Pendiente USD fiscal = sin asiento.** En devengado lo fiscal sale del
libro, así que un movimiento fiscal en dólares está pendiente mientras no
tiene asiento vivo, no mientras no hay cotización hoy. Descartado por ahora:
re-asentar al insertar una cotización (es otro efecto, y el paquete mensual
ya lista los `sin_cotizacion`).

**Deshacer el pago de un impuesto restaura lo previo.** Pagar y vincular
guardan el importe y el estado que tenía el documento
(`payment_previous_amount`, `payment_previous_status`), como ya guardaban la
cuenta de gasto; deshacer los devuelve. Un pago anterior conserva la regla
vieja.

**Recategorizar arrastra sus NC/ND.** Se propaga, no se avisa: una NC/ND
ajusta el mismo costo y va al mismo rubro y centro. Solo cambian las
vigentes que tenían el valor anterior (una con valor propio lo conserva; una
a cargo de un empleado conserva la cuenta), y un período cerrado de
cualquiera de ellas rechaza todo.

**Margen por camión.** Lo sin clasificar con el centro del camión es costo
del camión, igual que en Gestión.

**IA, libros IVA.** Las herramientas devuelven `{ rows, totals }`: los
totales con signo (NC restadas, cada comprobante una vez) son los mismos que
la pantalla (`computeTotals`), para que el modelo no sume filas.
