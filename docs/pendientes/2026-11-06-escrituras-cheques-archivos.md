# 2026-11-06 — Escrituras: cheques, archivos, combustible, POS y choferes

Migraciones: `20261106110000` (cheque cargado a mano en una sola función) y
`20261106110001` (clave de importación de combustible).

- [ ] **pgTAP sin correr en la sesión** (no había stack local):
      `supabase/tests/create_manual_check_test.sql` corre en el job
      `database` de CI.
- [ ] **Un POS habilitado por canal: la regla no es real.** El canal
      interno tiene dos habilitados desde siempre: el 1 (recibos y órdenes de
      pago) y el 9001 (remitos internos, `20261101190000`). Por eso no se
      agregó un índice único en la base (habría deshabilitado el 9001). Pero
      `configurePosAction` aplica esa regla al habilitar: hoy no deja volver a
      habilitar el 1 o el 9001 si se deshabilita uno. Hay que decidir la regla
      real (¿uno por tipo de comprobante?) y ajustar la acción.

- [ ] **Importación de combustible: dos importaciones distintas a la vez.**
      La clave nueva hace idempotente la misma importación enviada dos veces
      (doble clic, reintento). Dos lecturas distintas del mismo resumen,
      confirmadas al mismo tiempo, siguen dependiendo de la revisión «ya
      existe» en TypeScript: no hay una clave natural única para una carga
      (dos cargas reales pueden coincidir en vehículo, fecha, litros e
      importe).
- [ ] **Auditoría repetida en RPC idempotentes.** `confirmDriverSettlementAction`,
      `postDriverSettlementDifferenceAction`, `confirmFreightSettlementAction`
      y `matchLinesToMovementAction` vuelven a auditar cuando la RPC devuelve
      el mismo resultado de una llamada anterior. Distinguirlo necesita que la
      RPC diga si hizo algo; queda para otro cambio.
- [ ] **Invitación sin roles.** `inviteUserAction` envía la invitación antes
      de asignar roles (la cuenta no existe hasta el envío). Si la asignación
      falla, el mensaje lo dice y se arregla desde «Accesos» o volviendo a
      invitar; no se compensa borrando la cuenta, porque un reenvío a una
      cuenta pendiente devuelve la misma cuenta.
