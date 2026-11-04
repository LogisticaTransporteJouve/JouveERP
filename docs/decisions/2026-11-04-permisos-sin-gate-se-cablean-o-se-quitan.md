# 2026-11-04 — Permisos sin gate: se cablean o se quitan

**Decisión.** Cada permiso de la matriz tiene que leerse en algún gate (lo
exige `lib/auth/permissions.test.ts`). `retentions:write` y
`stock_movements:write` se cablean: cargar o cambiar retenciones de un recibo
pide `receipts:write` + `retentions:write` (sin él, una edición solo puede
devolver las retenciones guardadas sin cambios); entrar, despachar o borrar un
pallet pide `pallets:write` + `stock_movements:write`, y editarlo cambiando
depósito, estado, cantidad, ingreso o egreso también. Se quitan
`channels:read/write`, `files:admin`, `retentions:read`,
`credit_debit_notes:read` y `stock_movements:read`: las retenciones se ven con
el recibo, las NC/ND con los comprobantes (`invoices:read`), los movimientos
con los pallets, y borrar adjuntos ajenos va por `files:write` + RLS.

**Denegaciones guardadas.** Una denegación de un `:read` quitado ocultaba su
módulo, incluida la escritura que queda; `20261104096100` la convierte en
denegación de esa escritura. Las filas viejas quedan (el código las ignora;
un rollback las lee como antes).

**Descartado.** Ocultar los permisos en el diálogo sin quitarlos: la matriz
seguiría ofreciendo como "aplicada" una denegación que no llega a nada.
