# Decisiones — Un documento de flota o de RRHH tiene un archivo propio (auditoría w16)

Pendientes: `docs/pendientes/2026-11-05-archivo-propio-de-documentos-auditoria-w16.md`.

## Un documento solo apunta a un archivo que nada más vincula

`20261105130100`. La política de lectura de `files` oculta el archivo de un
documento de flota a quien no es owner, admin u operations, y el de un
documento de RRHH a quien no es owner, admin o finance. Lo hace aunque otro
registro también lo tenga. La regla de w15 solo pedía que quien vincula ya
viera el archivo, y un adjunto de un cliente o de un proveedor lo ven finanzas
y operaciones. Así, operaciones podía apuntar un documento de flota al
contrato de un cliente, o finanzas un documento de RRHH a un archivo de un
proveedor. El otro rol, incluso quien lo subió, dejaba de verlo mientras el
documento existiera.

La decisión de w15 decía que ese camino estaba cerrado; solo lo estaba para
archivos que el otro rol no veía.

Ahora:

- **En la base:** `guard_link_file_visible` rechaza, en `fleet_documents` y
  `employee_documents`, un archivo que ya vincula otro registro: un adjunto
  (de cualquier registro, chat incluido), un escaneo u otro documento de
  flota o de RRHH. Usa `is_linked_file` (`SECURITY DEFINER`, ve todos los
  vínculos). El error es `55006` con `jouve_guard` y el texto «Ese archivo ya
  está vinculado a otro registro.», que la app muestra tal cual.
- **Corre después del chequeo de visibilidad:** un archivo que quien escribe
  no ve sigue rechazado con `42501`, sin decir si está vinculado.
- **Vale para todos**, owner y service role incluidos: el archivo de un
  documento es suyo. Ningún camino de la app ni del importador vincula un
  archivo existente. El importador crea documentos sin archivo, los crons de
  vencimientos solo marcan `notified_at` y los seeds no ponen archivo.
- **En una edición corre solo si cambia el archivo:** la fila del propio
  documento no cuenta, y editar otro campo de un documento que ya compartía
  su archivo sigue pasando.
- **En la app**, `linkableFileError` (`lib/files/store.ts`) pregunta lo
  mismo con el service role, después del permiso de la acción. Las ediciones
  lo preguntan solo para un archivo distinto del que el documento ya tiene.
- **Vincular un archivo existente pide `files:write`** en el alta y la
  edición de documentos de flota y de RRHH, como subirlo (w16-s4 F2). Quitar
  el archivo sigue pidiendo solo el permiso del documento.
- **Una lectura fallida del archivo** dice «No se pudo leer el archivo
  adjunto. Reintentá.», no «No encontramos el archivo adjunto.» (w16-s6 F3).

## Lo que no cambia

- **Filas existentes:** no se revisan ni se tocan. La consulta de control de
  `antes-de-promover.md` (ítem `20261105130100`) lista los documentos que hoy
  apuntan a un archivo con otro vínculo.
- **Al revés no hace falta:** adjuntar a otro registro el archivo de un
  documento no le quita lectura a nadie. Los techos de flota y RRHH ya se
  aplicaban por el documento.
- **Dos altas simultáneas con el mismo archivo** pueden pasar las dos. Ninguna
  pantalla manda un archivo existente, así que la app no compite consigo
  misma.
