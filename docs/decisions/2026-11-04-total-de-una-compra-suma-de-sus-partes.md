# 2026-11-04 — Total de una compra = suma de sus partes

**Decisión.** Una compra tiene que cumplir total = neto + IVA + otros
tributos + no gravado + exento (tolerancia de un centavo). Lo valida el
formulario, Zod al crear, la acción al editar (con los importes guardados de lo
que la edición no manda) y, en compras fiscales, el trigger
`guard_purchase_invoice_total`. Se valida al insertar y cuando una edición
cambia un importe o el canal: una compra vieja con diferencia sigue guardando
ediciones que no tocan importes. En modo encabezado se quitó "guardar igual";
el formulario ofrece pasar la diferencia a no gravado (A fiscal) o al neto. En
modo ítems el total sale de las líneas y el "guardar igual" contra el total
impreso del comprobante escaneado queda.

**Por qué.** El asiento acredita a proveedores la suma de las partes y la
cuenta corriente, el aging y las OP usan el total: la diferencia quedaba en
proveedores para siempre.

**Descartado.** Backfill de las filas existentes (lo decide el dueño con la
consulta de **Antes de promover**). Guard en la base para compras internas: no
generan asiento y frenaría fixtures y escritores viejos sin necesidad.
