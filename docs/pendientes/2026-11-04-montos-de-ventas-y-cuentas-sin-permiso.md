# Montos de ventas en `MoneyInput` y páginas sin permiso de cuentas (2026-11-04, auditoría w5)

- [x] Nueva factura, remito interno y NC/ND (desde el diálogo y desde la
      factura): la cantidad y el precio de cada ítem eran texto leído con
      `Number()`. "15.000" facturaba $15 y "1.500,50" mandaba la línea en $0.
      Ahora son `MoneyInput` con los 4 decimales de `invoice_items`
      (`numeric(15, 4)`), se precargan en es-AR y se mandan como número. El
      porcentaje «Otro…» del seguro acepta decimales ("1,5").
- [x] Mismo patrón en el resto de los formularios con montos: tarifas de
      cliente y de depósito, flete y cobranza de una carga (y la tarifa que
      la precarga), rendiciones de chofer, combustible (también litros y
      odómetro), viajes (km, ingreso, costo), mantenimiento, préstamos
      (alta, editar y pagar cuota), pagos recurrentes, impuestos (importe,
      saldo a favor y pago), asiento manual, cabecera y tributos de una
      compra, líneas e imputaciones de recibos y OP, y los diálogos de
      documentos escaneados (cheques y comprobante de pago).
- [x] `components/money-inputs.test.ts` recorre `app/`, `components/` y
      `features/` y falla ante un campo `type="number"`, `inputMode="decimal"`
      o un cambio de coma por punto fuera de `MoneyInput`. Los campos que no
      son plata (números de comprobante, porcentajes, tasas, días, horas,
      unidades, capacidades, km de lectura) están en una lista por archivo,
      con su motivo; reemplaza al test que cubría solo RRHH.
- [x] Denegar `accounts:read` ya no tira Recibos, Órdenes de pago,
      Movimientos, Cheques ni el mes de sueldos: se ocultan los controles que
      eligen una cuenta, y los diálogos de RRHH lo explican adentro
      (`useAccountOptions`, `AccountOptionsGate`).
- [x] Compra nueva: la cuenta de gasto y el centro de costo por defecto del
      proveedor se copian solo si siguen activos (un proveedor con
      `FLOTA_DZ` ya no lo precarga). El canal ya pedía estar activo.
- [x] El prompt del AI CFO ya no ofrece «búsqueda general». La etiqueta de
      `searchGlobal` en los chats guardados queda.
- [ ] Sin probar en la app: las pantallas de Recibos, OP y Movimientos con
      `accounts:read` denegado tienen la lógica, pero el test de componente
      cubre Cheques y el diálogo de adelanto; la precarga de defaults de la
      compra se prueba en el helper, no en el formulario completo.
- [ ] Con `accounts:read` denegado, el diálogo de pagos de un empleado
      muestra el mensaje en lugar de la lista de pagos ya hechos. Mostrar la
      lista sin el formulario queda para después.
- [ ] El diálogo de importaciones y los de documentos escaneados siguen
      leyendo las cuentas con suspense dentro del diálogo abierto. Solo
      fallan al abrirlos sin permiso; no se tocaron.
