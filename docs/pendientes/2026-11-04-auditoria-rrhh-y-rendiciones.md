# Auditoría RRHH y rendiciones (2026-11-04)

- [x] SAC de la liquidación final estable al reaplicar (`20261104095000`).
- [x] Embargo tipeado a mano en un borrador sobrevive a los cambios de
      embargos judiciales (`embargo_override`, `20261104095100`).
- [x] Compra a cargo de empleado: en canal fiscal se le carga el neto, igual
      que el asiento a anticipos al personal (`20261104095200`).
- [x] Extras de viajes: lecturas paginadas y marca de parcial real.
- [x] Rendiciones: "Resolver diferencia" a cargo del chofer (salda al
      cliente con un recibo y le carga un adelanto) o del cliente (queda
      abierta en su cuenta); quitar y cancelar lo deshacen; sin `hr:write` no
      se saca lo que está en la cuenta del chofer (`20261104095300`).
- [ ] Descuento de planilla sin plan ni cargo: queda saldo a favor del
      empleado (decisión en
      `docs/decisions/2026-11-04-auditoria-rrhh-y-rendiciones-sac-embargo-compra-a-cargo.md`); si molesta, agregar un
      aviso al cerrar el período.
- Aprobación de `20261104095000`–`20261104095300` y revisión previa de
  `20261104095200`: en **Antes de promover**.
- [ ] Diferencias asentadas al chofer antes de `20261104095300`
      (movimiento `charge` o `payment` con `driver_settlement_id`): un
      faltante deja también la factura del cliente abierta y un sobrante queda
      a cuenta del cliente y acreditado al chofer, dos veces. No se reparan
      solos; en Rendiciones, "Quitar diferencia" y volver a resolverla los
      deja en una sola cuenta.
- [ ] Gestión percibido: el pago (OP) de una compra a cargo de empleado va
      entero a "Anticipos al personal" (`f_employee` en
      `management_pnl_lines`), pero al empleado ahora se le carga el neto: en
      canal fiscal el IVA queda en anticipos y no en el costo. Ajustar
      `f_employee` a la parte que se le carga (`amount / imp_total` del
      cargo) sobre la definición de `20261104092000`.
- [ ] No verificado contra una base real: las cuatro migraciones y los pgTAP
      `payroll_audit_fixes`, `driver_settlement_differences`,
      `driver_settlements`, `employee_accounts`, `payroll_receipt_sac`.
