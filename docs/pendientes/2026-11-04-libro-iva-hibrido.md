# Libro IVA híbrido (2026-11-04)

- [x] Comprobantes sin ítems (ventas importadas de ARCA) muestran su neto e
      IVA en la alícuota que declara el TXT, o en "Sin alícuota"; el aviso de
      pantalla ya no dice que el IVA se muestra "sin separar por tasa".
- [x] Encabezado con empresa, C.U.I.T. y Previo / Definitivo; TC y C.I.;
      solo las alícuotas del período; NC en negativo; subtotales por hoja en
      el PDF (`docs/decisions/2026-11-04-libro-iva-hibrido-con-el-sistema-anterior.md`).
- [ ] **Retenciones en el libro de ventas:** hace falta atar cada retención
      a un comprobante (hoy es del recibo) antes de mostrarla por renglón.
      Decidir con el contador si vale la pena.
- [ ] **Percepciones de ventas por tipo:** la venta guarda un solo
      `imp_trib`; para imprimirlas con letra como en compras hay que guardar
      la apertura (por ejemplo, desde los tributos del comprobante AFIP).
- [ ] Revisar con el contador un período real impreso (PDF) contra el del
      sistema anterior antes de presentar.
