# Depósito por área, lote y bloqueo; mora y venta de cheques (2026-11-03, roadmap 4.4 + 4.6)

- [x] **Áreas del depósito** (Depósitos › Áreas): zonas por depósito; el
      pallet puede estar en un área de su depósito. **Tarifa por área** en el
      tarifario del cliente: pisa a la de todas las áreas para los pallets de
      esa área; sin área todo factura igual que antes.
- [x] **Lote y vencimiento** del pallet (alta, carga masiva y edición).
- [x] **Bloqueo** de un pallet en depósito con motivo y quién lo bloqueó: no
      se despacha ni se borra hasta desbloquearlo (guard en la base); el
      despacho masivo saltea los bloqueados y lo avisa.
- [x] **Intereses por mora** (`/aging/mora`): comprobantes vencidos con saldo,
      interés simple a la tasa mensual del cliente o la general; "Generar ND"
      emite una nota de débito por comprobante con el período cobrado. Un
      período no se cobra dos veces; una ND fallida o anulada lo libera.
- [x] **Venta de cheques** (Cheques › seleccionar › Vender): los cheques
      quedan vendidos, el neto entra en la cuenta y los intereses y comisiones
      van a Intereses pagados. Un vendido rechazado sale de la cuenta de la
      venta (o la elegida) y queda como deuda del firmante.
- [ ] Aprobar las migraciones `20261103100000_storage_areas_lots_blocks`,
      `20261103100100_late_interest` y `20261103100200_check_sales` junto con
      el deploy (después de las de 4.1–4.5): sin ellas fallan el listado de
      pallets (columnas nuevas), el tarifario, la facturación de almacenaje
      (`area_id`), `/aging/mora` y la venta de cheques.
- [ ] Rollback: el código anterior factura mal a un cliente con tarifas por
      área (las toma como si fueran de todas las áreas y se superponen), no
      lista los cheques vendidos (los descarta con un log) y no puede
      rechazar uno vendido. No cargar tarifas por área hasta que el deploy
      quede firme.
- [ ] Mora: tasa por comprobante o por condición de venta. Un comprobante
      que ya se pagó entero no aparece (sin saldo abierto): la mora de los
      días hasta ese pago no se puede cobrar desde `/aging/mora`.
- [ ] Deuda con el comprador de un cheque vendido rechazado: el libro mayor
      la asienta al pagarla (como el rechazo con débito inmediato); hasta
      entonces es pasivo operativo en Tesorería y Cheques, no una cuenta del
      plan. Una cuenta "Deudas por cheques vendidos" en el mayor necesita
      tocar `build_transaction_journal_lines`.
- [ ] "Percibido" del resultado de gestión: los intereses de la venta de
      cheques entran por su cuenta de gasto; el nominal transferido es neutro
      (como un depósito).
