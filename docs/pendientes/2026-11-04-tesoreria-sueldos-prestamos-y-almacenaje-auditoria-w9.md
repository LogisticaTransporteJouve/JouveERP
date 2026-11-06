# Sueldos, préstamos y almacenaje: guardas de vínculos, auditoría w9 (2026-11-04)

Ver [la decisión](../decisions/2026-11-04-tesoreria-sueldos-prestamos-y-almacenaje-auditoria-w9.md).

- [x] **El movimiento de un pago de sueldo no se cambia** (`20261104160000`).
- [x] **Una cuota pagada no se borra**, y **las condiciones y el estado de un
      préstamo cambian solo por su camino** (`20261104160001`).
- [x] **El almacenaje no emite un segundo CAE por un período**: la reserva
      vincula la factura que quedó sin registrar, y un período no se vincula
      a una factura fallida o anulada (`20261104160002`).
- [x] **Notas de rollback de `150001` y `150201`** en
      `antes-de-promover.md`: el código de `production-latest` no llama a
      `get_vehicle_margin` ni registra desembolsos. El comentario de la
      migración ya mergeada `20261104150201` («older code reads center_cost
      as a number») dice lo mismo que la nota vieja y queda así: no se edita
      una migración mergeada.
- [x] No verificado contra una base real: las tres migraciones y el pgTAP
      `treasury_payroll_loan_storage_w9`. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
- [ ] Fuera de alcance: `storage_billing_runs` sigue abierta a PATCH de sus
      otras columnas (período, totales) para owner, admin y finance, como
      antes.
