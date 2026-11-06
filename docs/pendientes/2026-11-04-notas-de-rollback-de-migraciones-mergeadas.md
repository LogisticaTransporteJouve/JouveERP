# Notas de rollback de migraciones ya mergeadas (2026-11-04)

Auditoría w6, S7 F3. Estas migraciones ya están en `main` y no se editan:
lo que su encabezado no dice sobre un rollback queda acá. Sus ítems
"Aprobar" están en [`antes-de-promover.md`](antes-de-promover.md).

- [x] **`20261103210000_receipts_letter_x`** (recibos con letra X). El
      encabezado no dice qué pasa con código anterior. El código de
      `production-latest` imprime y lista los recibos como "R…" con sus
      propias plantillas, y la migración escribe "Recibo X…" en la
      descripción de los asientos y movimientos de Caja nuevos y en el
      índice de búsqueda. Después de un rollback, un recibo nuevo se ve R en
      la app y el PDF y X en su asiento y su movimiento de Caja. Es solo la
      descripción: el número, el punto de venta y los importes no cambian. — ya no aplica: `production-latest` (`bbe08b38`) ya tiene esa migración y su código: un rollback no vuelve al código que describe la nota.
- [x] **`20261103070000_management_v2`** (Resultado de gestión v2). El
      encabezado dice "same signature" para `get_management_pnl`, pero esa
      función no existe en `production-latest` (la crea `20261102260000`) y
      ningún código anterior la llama (`production-latest` no tiene
      Gestión). Un rollback a `production-latest` no tiene nada a qué
      volver: la función queda sin uso. — ya no aplica: `production-latest` (`bbe08b38`) ya tiene esa migración y su código: un rollback no vuelve al código que describe la nota.
- [x] **`20261104160200_purchase_nc_inherit_on_edit`** (NC/ND de compra
      que hereda del origen al editar; auditoría w10, S7 F2). El
      encabezado dice "the older code sends the same fields", y no es así:
      el formulario de `production-latest` no tiene cuenta ni centro de
      costo y no los manda al editar (solo los manda al crear desde un
      escaneo). Sí manda `kind` y el origen en cada edición, así que el
      trigger nuevo corre en cada edición de una NC/ND con el código
      anterior: si le falta la cuenta o el centro y el período está
      abierto, guarda los de su origen, cambie lo que cambie el usuario.
      El rollback sigue siendo seguro. — ya no aplica: `production-latest` (`bbe08b38`) ya tiene esa migración y su código: un rollback no vuelve al código que describe la nota.
