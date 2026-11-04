# Importación de ARCA en una transacción y subtotal neto en la A (2026-11-04)

Auditoría w9: w9-s1 F1 / w9-s7 F3, w9-s5 F2 / w9-s1 F2 y w9-s8 N1.
Pendientes: `docs/pendientes/2026-11-04-fiscal-ventas-auditoria-w9.md`.

**Decisión 1: en una A, el «Subtotal» de cada ítem es neto.** Antes la
columna mostraba `line_total` (neto + IVA) y los totales, el neto. En la
misma hoja había dos «Subtotal» con bases distintas: 3 × 100 daba 363 y
abajo decía «Subtotal 300». Ahora, en todo comprobante que discrimina IVA
(A, y cualquiera que no sea B ni C), el ítem muestra `line_neto`. Así,
cantidad × precio unitario da el subtotal del ítem y los ítems suman el
«Subtotal» de los totales. La B sigue igual que con #393: precio y subtotal
con IVA incluido. El comprobante interno no tiene IVA (`line_neto` =
`line_total`).

**Efecto sobre `pdf_hash`.** El PDF de una A emitida antes de este cambio ya
no sale igual byte a byte al regenerarlo: la columna de los ítems cambia. Los
importes de la cabecera, el CAE y el QR son los mismos. Nada compara ese
hash al regenerar, como ya se anotó en
`2026-11-04-pdf-factura-b-e-iva-por-alicuota-de-arca.md`.

**Decisión 2: el PDF y el detalle leen las mismas funciones.**
`discriminatesIva`, `invoiceTotalsRows`, `itemUnitPrice`, `itemSubtotal` y
`invoicePerRate` están en `lib/pdf/invoice-figures.ts`, sin el renderer. El
PDF (`invoice-template.tsx`, `generate-and-store.ts`) y la pantalla de
detalle (`app/(dashboard)/invoices/[id]/page.tsx`) las usan. Cambios en el
detalle:

- «Neto» pasa a llamarse «Subtotal».
- El IVA va por alícuota, como en el PDF.
- Una B con tributos muestra «Subtotal» con IVA y «Otros tributos».
- El precio unitario de una B incluye el IVA.

**Decisión 3: la cabecera y los ítems de una venta de ARCA se guardan
juntos.** La RPC `import_arca_issued_invoice(p_invoice, p_items)`
(`20261104160100`) inserta la factura y sus ítems en una transacción. Esto
reemplaza la parte de la decisión 4 de
`2026-11-04-pdf-factura-b-e-iva-por-alicuota-de-arca.md` que decía «si el
INSERT de los ítems falla, el comprobante queda solo con la cabecera»:

- Si los ítems fallan, no se guarda nada. La corrida de ese par se frena con
  el error, y la próxima vuelve a importar ese número entero. El cursor no
  avanza, porque la factura no quedó.
- Si la corrida muere en el medio, la transacción no se confirma.
- Un `idempotency_key` ya importado no inserta nada y devuelve null. Se
  cuenta como importado, como antes.
- Un choque con otra clave única sigue devolviendo 23505 («missing»).
- Las validaciones de `voucherToInvoiceItems` no cambian: alícuotas
  conocidas, sin negativos y sumas al centavo. Si el detalle no cierra, se
  importa solo la cabecera, como antes.
- La RPC vuelve a controlar que los ítems sumen el neto y el IVA de la
  cabecera. Si no suman, rechaza todo con 22023.

**Descartado: reparar después las importadas sin ítems.** Sería releer de
ARCA, en cada corrida, las importadas recientes sin ítems. Deja una ventana
con el comprobante incompleto. Además, sobre filas viejas es un backfill de
datos reales, que necesita aprobación (el pendiente de w8 «Re-leer de ARCA
las ventas ya importadas» sigue abierto).

**Costo aceptado:** si la base rechazara siempre los ítems de un
comprobante ya validado, el par queda frenado en ese número hasta
corregirlo, en vez de seguir con ese comprobante solo con la cabecera. El
motivo queda en la corrida («No se pudo guardar el N: …») y en el log
`arca_sync.insert_failed`. Es preferible a que un comprobante con dos
alícuotas vaya a «Sin alícuota» sin aviso.
