# 2026-11-04 — Libro IVA: lo mejor de Jouve y del sistema anterior

**Decisión.** Los dos libros (pantalla, PDF y Excel) comparten un layout
(`features/libro-iva/lib/book-layout.ts`):

- **De Jouve:** un renglón por comprobante con un par Neto / IVA por
  alícuota, columnas separadas de no gravado y exento, CAE, nota de moneda
  extranjera y totales con la cantidad de comprobantes.
- **Del sistema anterior:**
  - el título "Libro de I.V.A. Ventas (dd/mm/aaaa - dd/mm/aaaa) - Previo |
    Definitivo", con la razón social a la izquierda y el C.U.I.T. a la
    derecha;
  - TC con códigos cortos (FC, NC, ND);
  - la columna C.I.;
  - las percepciones de compras con su letra, un renglón por tipo;
  - Imp. int. aparte;
  - subtotales acumulados al pie de cada hoja del PDF;
  - las NC en negativo en todas las columnas.
- **Alícuotas:** solo se imprimen las que aparecen en el período.
- **Empresa y C.U.I.T.:** salen de la `business_units` del canal fiscal
  elegido (o del primero); nunca están escritos en el código.
- **Previo / Definitivo:** "Definitivo" cuando el período está en
  `accounting_closed_periods`.
- **C.I.:**
  - en ventas, la condición informada a AFIP con el comprobante
    (`iva_condition_receptor`, RG 5616) y, si no está, la del cliente;
  - en compras, la del proveedor.
  - Se lee en `fetch-books` junto a las filas del RPC, sin migración.

**Comprobantes sin ítems** (las ventas importadas de ARCA, compras cargadas
solo con el encabezado). Van en la alícuota que el TXT infiere de IVA / neto
(`inferIvaRateId`, la misma función que usa `citi.ts`). Si no cierra con
ninguna, quedan en un par "Sin alícuota" visible y el TXT los excluye, como
antes. La reasignación se hace al agrupar (`groupByInvoice` /
`groupComprasByInvoice`), así el libro, el TXT, la estimación de IVA y las
herramientas del AI CFO leen la misma alícuota. Los totales siguen siendo
`computeTotals` / `computeComprasTotals`.

**Retenciones en ventas: no van.** Una retención se carga en el recibo
(`receipt_retentions.receipt_id`), no en un comprobante. Un recibo puede
cancelar varios comprobantes o una parte de uno, y el contador externo
(`fiscal_reader`) no lee recibos por RLS. Atribuirla a un comprobante sería
inventar un reparto. El TXT de ventas tampoco tiene ese campo.

**Percepciones en ventas:** la factura de venta guarda un solo total de otros
tributos (`imp_trib`). La columna "Percepciones" lo muestra sin letra; no hay
apertura por tipo que mostrar.

**PDF.**

- A4 apaisado.
- El ancho de cada columna sale de su contenido. La letra se achica cuando el
  período tiene muchas alícuotas, así la tabla nunca pasa el ancho de la
  hoja.
- La razón social se corta con "…".
- Cada hoja se arma de antemano: su pie de "Subtotales" es
  `computeTotals` de los comprobantes hasta esa hoja.
- Un test renderiza el PDF y compara las hojas que salen con las que se
  planearon.

**Descartado.** Un renglón por comprobante × alícuota, como el sistema
anterior. El owner pidió conservar el par por alícuota de Jouve, que deja un
total por comprobante.
