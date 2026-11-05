# 2026-11-05 — Vencimiento de ventas a 7 días y tareas automáticas

Decisión: `docs/decisions/2026-11-05-vencimiento-de-ventas-a-7-dias.md`.
Migraciones: `20261105231000`, `20261105231001`.

- [ ] **Guía: textos que dejaron de ser ciertos** (la guía es de otra sesión):
  - `features/guide/manual/content/ventas.ts`, aging: «Los días se cuentan
    desde el vencimiento de pago del comprobante (o desde su fecha, si no
    tiene)». Ahora: desde su vencimiento, que es 7 días después de la fecha
    salvo que el comprobante traiga uno posterior.
  - `features/guide/manual/content/plataforma.ts`, Tareas: «en las abiertas,
    el botón {{Hecha}}» (ya no en las automáticas); «{{Ir al documento}} te
    lleva a la pantalla donde se resuelve» (ahora abre el registro, y una
    cobranza o un pago ofrecen {{Cobrar}} / {{Pagar}}); la tarea «Marcar una
    tarea como hecha» (una automática no se marca: se cierra sola, y su
    detalle dice «Se cierra sola cuando …»); {{Responsables}} se ve como
    iniciales.
- [ ] **Plazo de pago por cliente.** Los clientes no tienen columna de plazo;
      si se agrega, entra en `invoice_effective_due_date` (y en
      `SALES_INVOICE_DUE_DAYS` si cambia el valor por defecto).
- [ ] **Cerrar al cobrar, no a la mañana siguiente.** Una tarea de cobranza
      cuyo comprobante se cobra hoy se cierra en la corrida de `tasks-daily`
      de mañana (06:17). Si molesta, el recibo podría pedir una
      sincronización al emitirse.
