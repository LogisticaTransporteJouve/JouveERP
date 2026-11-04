# Compras y contabilidad — correcciones (2026-11-02)

- [x] **Número de compras internas.** El autonumerado del formulario llamaba a
      `next_internal_purchase_numero` desde el navegador (revocado para
      `authenticated` desde la auditoría T1a) y el error se tragaba. Ahora va
      por `nextInternalPurchaseNumeroAction` (service client, rechaza canales
      fiscales) y el RPC numera por proveedor + tipo + PV sobre todos los
      estados, como la clave única. Si falla, el formulario lo avisa.
- [x] **NC/ND de compra manual a la cuenta del origen.** Sin cuenta propia
      hereda la cuenta de gasto (y el centro de costo) de su comprobante de
      origen, en vez de revertir `compras`.
- [x] **Libro mayor con saldo anterior.** Con "Desde", el saldo acumulado
      arranca del saldo previo (fila "Saldo anterior") y el corte de PostgREST
      se detecta y se avisa como datos parciales.
- [x] **Fecha "hoy" en hora argentina.** Defaults y filtros de formularios y
      acciones usan `todayInAR()`: después de las 21 h ya no proponen el día
      siguiente (UTC).
- [x] **Contador (`fiscal_reader`) y asientos sin canal.** Ve los asientos
      manuales "fiscal general" (sin canal) y sus líneas; los internos siguen
      ocultos. El alcance "Solo fiscal" del libro diario también los incluye.
- [ ] Las NC/ND de compra cargadas antes de esta corrección siguen asentadas
      contra `compras` (no hay backfill). Desde 1.1/1.2 el formulario de
      edición cambia la cuenta de gasto (re-asienta en un período abierto):
      decidir si se corrigen una por una o con un backfill.
