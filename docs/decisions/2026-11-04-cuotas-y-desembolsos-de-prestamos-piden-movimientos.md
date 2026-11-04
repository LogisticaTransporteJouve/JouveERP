# 2026-11-04 — Cuotas y desembolsos de préstamos piden movimientos

**Decisión.** Pagar una cuota, registrar el desembolso y vincular un egreso a
una cuota piden `accounting:write` y `transactions:write`
(`LOAN_CASH_PERMISSIONS`), como pagar un impuesto. Editar una cuota sigue con
`accounting:write`. Los botones se ocultan sin el permiso.

**Descartado.** Mover el pago de la deuda de un cheque vendido en el mismo
cambio: queda en la decisión abierta de RRHH (`docs/pendientes.md`).
