# 2026-11-05 — Facturación y flota: cadena de notas, intento vigente y combustible del viaje (auditoría w16)

**La regla de anulada recorre toda la cadena de notas** (`20261105130000`).
Una NC autorizada no se puede anular, así que una NC equivocada se revierte
con una ND cuyo comprobante asociado es esa NC. La sincronización con ARCA
la guarda con la NC como origen. Hasta w15 la regla leía las NC de la
factura por su total, y una ND sobre una NC no la leía nadie. Con factura
100 → NC 100 → ND 100 sobre esa NC, la factura se leía anulada: la carga, la
liquidación o el período de almacenaje quedaban libres para facturarse de
nuevo mientras la ND los seguía facturando.

- `billing_invoice_live_amount` (nueva) dice lo que un comprobante todavía
  factura (factura o ND) o acredita (NC) después de sus notas. Por cada
  comprobante: su total, más lo que todavía hacen sus notas del mismo lado,
  menos lo de sus notas del otro lado, con mínimo 0. Se calcula de abajo
  hacia arriba. Así, una NC sobre una ND resta de la ND, una ND sobre una NC
  resta de la NC y una ND sobre una ND suma a la ND.
- Una factura fiscal está anulada cuando lo que todavía factura es 0,01 o
  menos. La parte de la carga es lo que todavía factura dividido por su
  total. Con notas de un solo nivel (y las NC de cada ND) da lo mismo que
  `20261105120100`. Solo cambian las cadenas más profundas.
- Las ND de intereses por mora siguen afuera, con todas sus notas.
- La cadena se recorre hasta 10 notas de profundidad y nunca pasa dos veces
  por el mismo comprobante. Más abajo no se lee.
- `billing_invoice_live_debits` (w15) se reemplaza y se borra: solo la
  leían la regla y la parte, y ninguna parte de la app la llama.
- **Descartado:** solo sumar las ND cuyo origen es una NC de la factura (un
  nivel más). Arregla el caso de la auditoría, pero deja igual de rota una
  cadena de tres o más notas.

**Solo el último intento de una fuente puede ser el vigente**
(`lib/source-invoice-key.ts`). Desde w15 la regla ya no es monótona: una ND
emitida sobre una factura anulada la vuelve a dejar viva. «Facturar flete»
buscaba el primer intento vivo, así que podía volver a vincular la carga a
la factura vieja, cuyo flete ya se había acreditado y que solo factura la
ND. Ahora `findSourceInvoiceSlot` mira solo la clave más nueva que existe.
Si está viva, la usa. Si no, emite con la siguiente. Una clave nueva existe
solo porque las anteriores estaban anuladas o sin ítems cuando se tomó.
Alcanza a cargas (`invoiceFreightAction`) y liquidaciones (facturar y
cancelar). El almacenaje no usa intentos: cada reserva es un período nuevo.

- **Descartado:** rechazar una ND cuyo origen ya está anulado. No cubre una
  ND importada desde ARCA.

**Combustible del viaje: todo el ligado al viaje, sea cual sea su fecha**
(`20261105130001`). El neto de un viaje es su ingreso, menos su costo, menos
todo el combustible ligado a él. Vale igual en «Rentabilidad de flota», en
`ai_fleet_margin` (por viaje, por chofer y por cliente) y en el aviso de
viaje con pérdida, que ya lo contaba así. Una carga hecha la noche anterior
al viaje ya no cambia el neto según el rango elegido.

- El combustible por vehículo sigue contando por su fecha en el rango,
  como en la decisión de
  [2026-11-03](2026-11-03-margen-por-camion-el-centro-de-costo-apunta-al-camion.md).
  Por eso la suma de los netos por viaje puede no coincidir con el neto por
  vehículo.
- `getClientMargin` calcula «flota no asignada» así: el combustible y el
  mantenimiento de los vehículos en el rango, menos el combustible de los
  viajes del rango. Directo + no asignado sigue siendo el costo de los
  vehículos en el rango. Un viaje con combustible cargado antes del rango
  lo reduce, y puede dar negativo.
- **Descartado:** dejar la ventana por fecha de carga y que el aviso filtre
  por fecha. El aviso mira los últimos 180 días, no un rango, y un viaje
  tendría un neto distinto en cada rango.
