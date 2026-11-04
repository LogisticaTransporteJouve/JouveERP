# Emisión AFIP — auditoría (2026-11-04)

- [x] Un reintento no pide un segundo CAE cuando otro comprobante trabado solo
      _intentó_ el mismo número: cuenta quien lo tiene (`numero`) y, entre los
      que solo lo intentaron, el que coincide con el comprobante de AFIP.
- [x] `issue-invoice-reconcile` (cada 15 min): una emisión fiscal trabada en
      `emitting` (AFIP no respondió) se emite con el CAE que AFIP tiene o pasa a
      `failed` (libera la liquidación o el envío); un borrador que nunca llegó a
      Inngest se vuelve a mandar con su clave. La NC de un remito facturado es
      la excepción: `credit-billed-remito` la manda con una clave por corrida,
      así que una primera corrida lenta puede tener una segunda; es interna y
      las dos terminan en el mismo número.
- [x] Reenviar el formulario con la misma clave vuelve a mandar un borrador sin
      run; si `inngest.send` falla el borrador no se borra.
- [x] Las llamadas a AFIP tienen un límite de 20 s (60 s el login de WSAA,
      5 s el piso CAEA).
- [x] Un segundo run no vuelve un comprobante `emitted` a `emitting`.
- [x] Una consulta a AFIP que no trae el comprobante ni el error 602 (no
      existe) queda sin respuesta: no marca fallida una emisión ni saltea un
      número en la importación de ARCA.
- [x] La importación de ARCA guarda un comprobante de un período cerrado con
      su asiento en `pending_journal_entries`.
- [x] CAEA: un error de lectura no se toma como "sin CAEA vigente" ni como
      "sin movimiento".
- [ ] Dos comprobantes con el mismo total, fecha y receptor que intentaron el
      mismo número durante una caída quedan en `emitting` (no se pide otro CAE)
      hasta que alguien decida de cuál es el de AFIP.
- [ ] `arca-issued-sync` hace hasta 100 consultas por paso: con AFIP lento
      (cada una cerca de 20 s) el paso puede pasar los 300 s.
- La revisión de los borradores antes de la primera corrida de
  `issue-invoice-reconcile`: en **Antes de promover**.
- [ ] Una emisión en `emitting` sin número enviado (el `onFailure` no pudo
      leer la fila, o el run se canceló) no la resuelve el cron: frena la
      importación de ARCA de su par hasta que alguien la marque fallida.

### Emisión AFIP — auditoría, segunda vuelta (2026-11-04)

- [x] Un run que agota los reintentos con un pedido reciente a AFIP (menos de
      30 min) no se marca fallido por un "no registrado" de AFIP: un pedido
      que se cortó por el límite de 20 s puede seguir procesándose. Queda en
      `emitting` y lo decide `issue-invoice-reconcile`. Un rechazo de AFIP
      (error no reintentable) sigue marcándose fallido en el momento.
- [x] El aviso al remito facturado de un CAE recuperado (por el `onFailure` o
      por el cron) sale en un paso propio: un reintento ya no lo pierde.
- [x] WSAA: el ticket nuevo se guarda en `afip_ta_cache` con reintentos antes
      de usarse; si no se puede guardar, el paso falla y se reintenta sin
      pedir otro login. Un error al leer el ticket guardado no se toma como
      "no hay ticket", y un `alreadyAuthenticated` vuelve a leer el guardado.
- [x] Estado CAEA: si falla el conteo de comprobantes sin informar, el panel y
      la herramienta de IA muestran el error en vez de "0".
- [x] Escaneo de una factura de venta: si no se pudo verificar si ya estaba
      cargada, "Emitir factura" queda deshabilitado y la acción la rechaza;
      el borrador de compra lo avisa.
- [x] Un comprobante fiscal en dólares necesita cotización mayor a 1 también
      en la base (`guard_invoice_cotizacion`), para cualquier escritor.
- [x] El total del listado de Comprobantes suma solo los emitidos (antes
      sumaba borradores); la cantidad sigue contando todas las filas listadas.
- [x] CAEA: no se emite con un CAEA ya informado "sin movimiento" para ese
      punto de venta (el comprobante falla con el aviso de emitirlo de nuevo
      con una fecha de la quincena vigente),
      y "sin movimiento" espera mientras haya un borrador del punto de venta
      con fecha dentro de la vigencia.
- [x] El barrido de archivos huérfanos borra solo los que siguen huérfanos al
      borrar (`delete_orphan_files`) y después saca sus bytes.
- [x] El mail semanal del aging va con clave de idempotencia: un reintento no
      lo manda dos veces.
- [ ] Mail manual de un comprobante, recibo o liquidación: sin clave de
      idempotencia. Hace falta un id de pedido que el diálogo mande a las tres
      acciones; hoy el doble envío lo frena solo el botón deshabilitado.
- [ ] `build_invoice_journal_lines` y `libro_iva_ventas` siguen tomando una
      cotización 1 guardada como válida en un comprobante en dólares viejo (la
      guarda nueva frena las filas nuevas). Revisar si hay alguna:
      `select id, fecha, cotizacion from invoices where moneda <> 'PES' and cotizacion <= 1`.
- [ ] CAEA: un borrador trabado con fecha dentro de una vigencia vencida
      frena el "sin movimiento" de su punto de venta hasta la fecha tope; hay
      que emitirlo o marcarlo fallido.
- [x] Auditoría w3: antes de pedir un número nuevo, un reintento vuelve a
      consultar el número que ya mandó si AFIP ya llegó a él (AFIP pudo
      registrar el pedido que se cortó entre la consulta y la lectura del
      último número).
- [x] Auditoría w3: después de un intento sin resultado, un rechazo de AFIP
      queda reintentable, así que `onFailure` deja el comprobante a
      `issue-invoice-reconcile` en vez de marcarlo fallido al instante.
- [x] Auditoría w3: si no se guarda el "sin movimiento" de un CAEA en
      `no_movement_pvs`, el paso falla y reintenta (la presentación a AFIP es
      idempotente).
- [x] Auditoría w3: el Libro IVA Ventas (pantalla, PDF y Excel) muestra el no
      gravado y el exento cada uno en su columna.
