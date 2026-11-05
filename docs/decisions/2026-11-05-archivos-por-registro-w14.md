# Decisiones — Archivos por registro, quitar adjuntos y entradas del escaneo (auditoría w14)

Pendientes: `docs/pendientes/2026-11-05-archivos-por-registro-auditoria-w14.md`.

## Un archivo lo lee quien puede leer un registro que lo tiene

`20261105100100`. Antes, todo rol con `files:read` (owner, admin, finanzas,
operaciones, depósito) veía todos los adjuntos y todos los archivos
vinculados, y por `files_storage_select` podía bajar sus bytes: facturas de
proveedores, cheques, movimientos de caja y todos los escaneos de Document
Intelligence. Ahora la base aplica la matriz de permisos, por rol.

| El archivo cuelga de | Permiso de lectura | Roles (con `files:read`) |
|---|---|---|
| compra, comprobante, recibo, orden de pago, cheque, cheque propio, movimiento, impuesto | el del módulo | owner, admin, finance |
| cliente, proveedor | `clients:read`, `suppliers:read` | owner, admin, finance, operations |
| carga de combustible | `fuel:read` | owner, admin, operations |
| mensaje del chat | `ai:chat` + dueño de la sesión | owner, admin (todos); finance, operations (los propios) |
| escaneo (extracción) | `ai:read` + quien escaneó | owner, admin (todos); finance, operations (los propios) |
| documento de RRHH | `hr:read` | owner, admin, finance |
| documento de flota | `fleet_documents:read` | owner, admin, operations |

- **`file_attachments`:** se ve la fila si el rol lee su registro. El
  contador (`fiscal_reader`) sigue leyendo los adjuntos de impuestos por su
  propia política (`20261104050400`), que no cambia.
- **`files`:** lo ven quien lo subió y owner/admin, como antes. Los demás lo
  ven mientras alguno de los registros que lo tienen sea legible para ellos.
  Un archivo adjunto a varios registros se ve si alguno se puede leer.
- **Cómo lo pregunta:** la política de `files` consulta `file_attachments`,
  `ai_document_extractions`, `employee_documents` y `fleet_documents` con la
  RLS de quien lee. La regla vive en un solo lugar: la política de cada
  tabla. Ninguna de esas políticas lee `files`, así que no hay recursión.
- **Lo que no cambia:** las restricciones de chat, RRHH y flota siguen
  arriba. Los permisos denegados por usuario los aplica la app; la base
  aplica el techo del rol, como en el resto.
- **Depósito:** no lee ningún registro con adjuntos y no tiene pantalla que
  liste archivos (el centro de archivos no le da ningún origen). Solo ve lo
  que subió.
- **Quien subió el archivo lo sigue viendo** aunque ya no lea el registro.
  Es la misma regla que permite subir y después vincular, y no expone nada
  que no haya tenido.

## La app pide lo mismo al firmar un archivo

`getSignedFileUrlAction` firma un archivo si se cumple una de estas
condiciones:

- Alguno de sus adjuntos es de un registro cuyo módulo el usuario lee.
- Es un escaneo y el usuario tiene `ai:read` y ve la extracción. Es la regla
  de la pantalla de revisión: la extracción propia, o cualquiera para
  owner/admin.

Para saber si un archivo es un escaneo, la app consulta con el rol de
servicio, porque la RLS oculta los escaneos ajenos. La respuesta solo se usa
para negar. Si la consulta falla, se niega.

Un archivo sin adjuntos y que no es un escaneo queda a cargo de la RLS: quien
lo subió, owner/admin, o un documento de RRHH o de flota con sus propios
controles.

## Quitar un adjunto es escribir en el registro

`detachFileAction` pide `files:write` más el permiso de escritura del
registro, el mismo que pide adjuntar (`ATTACHMENT_WRITE_PERMISSION` en
`lib/files/attachment-targets.ts`). Un permiso denegado por usuario lo
frena.

Las pantallas de compra, comprobante, orden de pago, recibo y combustible
muestran «Eliminar» y la zona de subida con `canChangeAttachments`. Clientes,
proveedores e impuestos ya lo hacían.

Si la RLS no deja borrar el adjunto (no lo creó y no es owner/admin), la
acción responde «Solo quien lo adjuntó o un admin lo quita.» y no audita
nada. Antes respondía bien sin haber borrado.

Antes de borrar el archivo, la acción cuenta todos sus vínculos con el rol de
servicio (`isFileStillReferenced`). La RLS ahora oculta los adjuntos de
registros que el usuario no lee, y contarlos con su cliente podía borrar un
archivo que otro registro todavía usa.

## Entradas del escaneo

- **CUIT:** la búsqueda de cliente o proveedor usa solo los 11 dígitos
  (`normalizeCuit`). Clientes y proveedores guardan solo dígitos. Si el CUIT
  escaneado no da 11 dígitos, no se busca y la revisión dice «No se leyó el
  CUIT». El texto del modelo ya no llega al filtro de PostgREST.
- **Búsqueda que falla en todos los intentos:** en el último intento del
  paso `match`, el escaneo, que ya se pagó, se guarda con
  `lookup_failed: true` y con las comparaciones de su tipo marcadas como no
  verificadas: contraparte, duplicado o conciliación. La revisión dice «No
  se pudo verificar …: la búsqueda falló», distinto de «sin permiso».
  Emitir una factura de venta sigue frenado mientras el duplicado no se
  verificó.
- **Lecturas al crear desde un escaneo:** si falla la lectura del canal o
  del cliente al emitir, o la del proveedor, la cuenta o el centro de costo
  al abrir el borrador de compra, se muestra un error. Antes decía «Canal no
  existe.», «sin CUIT», o abría el borrador sin esos datos.
