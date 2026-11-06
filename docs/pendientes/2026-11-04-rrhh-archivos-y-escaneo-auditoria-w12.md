# Pendientes — Liquidaciones, archivos guardados y escaneo (auditoría w12)

Decisiones: `docs/decisions/2026-11-04-rrhh-archivos-y-escaneo-auditoria-w12.md`.

- [x] **Blobs sin fila en `files`.** (Resuelto: `writeFileBlobAndRow` y
      `discardStoredFile` borran el blob con el cliente de servicio, y
      `discardStoredFile` solo lo borra si la fila se fue.) Si el alta de la fila falla después de
      subir el blob (`storeUploadedFile`, `scanDocumentAction`) o
      `discardStoredFile` borra la fila antes que el blob, el `remove` del
      cliente del usuario no lo encuentra: el DELETE de storage filtra por
      nombre y Postgres exige también `files_storage_select`, que pide una
      fila. Pasaba igual antes de `20261104194101`. El barrido de huérfanos
      recorre filas, no blobs, así que esos blobs quedan. Arreglo posible:
      borrar el blob primero en `discardStoredFile` y hacer el rollback con el
      cliente de servicio, o un barrido de blobs sin fila.
- [ ] **Keys que ya nombran dos filas.** `194101` impide crear una fila con
      una key de otro usuario, pero no revisa las que ya existan. Si la
      consulta de control de `antes-de-promover.md` devuelve alguna, el
      barrido de huérfanos podría borrar el blob de la fila vigente al borrar
      la otra. `delete_orphan_files` no mira si otra fila nombra la misma key.
- [x] **`detachFileAction` responde `deletedBlob: true`** (Resuelto: usa
      `removeUnlinkedFile` y responde lo que de verdad borró.) aunque la RLS no
      haya dejado borrar ni el blob ni la fila (finance quitando el último
      vínculo de un archivo que subió otro). Ninguna pantalla lo lee hoy; el
      barrido limpia ambos.
- [x] **Escaneo: una búsqueda de contraparte que falla** (error de la base en
      `matchDocument`) sigue mostrando «No se encontró el cliente/proveedor
      por CUIT». El marcador nuevo `counterparty_unchecked` cubre solo la
      búsqueda que no se corrió por permisos. — hecho: una búsqueda que falla en todos los reintentos guarda `lookup_failed` + `counterparty_unchecked` y la revisión dice «No se pudo verificar … la búsqueda falló» (`features/ai/document/store.ts:81-105`, `components/review-actions.tsx:103`).
- [ ] **Escaneos guardados antes de este cambio** con un lector de quien
      escaneó que falló quedaron sin comparar y no tienen el marcador. Se
      arreglan volviendo a escanear.
- [x] **pgTAP sin correr en la sesión.**
      `supabase/tests/payroll_period_posts_accounts_w12_test.sql` y
      `supabase/tests/files_storage_write_ceiling_w12_test.sql` se
      escribieron sin Supabase local. El segundo inserta y borra en
      `storage.objects` con SQL (pone `storage.allow_delete_query`); corre en
      CI. — hecho: corre verde en el job `database` de CI (`main` en `e239ee7`).
