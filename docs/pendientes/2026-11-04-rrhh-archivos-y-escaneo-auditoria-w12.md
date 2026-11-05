# Pendientes — Liquidaciones, archivos guardados y escaneo (auditoría w12)

Decisiones: `docs/decisions/2026-11-04-rrhh-archivos-y-escaneo-auditoria-w12.md`.

- [ ] **Blobs sin fila en `files`.** Si el alta de la fila falla después de
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
- [ ] **`detachFileAction` responde `deletedBlob: true`** aunque la RLS no
      haya dejado borrar ni el blob ni la fila (finance quitando el último
      vínculo de un archivo que subió otro). Ninguna pantalla lo lee hoy; el
      barrido limpia ambos.
- [ ] **Escaneo: una búsqueda de contraparte que falla** (error de la base en
      `matchDocument`) sigue mostrando «No se encontró el cliente/proveedor
      por CUIT». El marcador nuevo `counterparty_unchecked` cubre solo la
      búsqueda que no se corrió por permisos.
- [ ] **Escaneos guardados antes de este cambio** con un lector de quien
      escaneó que falló quedaron sin comparar y no tienen el marcador. Se
      arreglan volviendo a escanear.
- [ ] **pgTAP sin correr en la sesión.**
      `supabase/tests/payroll_period_posts_accounts_w12_test.sql` y
      `supabase/tests/files_storage_write_ceiling_w12_test.sql` se
      escribieron sin Supabase local. El segundo inserta y borra en
      `storage.objects` con SQL (pone `storage.allow_delete_query`); corre en
      CI.
