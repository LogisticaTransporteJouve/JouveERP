# 2026-11-04 — Formularios que eligen cuenta, revisión de Documentos y `MoneyInput` (auditoría w6)

Amplía
[`2026-11-04-sin-permiso-de-cuentas-se-ocultan-los-selectores-de-cuenta.md`](2026-11-04-sin-permiso-de-cuentas-se-ocultan-los-selectores-de-cuenta.md)
y
[`2026-11-04-moneyinput-lee-lo-tipeado-como-lo-pegado.md`](2026-11-04-moneyinput-lee-lo-tipeado-como-lo-pegado.md).

## Sin `accounts:read`, tampoco se ofrecen desde el detalle

- «Cobrar» en el detalle de una factura, «Pagar» en el detalle de una compra,
  «Nuevo recibo» en la cuenta corriente del cliente y «Nueva OP» en la del
  proveedor piden lo mismo que en las listas: escribir recibos u OP **y**
  `accounts:read`, porque cada línea elige una cuenta. Sin eso, el botón no
  aparece. Los gates son `RECEIPT_FORM_PERMISSIONS`
  (`features/receipts/lib/receipt-form.ts`) y
  `PAYMENT_ORDER_FORM_PERMISSIONS`
  (`features/payment-orders/lib/payment-order-form.ts`).
- **Sueldos:** el diálogo de pagos de cada empleado muestra siempre los pagos
  ya hechos y su borrado. Solo el formulario para agregar o editar un pago
  (elige cuenta) dice por qué no se puede.

## Documentos: cada acción de crear, con su permiso

La revisión de un documento escaneado ofrece «Crear cheques», «Crear recibo»,
«Crear orden de pago», «Emitir factura de venta» y «Cargar compra» solo si el
usuario tiene los permisos de esa acción, más `accounts:read` cuando el
formulario elige cuenta (cheques, recibo, OP). Si no, en lugar del botón se
lee por qué (`features/ai/document/lib/review-gates.ts`). Un usuario de
operaciones puede escanear y revisar, pero no crear lo que no puede crear.

## Si leer las cuentas falla

Fuera de Cuentas, una lectura fallida de las cuentas muestra el mensaje con
«Reintentar» donde se elige la cuenta (Recibos, OP, rechazo de un cheque
vendido, filtro de Movimientos, pago masivo de sueldos y los diálogos con
`AccountOptionsGate`). En Recibos y OP se ocultan «Nuevo» y «Editar» mientras
tanto. Si la lectura falla **después** de haber leído las cuentas (un refetch
en segundo plano), se siguen usando las ya leídas: un formulario con datos no
se desmonta.

## `MoneyInput`

- **Cursor:** cuando una edición cambia el texto (se caen los puntos de miles
  de un valor ya agrupado, o se reformatea un pegado), el cursor queda después
  del mismo dígito que seguía, no al final. Editar "1.234,56" borrando el "3"
  y tipeando "8" da 1.284,56.
- **"0." es decimal:** un grupo de miles nunca empieza con 0, así que un punto
  solo después de "0" (o al principio) es la coma decimal: "0.125" vale 0,125,
  no 125.

## Cotización USD: aviso de salto

Antes de guardar una cotización que difiere más de un 30% de la cargada más
cercana (la anterior a esa fecha, o la siguiente si no hay anterior), se
pregunta «¿Seguro?» con la cotización de referencia. Así "1450.125" leído
como 1.450.125 no se guarda sin querer.
