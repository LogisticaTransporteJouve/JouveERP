# Tesorería: auditoría de cheques, OP y préstamos (2026-11-04)

- [x] Anular o editar una OP no devuelve a cartera un cheque endosado
      rechazado; se rechaza con mensaje.
- [x] Cuotas sin desglose bajan `prestamos` (capital primero) si el pasivo
      está asentado; anular un préstamo con plata se rechaza.
- [x] Cheque propio sin OP: el cobro asienta gasto, no reversa de pasivo; no
      cambia importe, moneda ni cuenta después de emitido; no se le liga OP.
- [x] Mora: el prorrateo cuenta solo NC emitidas.
- [x] Cheques y cheques propios: completos los abiertos, 500 recientes del
      resto con aviso; la guarda de cuentas de cheques falla cerrada.
- [x] UI: "Pagar" deuda de cheque vendido sin estado viejo; ND por mora
      refresca aunque falle el vínculo; resultados de varias ND con su
      comprobante.
- Aprobación de `20261104093000`–`20261104093400`: en **Antes de
  promover**.
- [ ] Filas existentes sin tocar: cuotas sin desglose ya pagadas y cheques
      propios sin OP ya cobrados conservan su asiento viejo hasta que algo los
      re-asiente (revisar `prestamos` y `cheques_diferidos_emitidos`). Lo
      mismo para una cuota sin desglose pagada antes de registrar el
      desembolso: queda en gasto y `prestamos` no llega a cero. Re-asentarlas
      cambia períodos pasados: lo decide el owner.
- [ ] `journal_missing_entries` no lista los asientos de cheques propios: un
      cheque propio en USD cobrado sin cotización ese día queda sin asiento
      y sin aviso en el paquete mensual.
- [x] pgTAP verde en CI (stack fresco: `payment_order_rejected_endorsed_checks`,
      `loan_liability`, `issued_checks_manual_cashing`,
      `late_interest_emitted_nc`); sin verificar contra datos de producción:
      las migraciones. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
