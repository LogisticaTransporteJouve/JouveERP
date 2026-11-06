# Pendientes — Archivos por registro, quitar adjuntos y entradas del escaneo (auditoría w14)

Decisiones: `docs/decisions/2026-11-05-archivos-por-registro-w14.md`.

- [x] **Un archivo y sus adjuntos los lee solo quien lee un registro que lo
      tiene** (`20261105100100`, w14-s4 F1). Operaciones y depósito ya no
      listan ni bajan las facturas de proveedores, cheques, movimientos ni
      escaneos de finanzas. Es el ítem T6 de la remediación de julio, que
      hasta ahora solo estaba cerrado para RRHH y flota.
- [x] **`getSignedFileUrlAction` firma un escaneo solo con `ai:read` y la
      extracción visible**, que es la regla de la revisión (w14-s4 F1).
- [x] **Quitar un adjunto pide el permiso de escritura del registro**, en la
      acción y en las cinco pantallas (w14-s4 F2).
- [x] **El CUIT escaneado se busca solo por sus 11 dígitos** (w14-s6 F2).
- [x] **Un escaneo cuya búsqueda falla en todos los intentos se guarda como
      «no se pudo verificar»** y no como fallido (w14-s5 F2). Cierra el ítem
      «Un escaneo cuya búsqueda falla en todos los reintentos queda
      fallido» de `2026-11-05-archivos-y-escaneo-auditoria-w13.md`.
- [x] **Crear desde un escaneo muestra el error de lectura** del canal,
      cliente, proveedor o cuenta sugerida (w14-s6 F3).
- [x] **Comentarios de `duplicate_unknown`** al día (w14-s7 F2).
- [x] **Correr la consulta de control antes de promover**
      (`antes-de-promover.md`, ítem `20261105100100`). Lista, por usuario
      que no es owner/admin, los archivos que deja de leer. Lo esperado es
      que operaciones y depósito pierdan adjuntos de compras, comprobantes,
      recibos, órdenes de pago, cheques y movimientos, y los escaneos de
      otros usuarios. Si alguien necesita alguno de esos archivos, hay que
      darle el rol que lee el registro, no tocar la política. — hecho: aprobada con su consulta de control y promovida (ítem tildado en `antes-de-promover.md`; la migración está en `production-latest`, `bbe08b38`).
- [x] **Quitar un adjunto que otro creó ya no da un falso «Adjunto
      eliminado».** La política de borrado de `file_attachments` es «quien
      lo creó u owner/admin». Antes la acción borraba 0 filas, auditaba
      `file.detached` y respondía bien. Ahora responde «Solo quien lo
      adjuntó o un admin lo quita.». Se encontró en la revisión de este
      cambio.
- [ ] **Las pantallas muestran «Eliminar» en adjuntos que otro creó**, para
      quien no es owner/admin, y la acción lo rechaza. Para esconderlo,
      `listAttachmentsAction` tendría que devolver si el usuario puede
      quitar cada adjunto.
- [x] **`is_linked_file` ya no lo usa ninguna política.** Se dejó definida
      porque borrarla cambia los tipos y no ahorra nada. Se puede borrar en
      una limpieza futura. — ya no aplica: `guard_link_file_visible` la volvió a usar (`20261105130100_document_file_unshared.sql:64`).
