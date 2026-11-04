# 2026-11-04 — Cheques propios e importación de cheques piden movimientos

**Decisión.** Extiende
[«Los cheques que mueven plata piden movimientos»](2026-11-04-cheques-que-mueven-plata-piden-movimientos.md)
a los dos caminos que había dejado afuera (auditoría w6 · S4 F1 y F2):

- **Cheques propios.** Marcar un cheque propio como «Cobrado» (sin OP,
  registra el egreso del banco) o «Rechazado» (de una OP, registra el ingreso
  de vuelta) pide `transactions:write` además de `issued_checks:write`
  (`ISSUED_CHECK_CASH_PERMISSIONS`, `features/issued-checks/lib/issued-check-cash.ts`).
  En la tabla de cheques emitidos esos dos botones se ocultan y una línea dice
  por qué. «Anular» y «Editar» no mueven Caja y siguen con
  `issued_checks:write`.
- **Importar «Cheques en cartera».** Cada fila entra como cheque cargado a
  mano y registra su ingreso a la cartera; deshacer la importación lo borra.
  Importar y deshacer piden `imports:write` más `CHECK_CASH_PERMISSIONS`
  (`cheques:write` y `transactions:write`). La lista de tipos del importador
  usa la misma regla, así que el tipo no aparece sin el permiso.

**Matriz.** No cambia: todo rol con `issued_checks:write` o `cheques:write`
tiene `transactions:write`. Cambia lo que frena una denegación por usuario de
`transactions:write`.
