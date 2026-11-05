# Decisiones — Quién escribe un vínculo a un archivo (auditoría w15)

Pendientes: `docs/pendientes/2026-11-05-vinculos-de-archivos-auditoria-w15.md`.

## Un vínculo lo escribe quien escribe el registro y ya ve el archivo

`20261105120000`. Desde `20261105100100`, un archivo lo lee quien lee un
registro que lo tiene. Pero las políticas de escritura de los vínculos
miraban solo el rol. Un usuario de operaciones o finanzas que conocía el id
de un archivo podía vincularlo a un cliente, o crear una extracción que lo
apuntara, y desde ahí leerlo y bajarlo. Operaciones además podía poner
archivos en compras, recibos o cheques a nombre de otro usuario, y apuntar
un documento de flota a un archivo de finanzas para ocultárselo a finanzas.

Ahora la base pide lo mismo que la app para escribir un vínculo
(`file_attachments`, `ai_document_extractions.file_id` y el archivo de un
documento de flota o de RRHH):

1. **Lo escribe quien figura:** `created_by` es el usuario que inserta.
2. **Su rol escribe ese registro**, con la tabla de
   `ATTACHMENT_WRITE_PERMISSION` (`lib/files/attachment-targets.ts`):

   | Registro | Roles |
   |---|---|
   | compra, comprobante, recibo, orden de pago, cheque, cheque propio, movimiento, impuesto, cliente, proveedor | owner, admin, finance |
   | carga de combustible | owner, admin, operations |
   | escaneo (extracción, `ai:read`) | owner, admin, finance, operations |
   | documento de flota | owner, admin, operations (sin cambios) |
   | documento de RRHH | owner, admin, finance (sin cambios) |

   Los vínculos del chat los sigue escribiendo solo la ruta del chat, con el
   service role.
3. **Ya ve el archivo:** la guarda `guard_link_file_visible` busca el
   archivo en `files` con la RLS de quien escribe. Un vínculo nunca da
   lectura de un archivo que el usuario no veía antes.

- **Por qué una guarda y no una cláusula de la política:** la política de
  `files` lee `file_attachments`, así que una política de `file_attachments`
  que leyera `files` recursaría. Además, la guarda en un `update` solo corre
  cuando cambia el archivo: editar las notas o el vencimiento de un
  documento no vuelve a revisar el archivo que ya tenía.
- **El error es de permiso (`42501`), sin `jouve_guard`:** la app ya
  comprueba lo mismo antes (`uploadFileAction`, `startExtraction`,
  `linkableFileError`), así que la base solo frena un pedido armado a mano.
  Como las demás negativas de permiso, no se muestra con su texto.
- **Filas existentes:** no se revisan ni se tocan. La consulta de control de
  `antes-de-promover.md` lista las que no pasarían la regla nueva, para que
  el owner las revise.
- **Quién sigue pasando:** subir y vincular, confirmar un escaneo (quien
  escaneó, o owner/admin, sobre su escaneo), escanear desde la bandeja o el
  chat, crear, editar, subir y reemplazar documentos de flota y de RRHH. El
  chat, el pipeline de extracción y el importador corren sin RLS (service
  role o `SECURITY DEFINER`).

## Firmar un adjunto del chat pide `ai:chat`

`getSignedFileUrlAction` trataba un vínculo del chat como legible siempre.
Ahora pide `ai:chat`, con la denegación por usuario incluida, como el centro
de archivos (w15-s4 F2). Un vínculo sin registro conocido ya no se da por
legible.
