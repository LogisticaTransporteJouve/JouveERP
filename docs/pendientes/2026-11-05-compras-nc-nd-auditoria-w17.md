# 2026-11-05 — Compras: NC/ND contra su origen (auditoría w17)

Decisión: `docs/decisions/2026-11-05-compras-nc-nd-auditoria-w17.md`.
Migración: `20261105140000`.

- [x] **Guía: error de moneda de una NC/ND de compra.** La tarea «Cargar una
      nota de crédito o débito de un proveedor» lista los errores de origen,
      pero no «La factura de origen está en otra moneda: una NC/ND va en la
      misma moneda que su factura». Sumarlo (la guía es de otra sesión). — hecho: `features/guide/manual/content/compras.ts:1204`.
- [ ] **El selector de factura origen muestra todo en pesos.** Lista y
      muestra el total con formato ARS aunque la factura sea en dólares.
      Mostrarlo en su moneda.
- [x] **«Factura origen (opcional…)».** Desde `20261031195001` una NC/ND
      nueva necesita su origen; la etiqueta todavía dice «opcional». Solo una
      nota vieja sin origen puede seguir sin él. — hecho: la etiqueta dice «Factura origen» (`features/purchase-invoices/components/purchase-invoice-form.tsx:1278`).
