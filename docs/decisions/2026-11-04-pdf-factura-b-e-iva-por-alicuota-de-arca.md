# 2026-11-04 — PDF de ventas (A y B), alícuotas de ARCA y ventas exentas en el TXT

Auditoría W8, frente N2 (hallazgos w8-s1 F1–F4).

**Decisión 1: el PDF de una factura B no discrimina IVA.** Las facturas, NC
y ND B del PDF:

- muestran precios unitarios y subtotal con IVA incluido;
- no tienen las filas «Subtotal» neto, «IVA x %», «No gravado» ni «Exento»;
- no tienen la columna IVA en los ítems.

Si hay otros tributos, el PDF muestra «Subtotal» (total − tributos) y «Otros
tributos». El IVA va una sola vez, en el bloque «Régimen de Transparencia
Fiscal al Consumidor (Ley 27.743)» con el **IVA Contenido**, que es
informativo y queda fuera de la suma. Es la misma regla de la pantalla de
detalle (`discriminatesIva`). A no cambia: neto, IVA por alícuota y total, y
la leyenda de la Ley 27.618 cuando el receptor es monotributista.

**Decisión 2: el bloque de transparencia va en toda B fiscal, no solo en la
factura B a consumidor final.** Esta es la opción conservadora; ver
«Fuentes». La línea «Otros impuestos nacionales indirectos» sigue saliendo
solo en la factura B a consumidor final, como antes. El texto del bloque es
ahora el título que fija la norma. Antes decía «El monto de IVA
discriminado…», y eso contradecía una B.

**Decisión 3: el PDF de un comprobante sin ítems muestra su IVA.** Son los
importados de ARCA antes de este cambio. El PDF arma un renglón de IVA con la
cabecera, en la alícuota que infiere el Libro IVA (`inferIvaRateId`), así
Subtotal + IVA = Total y el PDF coincide con el libro. Si ninguna alícuota
cierra, el PDF muestra un renglón «IVA» por el `imp_iva`.

**Decisión 4: la importación de ARCA guarda las alícuotas como ítems.**
`getVoucherInfo` lee `Iva/AlicIva` de FECompConsultar. Al importar un
comprobante, `arca-issued-sync` inserta un `invoice_items` por cada alícuota:

- descripción «Importado de ARCA»;
- cantidad 1;
- `unit_price` y `line_neto` = `BaseImp`;
- `line_iva` = `Importe`;
- `iva_rate_id` = `Id`.

El Libro IVA (pantalla, PDF y Excel), el TXT, el PDF del comprobante y las
herramientas de IA leen así las alícuotas reales, sin inferir. Se eligió esta
opción por ser la más chica:

- no necesita migración, columna nueva ni tipos;
- `libro_iva_ventas` ya agrupa los ítems por alícuota y ajusta el centavo
  contra la cabecera;
- `computeTotals` y la NC desde el origen ya trabajan con ítems;
- `guard_invoice_items_immutable` solo frena UPDATE y DELETE, no el INSERT.

Las alícuotas se descartan, y el comprobante queda solo con la cabecera como
hasta hoy, si:

- ARCA no devuelve el detalle;
- el detalle trae una alícuota que el ERP no modela;
- el detalle trae un importe negativo;
- las bases no suman `ImpNeto` al centavo, o los importes no suman `ImpIVA`.

Solo se escriben ítems para la fila que esa misma corrida insertó. Un
duplicado no recibe ítems. Si el INSERT de los ítems falla, se registra en el
log (`arca_sync.iva_breakdown_insert_failed`) y el comprobante también queda
solo con la cabecera.

**Decisión 5: una venta solo exenta o no gravada va al TXT de VENTAS.** Va
con una alícuota 0003 (0 %) en cero, cantidad de alícuotas 1 y código de
operación E (exento) o N (no gravado), igual que en COMPRAS. Antes se excluía
con «no se pudo derivar la alícuota». Una venta sin nada para declarar se
sigue excluyendo.

**Descartado.**

- Una tabla o columna jsonb de IVA por alícuota en `invoices`: exige
  migración, tipos y cambiar `libro_iva_ventas` para dar lo mismo que los
  ítems.
- Ocultar el PDF de los comprobantes sin ítems: deja sin PDF ventas reales.
- Re-leer de ARCA los comprobantes ya importados: ver el pendiente
  `docs/pendientes/2026-11-04-fiscal-ventas-auditoria-w8.md`.

**Efecto sobre `pdf_hash`.** El PDF de un comprobante B, o de un comprobante
sin ítems, emitido antes de este cambio ya no se regenera igual byte a byte
que el PDF cuyo hash se guardó al emitirlo. Ya había pasado con cambios
anteriores de la plantilla. Nada compara ese hash al regenerar.

## Fuentes

Desde esta sesión no se pudieron abrir los sitios oficiales (afip.gob.ar,
argentina.gob.ar, biblioteca.afip.gob.ar): la red no los resuelve. Lo de
abajo sale de los extractos del buscador de esas mismas páginas y de fuentes
profesionales. Hay que confirmarlo con el texto oficial antes de cerrarlo.

- **RG 5614/2024**, que modifica el Anexo II de la RG 1415:
  [Boletín Oficial 13/12/2024](https://www.boletinoficial.gob.ar/detalleAviso/primera/318151/20241213),
  [texto en argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5614-2024-407183/texto)
  y [Biblioteca ARCA](https://biblioteca.afip.gob.ar/dcp/REAG09005614_2024_12_12).
  - Los datos de IVA de las operaciones gravadas con exentos, no alcanzados o
    consumidores finales (Anexo II, apartado A, título IV, inciso a), punto 2)
    pasan al espacio inferior izquierdo del comprobante.
  - Ese espacio (apartado B, incisos f y g) lleva el título «Régimen de
    Transparencia Fiscal al Consumidor (Ley 27.743)», el «IVA Contenido» y,
    si el receptor es consumidor final, los «Otros Impuestos Nacionales
    Indirectos».
  - El inciso g) se sustituyó en mayo de 2025
    ([BO](https://www.boletinoficial.gob.ar/pdf/aviso/primera/318151/20250521)).
  - Resúmenes: [Consejo de Salta](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5614-1.pdf),
    [iProfesional, preguntas frecuentes de ARCA](https://www.iprofesional.com/impuestos/425366-iva-en-las-facturas-arca-responde-las-dudas-mas-frecuentes)
    y [Gosocket](https://gosocket.net/centro-de-recursos/arca-publica-la-resolucion-general-n5616-2024-2/).
    El texto del Consejo de Salta dice que el régimen alcanza a clientes
    consumidores finales, monotributistas y exentos.
- **RG 1415, datos del comprobante:**
  [ARCA, «¿Qué datos deben contener los comprobantes?»](https://www.afip.gob.ar/fe/emision-autorizacion/datos-comprobantes.asp).
  La B a consumidor final no discrimina el IVA y lleva la leyenda «A
  CONSUMIDOR FINAL». El ERP no imprime esa leyenda; ver el pendiente.
- **Libro IVA Digital (RG 4597):**
  [Especificaciones, revisión 30/07/2025](https://www.afip.gob.ar/iva/documentos/Libro-IVA-Digital-Especificaciones.pdf)
  y [Tablas del sistema](https://www.afip.gob.ar/iva/documentos/Libro-IVA-Digital-Tablas-del-Sistema.pdf).
  - «Si la alícuota de IVA es igual a cero (0) o la operación responde a una
    operación de Canje se deberá completar» el código de operación, con E
    (operaciones exentas) o N (no gravado).
  - Alícuota 0003 = 0,00 %.
  - La cantidad de alícuotas tiene que coincidir con los registros de
    alícuotas informados.
  - Para compras B o C se informa 0.
  - Ninguna fuente dice expresamente cómo informar una venta solo exenta. Se
    tomó la opción conservadora: declararla con un registro 0003 en cero y no
    dejarla fuera de la presentación.
- **Contexto:** la [RG 5707/2025](https://contadoresenred.com/resolucion-general-5707-2025/)
  limita la obligación del Libro IVA Digital a los sujetos exentos. El TXT se
  sigue generando para quien lo use.

**Opciones conservadoras tomadas donde las fuentes no son claras:**

- El bloque de transparencia va en toda B, sea factura, NC o ND, y sea el
  receptor consumidor final, exento o no categorizado. Omitir una leyenda
  obligatoria es la infracción. Informar el IVA contenido de más no lo es.
- La venta solo exenta se declara con una alícuota 0 % en lugar de quedar
  fuera del TXT.
