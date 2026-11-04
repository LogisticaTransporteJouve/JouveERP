# Decisiones del owner, tanda 1 (2026-11-04)

- [x] Producción sin compras, cheques, OP, préstamos, RRHH, recibos ni
      comprobantes en dólares: los ítems de esos datos en **Antes de
      promover** quedan N/A con su SQL
      (`docs/decisions/2026-11-04-estado-de-produccion-solo-clientes-y-ventas-en-pesos.md`).
- [x] Pagos de planilla, borrar un movimiento de la cuenta corriente con
      caja y pagar la deuda de un cheque vendido piden `transactions:write`;
      el botón queda oculto o deshabilitado con el motivo.
- [x] Percepciones o pagos a cuenta de Ganancias y otros impuestos
      nacionales en compras (`imp_perc_nacionales`, `20261104113000`–
      `20261104113002`): formulario, bandeja de ARCA, borrador de IA, asiento
      a `percepciones_ganancias`, campo 13 del TXT de compras; no es IVA.
- [x] Libro IVA Compras (pantalla, PDF, Excel) con una columna
      "Percepciones" con código (B, I, G, M), como el libro del contador.
- [x] Reparto sugerido de otros tributos en la bandeja de ARCA y el
      borrador de IA (historia del proveedor, 1,5 %/3 % de IVA, IIBB), y
      alícuota inferida de IVA/neto en los comprobantes de ARCA sin columnas
      por alícuota (21/10,5/27 %, 21 % con aviso si no coincide).
- [ ] No verificado contra una base real: las tres migraciones y el pgTAP
      `purchase_perc_nacionales` (corren en el job `database` de CI); el
      lector de Mis Comprobantes toma una columna de "percepciones de otros
      impuestos nacionales" por nombre, sin un archivo real que la traiga.
