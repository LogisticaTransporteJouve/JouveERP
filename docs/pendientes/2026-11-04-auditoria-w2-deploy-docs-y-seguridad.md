# Auditoría w2: deploy, docs y seguridad (2026-11-04)

- [x] **Stamps de migración:** `pnpm check:migrations` (y CI) rechaza una
      versión nueva que no es una fecha y hora UTC reales (`…096000`, minuto
      60). `pnpm db:restamp` ya no se niega cuando `main` está adelantado al
      reloj: estampa el segundo real siguiente a su máximo
      (`CONTRIBUTING.md`, "Migraciones").
- [x] **CHECK sin validar:** `20261104104000` valida los seis que habían
      quedado `NOT VALID` (tipos de aviso, destino de adjuntos, origen de
      tareas y tres de impuestos).
- [x] **PDF y avisos:** un error al generar un PDF (comprobante, recibo, OP,
      liquidación, rendición, libros IVA) o al leer o marcar los avisos va al
      log; el usuario ve un mensaje fijo sin el texto de la base.
- [x] **Login:** un ingreso fallido loguea solo el dominio del email.
- [x] **Invitar usuario:** los roles se asignan por `set_user_access` (el
      mismo escritor que el diálogo de accesos); una cuenta que ya tiene roles
      se rechaza en la misma transacción.
