# 2026-11-05 — Compras: NC/ND contra su origen y saldo del detalle (auditoría w17)

Migración: `20261105140000`. Pendientes:
`docs/pendientes/2026-11-05-compras-nc-nd-auditoria-w17.md`.

- **Una NC de compra no supera lo que su origen tiene abierto, también al
  cargarla.** La guarda de saldo abierto de compras
  (`purchase_invoices_open_after_edit`) corría solo al editar. Un trigger
  nuevo (`purchase_invoices_open_after_insert`) corre el mismo control al
  cargar una compra con origen, como en ventas. Una compra sin origen no
  baja el saldo de otra, así que no lo corre. Una NC por más de lo que queda
  abierto de la factura se rechaza con «La edición deja un comprobante con
  más pagado o acreditado que su total» y no se guarda nada. La alternativa
  (aceptar el excedente como crédito del proveedor) obligaba a que el aging
  y el saldo por canal llevaran saldos negativos; se descartó.
- **Una NC/ND va en la moneda de su origen.** `guard_purchase_invoice_origin`
  la rechaza en otra moneda («La factura de origen está en otra moneda: una
  NC/ND va en la misma moneda que su factura») al cargarla y cuando cambian
  su moneda o su origen. Una factura con NC/ND recibidas no cambia de moneda
  («Esta factura es origen de una NC/ND: no se le puede cambiar la moneda»):
  hay que anular las notas primero. Una nota guardada antes de esta guarda
  en otra moneda sigue guardando sus otros campos.
- **En el formulario, elegir la factura origen fija la moneda y la
  cotización.** La moneda pasa a la del origen y queda bloqueada mientras
  haya un origen elegido. En dólares queda la cotización ya cargada si es
  mayor a 1; si no, la del origen. Un comprobante de ARCA conserva la suya
  y, si no coincide, la guarda lo dice.
- **«Pagado» y «Saldo» del detalle de una compra se muestran solo para una
  factura o ND no anulada**, la misma condición que «Pagar». Una NC no debe
  nada y una compra anulada ya no cuenta para saldos.
- **El detalle dice cuando una lectura falla** en vez de suponer un valor:
  - sin el canal, el título es «Comprobante de compra» (no «Factura» ni
    «Remito interno») y no se ofrecen «Pagar» ni «Imputar remitos»;
  - sin las imputaciones, no se ofrece «Imputar remitos» con el total como
    disponible;
  - sin lo pendiente de pago, avisa en lugar de esconder «Pagar» sin
    explicación.
