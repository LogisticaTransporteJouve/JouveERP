# Auditoría w8: correcciones de docs (2026-11-04)

Auditoría w8, S7 F1–F4. Lo que no se puede editar en su lugar (una
migración mergeada o un archivo de pendientes de otra tanda) queda corregido
acá. Los ítems "Aprobar" están en [`antes-de-promover.md`](antes-de-promover.md).

- [x] **Falta el ítem "Aprobar `20261104141000`"** (#390): agregado en
      `antes-de-promover.md`, después del de `140100`/`140101`.
- [x] **El comentario de `20261104140101` quedó mal** (ya mergeada, no se
      edita): dice que el código anterior recibe el mensaje de la guarda por
      `mapDbGuardError`. El código de `production-latest` no lo llama al
      actualizar un proveedor: ante cualquier error que no sea un CUIT
      duplicado muestra «No se pudo actualizar el proveedor.». El cambio de
      CUIT se rechaza igual; solo no se ve el motivo. Corregido también en
      el ítem de `antes-de-promover.md`.
- [x] **El manual de Compras daba una clave incompleta de Recibidos de
      ARCA** (`docs/manual/purchases.html`): ahora nombra proveedor (CUIT),
      tipo, letra, punto de venta, número, total, moneda e IVA en una A, que
      una compra tiene un solo comprobante, y que también vuelve a
      Pendientes si se edita la clave de la compra o el CUIT del proveedor
      (`20261104131000`, `20261104141000`).
- [x] **Desvincular los comprobantes de ARCA cuando cambia el CUIT**:
      [`2026-11-04-compras-y-fiscal-auditoria-w7.md`](2026-11-04-compras-y-fiscal-auditoria-w7.md)
      lo da como pendiente para la sesión de ARCA. Está hecho en
      `20261104141000` (#390), como dice
      [`2026-11-04-recibidos-de-arca.md`](2026-11-04-recibidos-de-arca.md).
