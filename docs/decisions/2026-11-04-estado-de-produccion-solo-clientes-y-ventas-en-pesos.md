# 2026-11-04 — Estado de producción: solo clientes y ventas en pesos

**Decisión (owner).** La base de producción tiene solo clientes y facturas de
venta en pesos: ni recibos, ni comprobantes en dólares, ni compras, cheques,
órdenes de pago, préstamos, planillas o movimientos de empleados. Todo
backfill sobre esas tablas (tributos de #339, re-asiento USD de #344, cargos
de empleados de #345 y #349, cuentas congeladas de #351, compras con total
distinto de sus partes, B/C con IVA, cheques rebotados de w3, comprobantes USD
con cotización ≤ 1 de #350) es un no-op allá, y no hace falta re-asentar nada
viejo ("corregí lo que quieras"). En **Antes de promover** esos ítems quedan
marcados **N/A en producción** con su SQL, para una promoción sobre otra base.
La única revisión real que queda es la lista de borradores del reconciliador
(#340), que revisa el owner antes de promover.

**Descartado.** Borrar los ítems: su SQL sirve si se promueve sobre una base
con datos.
