# Decisiones — Archivos guardados y búsquedas del escaneo (auditoría w13)

Pendientes: `docs/pendientes/2026-11-05-archivos-y-escaneo-auditoria-w13.md`.

## El escaneo que un documento deja de usar se borra en el momento

Cuando se reemplaza o se quita el escaneo de un documento de flota o de
RRHH, o se borra el documento, el archivo anterior se borra en el momento:
la fila de `files` y sus bytes. Antes quedaba sin vínculo hasta el barrido
de las 03:00 y, mientras tanto, lo veían y lo podían descargar finanzas y
depósito (flota) u operaciones y depósito (RRHH).

- Lo hace `removeReplacedFile` (`lib/files/remove-unlinked.ts`) con el
  cliente de servicio, después del permiso de la acción y de que el cambio
  se guardó. Usa `delete_orphan_files` sin margen de antigüedad: vuelve a
  revisar dentro del borrado que nada vincule el archivo (adjuntos,
  extracciones, documentos de RRHH o de flota), así que un archivo que otra
  cosa usa se queda.
- Se audita en el documento: `fleet_document.file_removed` /
  `employee_document.file_removed`, con el `file_id`.
- Si falla, se registra y se deja al barrido. La acción responde igual que
  antes.

## Un archivo sin vínculo lo ven solo quien lo subió y owner/admin

`20261105090100`: la política de lectura de `files` suma una condición. Un
archivo que nada vincula lo ven solo quien lo subió y owner/admin
(`is_linked_file`, DEFINER, con la misma lista que `find_orphan_files`). Sus
bytes también, porque `files_storage_select` sigue a la fila. Cubre lo que el
borrado inmediato no cubre: un fallo del borrado, el código anterior en un
rollback y cualquier otro camino que deje un archivo suelto.

Subir y después vincular sigue funcionando. En todos los caminos de la app,
quien vincula es quien subió: los adjuntos, los documentos de flota y el
escaneo. Los adjuntos del chat, el barrido y la descarga del escaneo usan el
cliente de servicio.

## Una key guardada se escribe una sola vez

`files_storage_key_is_free` considera ocupada una key que nombra cualquier
fila de `files`, también una propia. Antes, quien había subido un archivo
vinculado podía borrar sus bytes y subir otros con la misma key, y la fila y
sus vínculos seguían apuntando ahí. Ningún camino de la app reusa una key:
cada subida usa una key nueva al azar con `upsert: false`, antes de que
exista su fila. Los avatares (bucket `avatars`) y los backups
(`backups-daily`) no usan esta función.

## Escaneo: una búsqueda que falla se reintenta

- La búsqueda del cliente o proveedor por CUIT y la de duplicados
  (`matchDocument`) tiran el error de la base. El paso `match` de Inngest
  reintenta y, si sigue fallando, el escaneo queda «fallido» y se vuelve a
  escanear. Antes un error de la búsqueda de contraparte quedaba guardado
  como «No se encontró el cliente/proveedor por CUIT». Un error de la de
  duplicados quedaba como «No se pudo verificar si ya está cargado», lo
  mismo que un duplicado que no se buscó por permisos (eso no cambia).
- La conciliación de un extracto (`reconcileExtracto`) también tira el error
  de lectura. Si el período supera las 5000 filas, guarda
  `matches.reconciliation_unchecked` y la revisión dice «Conciliación no
  calculada: el período tiene demasiados movimientos». Antes las dos cosas
  quedaban igual que un extracto sin movimientos: sin línea de conciliación.
- Si no se leyó el CUIT de la contraparte, la revisión lo dice («No se leyó
  el CUIT del cliente/proveedor…») en lugar de «No se encontró … por CUIT».
