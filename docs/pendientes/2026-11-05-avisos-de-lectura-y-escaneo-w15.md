# 2026-11-05 — Avisos de lectura y escaneo: lo que queda (auditoría w15)

Decisión: [`2026-11-05-avisos-de-lectura-y-escaneo-w15.md`](../decisions/2026-11-05-avisos-de-lectura-y-escaneo-w15.md).

- [ ] **Cotización de un comprobante recibido de ARCA en dólares.** Al
      aceptar un comprobante de la bandeja de ARCA, `mismatch`
      (`features/purchase-invoices/actions/arca-received-actions.ts`) compara
      tipo, número, fecha, moneda, CAE e importes, pero no la cotización. En
      un comprobante `DOL` el usuario puede cambiar la «Cotización» que
      informó ARCA, y el Libro IVA Compras, el TXT y el asiento convierten a
      la nueva. El IVA crédito en pesos difiere del de ARCA. Hoy no hay
      proveedores en dólares, así que queda para después. Arreglo: exigir
      `near(invoice.cotizacion, voucher.cotizacion)` cuando
      `voucher.moneda === "DOL"` y ARCA informó la cotización, y bloquear el
      campo en el formulario en ese caso (auditoría w12-s1 F2).
- [ ] **Borrador del escaneo borrado tras un envío fallido.** Si
      `inngest.send` falla, `startExtraction` borra el borrador. Si el evento
      sí llegó, la corrida ya no paga la visión, pero el usuario no ve nada
      en Documentos y vuelve a escanear. Marcarlo `failed` en vez de
      borrarlo lo dejaría a la vista.
- [ ] **Selector de cliente de Productos y Tarifas.** Ahora trae todos los
      clientes. Con muchos miles convendría el buscador de clientes
      (`client-picker`) en vez de una lista completa.
