# 2026-11-03 — Pagar y cobrar desde Tesorería; préstamos conectados (Fase 2)

**Decisión (D2).** "Cobrar a cliente" y "Pagar a proveedor" abren el mismo
formulario de recibo / orden de pago (mismas actions y RPC `create_receipt` /
`create_payment_order`) desde Tesorería, Caja, el detalle de un comprobante
(precargado con su saldo) y como aviso en un ingreso o egreso manual. En
Tesorería y Caja se elige el lado (fiscal o interno). La imputación es
explícita: automática (FIFO, los más viejos primero), elegida o "a cuenta"
(`allocation_mode`; sin el campo rige el contrato anterior: sin imputaciones
= FIFO). Lo que quedó a cuenta se imputa después con "Imputar"
(`allocate_receipt` / `allocate_payment_order`): agrega imputaciones a
comprobantes sin tocar líneas de pago, movimientos ni cheques (editar el
recibo los reconstruye y falla si un cheque ya salió de cartera); la
imputación a comprobantes no entra en el asiento. El aging muestra lo cobrado
o pagado a cuenta aparte (`v_receipt_unapplied`, `v_payment_order_unapplied`,
columna "A cuenta" y el neto en el total), sin restarlo de los tramos; el
flujo de caja lo descuenta de lo proyectado a cobrar / pagar de ese lado en
el primer mes proyectado, sin pasar de lo proyectado.

**Decisión (D3).** Una cuota puede desglosarse en capital, interés, IVA,
percepción y otros cargos (sellos, punitorios); el desglose suma el importe de
la cuota y se paga por ese importe. Con desglose el pago asienta Debe
`prestamos` (capital, pasivo nuevo "Préstamos financieros" 2.1.x), Debe
`intereses_pagados` (5.4.1; interés + otros cargos), Debe `iva_credito`, Debe
`percepciones_iibb_pagadas`, Haber banco; sin desglose, igual que antes (Debe
gastos). Un egreso manual ya cargado puede tomarse como pago de una cuota
("Vincular egreso", `adopt_loan_installment_payment`): no se duplica el
movimiento, pasa a ser de la cuota y se re-asienta. El desembolso se registra
(o se toma un ingreso ya cargado del mismo importe) con
`record_loan_disbursement`: Debe banco / Haber `prestamos`. La ficha muestra
el saldo de capital (una cuota sin desglose cuenta entera como capital, como
la lee Gestión).

**Descartado.** Duplicar la lógica de recibos y OP en Tesorería; restar el a
cuenta de los tramos del aging (escondería a quién hay que imputar); un rol
por componente de cargos (sellos y punitorios van con el interés).
