# Pendientes — Quién escribe un vínculo a un archivo (auditoría w15)

Decisiones: `docs/decisions/2026-11-05-vinculos-de-archivos-w15.md`.

- [x] **Un vínculo a un archivo lo escribe quien escribe el registro, a su
      nombre, y sobre un archivo que ya ve** (`20261105120000`, w15-s4 F1).
      Vale para adjuntos, extracciones y documentos de flota y de RRHH.
- [x] **Firmar un adjunto del chat pide `ai:chat`** (w15-s4 F2).
- [x] **Correr la consulta de control antes de promover**
      (`antes-de-promover.md`, ítem `20261105120000`). Lista los vínculos
      existentes cuyo autor no pasaría la regla nueva. Lo esperado es que no
      devuelva nada. Si devuelve filas, el owner decide si quitar el vínculo:
      la migración no las toca. — hecho: aprobada con su consulta de control y promovida (ítem tildado en `antes-de-promover.md`; la migración está en `production-latest`, `bbe08b38`).
- [ ] **Los documentos de flota y de RRHH no guardan quién cambió su
      archivo**, solo quién creó el documento (`created_by`). Lo registra la
      auditoría (`fleet_document.file_attached`, `employee_document.*`), no la
      fila.
