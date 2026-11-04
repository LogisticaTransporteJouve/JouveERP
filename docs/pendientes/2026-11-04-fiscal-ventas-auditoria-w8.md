# Fiscal ventas, auditoría w8 (2026-11-04)

Decisión: `docs/decisions/2026-11-04-pdf-factura-b-e-iva-por-alicuota-de-arca.md`.

- [x] **El PDF de un comprobante importado sin ítems muestra su IVA**
      (w8-s1 F1). Subtotal + IVA = Total, en la alícuota del Libro IVA.
- [x] **El PDF de una B no discrimina IVA** (w8-s1 F2). Los precios llevan el
      IVA incluido y el IVA Contenido va en el bloque de la Ley 27.743. El
      bloque sale ahora en toda B, no solo en la factura B a consumidor
      final.
- [x] **La importación de ARCA guarda las alícuotas** (w8-s1 F3). Cada
      `AlicIva` se guarda como un ítem «Importado de ARCA». Si el detalle
      falta o no cierra, el comprobante queda solo con la cabecera, como
      antes.
- [x] **El TXT de VENTAS incluye una venta solo exenta o no gravada**
      (w8-s1 F4). Va con una alícuota 0 % y código E/N.
- [ ] **Re-leer de ARCA las ventas ya importadas.** Las importadas antes de
      este cambio siguen sin ítems y el libro las infiere (un comprobante con
      dos alícuotas queda en «Sin alícuota»). Para corregirlas haría falta un
      job que consulte FECompConsultar por cada importada sin ítems y le
      inserte los ítems. Eso es un cambio de datos sobre comprobantes reales,
      incluso de períodos cerrados (el libro de un período ya presentado
      cambiaría de columnas, no de totales). Necesita aprobación del dueño y
      su ítem en `antes-de-promover.md`. No se hizo.
- [ ] **Confirmar las fuentes con el texto oficial.** Desde la sesión no se
      pudo abrir afip.gob.ar ni argentina.gob.ar: el contador tiene que
      confirmar que el bloque de transparencia va en toda B, y que una venta
      exenta se declara con una alícuota 0003 en cero.
- [ ] **Leyenda «A CONSUMIDOR FINAL».** La RG 1415 (Anexo II) la pide en un
      comprobante a consumidor final, y el PDF no la imprime. Queda fuera de
      este frente: hay que confirmarla con el contador antes de agregarla.
- [ ] **«Otros impuestos nacionales indirectos» sale de `imp_trib`.** Para
      una B importada, ese importe puede ser una percepción provincial, que no
      es un impuesto nacional indirecto. Las ventas del ERP no tienen
      tributos. La importación no guarda el tipo de tributo de ARCA, así que
      hoy no hay cómo distinguirlo.
- [ ] **NC total de una venta importada con ítems.** El diálogo copia los
      ítems «Importado de ARCA» y recalcula el IVA como neto × alícuota. Si
      ARCA redondeó distinto, la NC puede quedar un centavo por encima del
      saldo y el tope la rechaza: hay que ajustar el precio a mano.
- [ ] **La pantalla de detalle de una B muestra el precio unitario neto.** El
      PDF lo muestra con IVA. Los totales sí coinciden.
