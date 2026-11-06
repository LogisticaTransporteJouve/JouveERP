# Tesorería: guardas de cheques, auditoría w5 (2026-11-04)

- [x] **Cheque propio ligado a una OP solo desde la OP** (`20261104123000`):
      `guard_issued_check_edit` corre también en INSERT y rechaza un cheque
      propio que llega ya ligado a una orden de pago, salvo que lo cargue
      `create_payment_order` o `update_payment_order`. Antes, un POST por
      PostgREST creaba un cheque de una OP que nunca lo pagó; rechazarlo
      sumaba plata al banco y deuda al proveedor. Las filas existentes no se
      tocan.
- [x] **Cheque de terceros fijo** (`20261104123001`): `guard_check_edit`
      rechaza cambiar monto, moneda, cartera, recibo o estado de un cheque
      fuera de sus RPC (depositar, acreditar, rechazar, vender, rechazar como
      deuda, la OP que lo endosa) y de los triggers de anulación. Antes, un
      PATCH (monto 100 → 150, o depositado → en cartera) hacía que el
      depósito moviera el monto nuevo o lo moviera dos veces. Notas y
      vencimiento siguen editables. El permiso de UPDATE se mantiene porque
      `deposit_check`, `credit_check`, `reject_check` y `create_payment_order`
      corren como el usuario.
- [x] **Cheques que mueven plata piden movimientos**: cargar, depositar,
      acreditar, rechazar, vender, anular una venta y crear cheques desde el
      escaneo IA piden `transactions:write` además de `cheques:write`
      (`CHECK_CASH_PERMISSIONS`). Ver
      [la decisión](../decisions/2026-11-04-cheques-que-mueven-plata-piden-movimientos.md).
- [ ] Revisar en producción si hay cheques propios con `payment_order_id`
      que no figuran en `payment_order_payment_lines` (cargados por la API
      antes de esta guarda). Producción no tiene OP, así que se espera
      ninguno.
- [x] No verificado contra una base real: las migraciones y sus pgTAP
      (`check_edit_guards`, `checks_channel` adaptado). — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
