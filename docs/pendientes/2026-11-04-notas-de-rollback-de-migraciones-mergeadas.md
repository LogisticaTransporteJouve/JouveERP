# Notas de rollback de migraciones ya mergeadas (2026-11-04)

Auditoría w6, S7 F3. Estas migraciones ya están en `main` y no se editan:
lo que su encabezado no dice sobre un rollback queda acá. Sus ítems
"Aprobar" están en [`antes-de-promover.md`](antes-de-promover.md).

- [ ] **`20261103210000_receipts_letter_x`** (recibos con letra X). El
      encabezado no dice qué pasa con código anterior. El código de
      `production-latest` imprime y lista los recibos como "R…" con sus
      propias plantillas, y la migración escribe "Recibo X…" en la
      descripción de los asientos y movimientos de Caja nuevos y en el
      índice de búsqueda. Después de un rollback, un recibo nuevo se ve R en
      la app y el PDF y X en su asiento y su movimiento de Caja. Es solo la
      descripción: el número, el punto de venta y los importes no cambian.
- [ ] **`20261103070000_management_v2`** (Resultado de gestión v2). El
      encabezado dice "same signature" para `get_management_pnl`, pero esa
      función no existe en `production-latest` (la crea `20261102260000`) y
      ningún código anterior la llama (`production-latest` no tiene
      Gestión). Un rollback a `production-latest` no tiene nada a qué
      volver: la función queda sin uso.
