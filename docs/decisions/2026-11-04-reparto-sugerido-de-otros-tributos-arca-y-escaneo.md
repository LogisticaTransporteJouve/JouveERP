# 2026-11-04 — Reparto sugerido de otros tributos (ARCA y escaneo)

**Decisión.** Cuando Mis Comprobantes o un comprobante escaneado dan solo el
total de otros tributos, la bandeja de ARCA y el borrador de IA proponen un
reparto, con una nota que dice que es una sugerencia; la persona lo confirma
o lo edita y nada se guarda sin su confirmación
(`lib/purchases/tribute-split.ts`). En orden:

1. **Historia del proveedor:** la última factura fiscal recibida del mismo
   proveedor con tributos; sus tasas sobre el neto aplicadas al neto de esta.
   Se usa solo si reproduce el total (±0,02 o 0,1 %); si no, es otro patrón.
2. **Percepción de IVA (RG 2408):** si todo el monto es 1,5 % o 3 % del neto
   gravado (±0,02), IVA. Si es más, se separa una parte de IVA al 1,5 % o 3 %
   y el resto queda como IIBB, siempre que ese resto sea una alícuota de IIBB
   creíble (0,5 %–5 %); entre las dos, la que deja IIBB más cerca de
   1,75 %–2,5 %, las del libro real. Solo en letra A.
3. **Si no:** IIBB.

**Límites.** Un IIBB al 1,5 % o al 3 % se sugiere como IVA, y uno alto (6 %)
como IVA + IIBB, hasta que el proveedor tenga historia: por eso es una
sugerencia y se muestra la nota.

**Alícuota de un comprobante de ARCA sin columnas por alícuota.** Se infiere
de IVA/neto: la más cercana de 21 %, 10,5 % y 27 % con tolerancia de 0,5 % del
importe, y se guarda un ítem con esa alícuota. Si no coincide ninguna (mezcla
alícuotas), se carga al 21 % con un aviso para revisarla. Es una regla aparte
de la de percepciones (1,5 %/3 % del neto), que solo mira otros tributos.

**Descartado.** Guardar el reparto sugerido sin confirmación y el reparto
proporcional a la historia sin mirar el neto (no distingue un cambio de
alícuota).
