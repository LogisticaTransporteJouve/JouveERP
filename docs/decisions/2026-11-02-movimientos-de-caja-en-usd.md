# 2026-11-02 — Movimientos de caja en USD

**Decisión.** Un movimiento lleva la moneda de su cuenta (guard en la base) y
uno en USD se asienta en pesos a la cotización de su fecha
(`get_exchange_rate`); sin cotización no asienta y queda listado como
`sin_cotizacion` en `journal_missing_entries()`. Detalle en
`docs/accounting-patterns.md` §3.5.

**Descartado.** Guardar una cotización por movimiento: ningún escritor salvo
recibos y OP (que ya asientan con la suya) la conoce hoy.
