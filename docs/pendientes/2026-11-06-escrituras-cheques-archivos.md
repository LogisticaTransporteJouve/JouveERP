# 2026-11-06 — Escrituras: cheques, archivos, combustible, POS y choferes

Migraciones: `20261106110000` (cheque cargado a mano en una sola función),
`20261106110001` (clave de importación de combustible), `20261106110002` (un
POS habilitado por canal).

- [ ] **pgTAP sin correr en la sesión** (no había stack local):
      `supabase/tests/create_manual_check_test.sql` y
      `supabase/tests/sales_points_one_enabled_per_channel_test.sql` corren en
      el job `database` de CI.
- [ ] **POS habilitados de más.** Si un canal ya tiene más de un POS
      habilitado, `20261106110002` deja habilitado el de número más bajo (el
      que ya numeran recibos y órdenes de pago) y deshabilita los otros, con
      un `NOTICE` por cada uno. Al emitir una factura en ese canal ya no se
      ofrecen esos otros POS. Consulta de control antes de promover (solo
      lectura; lo esperado es que no devuelva filas):

      ```sql
      select channel_id, array_agg(numero order by numero) as habilitados
        from public.sales_points
       where is_enabled and channel_id is not null
       group by channel_id
      having count(*) > 1;
      ```

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
