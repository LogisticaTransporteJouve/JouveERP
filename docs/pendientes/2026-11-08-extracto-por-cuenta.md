# Extracto por cuenta (2026-11-08)

Subir el extracto del banco (CSV/Excel) desde la cuenta y convertir cada línea en su registro con un
clic. Plan en tres PRs.

- [x] **PR 1 — código del banco y página de la cuenta.** `bank_statement_lines.bank_code` (en Macro,
      «Código Causal»); el importador lo lee y, al volver a subir un archivo, completa el código de
      las líneas cargadas sin él (`import_runs.filled_rows`). `/accounts/[id]` con «Extracto»
      (conciliación de la cuenta + «Subir extracto») y «Movimientos». El mes del extracto va en
      la URL (`?month=`).
- [ ] Aprobar la migración `20261107190000_bank_statement_code` con el deploy. Rollback: el código
      anterior no manda `bank_code` ni `fill_only` y el importador inserta como antes; las líneas
      guardan el código que ya tenían.
- [ ] **PR 2 — propuestas y pestañas**: una propuesta por línea (conciliar, gasto, Ley 25.413 en una
      cuenta nueva 5.4.3, SIRCREB/percepción IIBB a su cuenta de activo, documentos de impuesto),
      aprendida de lo que se aceptó antes.
- [ ] **PR 3 — un clic para cobros, pagos, factura del banco, transferencias y cuotas**, con reclamo
      de la línea para no crear dos veces.
- [ ] Después: extractos en PDF, cheques («marcar cobrado» desde la línea), la parte computable de la
      25.413 contra Ganancias y el número de cuenta para validar el archivo subido.
