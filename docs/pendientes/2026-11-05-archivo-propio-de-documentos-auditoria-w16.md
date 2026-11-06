# Pendientes — Un documento de flota o de RRHH tiene un archivo propio (auditoría w16)

Decisiones: `docs/decisions/2026-11-05-archivo-propio-de-documentos-w16.md`.

- [x] **Un documento de flota o de RRHH no puede apuntar a un archivo que ya
      vincula otro registro** (`20261105130100`, w16-s4 F1). Lo rechazan la
      base y `linkableFileError`.
- [x] **Vincular un archivo existente a un documento pide `files:write`**
      (w16-s4 F2).
- [x] **Una lectura fallida del archivo ya no se informa como «No
      encontramos el archivo adjunto.»** (w16-s6 F3).
- [x] **`docs/files-patterns.md` §3.2 ter** describe las reglas de escritura
      de w15 y la de w16 (w16-s7 nit 1).
- [x] **Correr la consulta de control antes de promover**
      (`antes-de-promover.md`, ítem `20261105130100`). Lista los documentos
      que hoy apuntan a un archivo con otro vínculo. Lo esperado es que no
      devuelva nada. Si devuelve filas, el owner decide desde la pantalla del
      documento si le sube un archivo propio: la migración no las toca. — hecho: aprobada con su consulta de control y promovida (ítem tildado en `antes-de-promover.md`; la migración está en `production-latest`, `bbe08b38`).
- [ ] **`is_linked_file` sigue ejecutable por `authenticated`**
      (`20261105090100`). Un usuario puede preguntar por RPC si un id de
      archivo está vinculado. La guarda nueva lo necesita así, porque es
      `SECURITY INVOKER`. Si se quiere cerrar, hay que mover la pregunta a una
      función `SECURITY DEFINER` propia de la guarda.
