# Tesorería y Gestión: auditoría w4 (2026-11-04)

- [x] **Cheque propio de una OP fijo a la OP** (`20261104120200`): la base
      rechaza cambiarle la OP, el monto, la moneda o la cuenta (antes solo
      lo frenaba la app; un PATCH por PostgREST hacía que cobrarlo o
      rechazarlo contara la plata dos veces). Las filas existentes no se
      tocan; producción no tiene OP.
- [x] **Gestión en percibido, OP que paga un cheque rechazado**
      (`20261104120201`): esa parte de la OP toma las proporciones de la OP
      que entregó el cheque (empleado, flota, neutro), así una compra neutra
      pagada con un cheque que rebotó y se volvió a pagar suma 0.
- [ ] La cadena de rebotes se sigue hasta 3 OP hacia atrás; más allá, esa
      parte queda en Proveedores.
- [x] La IA (`getIssuedChecks`, `getChecks`) suma solo los cheques abiertos
      (propios sin cobrar; de terceros en cartera o depositados) y dice que
      la lista de los cerrados está recortada. `getTreasurySummary` y el
      recuadro de Tesorería dicen que los cheques por acreditar son en pesos.
- [x] Préstamos: «Nuevo préstamo» y «Anular» de la lista piden
      `accounting:write`, como el detalle.
- [x] Conciliación no ofrece pagar una DDJJ de IVA que solo deja saldo a
      favor (`taxDocumentNeedsPayment`).
- [x] No verificado contra una base real: las migraciones y sus pgTAP
      (`issued_check_pinned_to_order`, `management_rejected_check_op_shares`). — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
