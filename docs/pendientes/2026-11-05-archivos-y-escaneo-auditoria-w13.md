# Pendientes — Archivos guardados y búsquedas del escaneo (auditoría w13)

Decisiones: `docs/decisions/2026-11-05-archivos-y-escaneo-auditoria-w13.md`.

- [x] **El escaneo reemplazado o el de un documento borrado se borra en el
      momento** (flota y RRHH), con auditoría en el documento.
- [x] **Un archivo sin vínculo lo ven solo quien lo subió y owner/admin**
      (`20261105090100`).
- [x] **Una key guardada no se vuelve a subir, ni siquiera quien la subió**
      (`20261105090100`).
- [x] **Una búsqueda de contraparte, de duplicados o de conciliación que
      falla en el escaneo se reintenta.** Ya no queda guardada como «no se
      encontró» o «sin movimientos». Este ítem estaba abierto en
      `2026-11-04-rrhh-archivos-y-escaneo-auditoria-w12.md`.
- [x] **Archivos sueltos que ya existen en producción.** Los escaneos de
      flota reemplazados antes de este cambio los borra el barrido de las
      03:00. También quedan sueltos, hasta ese barrido, los archivos de
      documentos que se borran por otro camino: deshacer una importación o
      borrar un vehículo, chofer o empleado. Después de `20261105090100`,
      cualquier archivo suelto lo ven solo quien lo subió y owner/admin. La
      consulta de control está en `antes-de-promover.md`. — hecho: `20261105090100` aprobada con su consulta de control y en producción (ítem tildado en `antes-de-promover.md`).
- [ ] **Quien escaneó ya no existe** (`created_by` en null): la revisión
      sigue diciendo «No se pudo verificar … (sin permiso): quien escaneó el
      documento no tiene acceso». No se sabe si tenía acceso. Hace falta un
      marcador propio para ese caso.
- [x] **Un escaneo cuya búsqueda falla en todos los reintentos queda
      «fallido»** y se vuelve a escanear, con un costo nuevo de IA. Antes se
      guardaba con una respuesta equivocada. — hecho: el último reintento guarda la toma pagada con sus comparaciones marcadas sin verificar, no «fallido» (`unverifiedMatches`, `features/ai/document/store.ts:81-105`).
- [ ] **Escaneos guardados antes de este cambio** con una búsqueda que
      falló siguen diciendo «No se encontró». Se arreglan volviendo a
      escanear.
- [x] **pgTAP sin correr en la sesión.**
      `supabase/tests/files_unlinked_visibility_w13_test.sql` es nuevo.
      `files_storage_write_ceiling_w12_test.sql` cambió: quien subió tampoco
      puede volver a llenar su key. En `fleet_hr_followups_test.sql`, el
      archivo suelto pasa a ser de finanzas. Corren en CI. — hecho: corre verde en el job `database` de CI (`main` en `e239ee7`).
