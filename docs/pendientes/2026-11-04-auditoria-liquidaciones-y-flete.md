# Auditoría: liquidaciones y flete (2026-11-04)

- [x] **Contador externo (`fiscal_reader`):** en `/liquidaciones` ve solo las
      del lado fiscal (canal confirmado, o el del cliente en un borrador o
      una legacy): listado, detalle, PDF del R, datos para el email y la
      herramienta IA. No lee candidatas (cargas). Los datos del email de un
      comprobante (`getInvoiceEmailDefaultsAction`) validan el id y ocultan
      los internos.
- [x] **Una sola factura por liquidación o carga:** la factura se emite con
      una clave derivada de la liquidación o la carga
      (`lib/source-invoice-key.ts`); un "Facturar" después de que venció la
      reserva vincula la factura ya emitida en vez de emitir otra (en una
      carga, solo si sigue con el mismo cliente y flete). Cancelar una
      liquidación con una factura emitida y sin vincular se rechaza.
- [x] **Carga nueva:** el flete tomado de la tarifa sigue al cliente y a la
      fecha (se vacía si el nuevo no tiene tarifa); un flete tipeado queda.
      Editar una tarifa refresca la sugerencia y las candidatas.
- [ ] Las facturas emitidas antes de este cambio llevan una clave al azar: una
      liquidación o carga facturada así y nunca vinculada no se detecta.
- [ ] La clave se busca en las primeras 20 tentativas: con 20 facturas
      fallidas o anuladas, facturar de nuevo se rechaza (revisar a mano).
- [ ] La clave es por fuente: una carga facturada sola cuya factura no se
      vinculó vuelve a ser candidata cuando vence la reserva, y una
      liquidación la factura otra vez. Borrar esa carga deja la factura sin
      carga. Hace falta una marca en la base (la carga no lo sabe).
