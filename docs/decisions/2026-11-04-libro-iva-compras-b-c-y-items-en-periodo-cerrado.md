# 2026-11-04 — Libro IVA Compras: B/C sin alícuota e ítems congelados en período cerrado

**Decisión 1: B y C van en «Sin discriminar (B/C)».** Una compra fiscal B o C
no discrimina IVA: el libro (pantalla, PDF y Excel) la imprime en una sola
columna «Importe» bajo «Sin discriminar (B/C)», con el IVA incluido, y nunca
bajo «0%» ni bajo la alícuota de sus ítems. Así el libro coincide con el TXT,
que declara B/C sin registro de alícuotas. Una B vieja con IVA cargado suma ese
IVA al importe, así que la fila sigue cerrando con su total. La herramienta
de IA (`totals.per_rate`) usa la misma etiqueta. Las compras sin letra siguen
como antes: alícuota inferida o «Sin alícuota».

**Por qué.** Antes cada B/C caía en «Neto 0%» y ese total no coincidía con las
alícuotas 0% del TXT: el libro decía que el período tenía neto gravado al 0%
que no existía.

**Decisión 2: los ítems de una compra fiscal en período cerrado no cambian.**
`replace_purchase_invoice_items` rechaza (55006, el mismo mensaje del
encabezado) un reemplazo que cambie lo que lee el Libro IVA: el neto y el IVA
por alícuota, o pasar de tener ítems a no tenerlos. Volver a guardar el mismo
reparto pasa, porque el formulario de edición siempre manda los ítems: notas,
vencimiento y cuenta siguen editables. Un trigger rechaza cualquier otra
escritura directa a esos ítems.

**Descartado.** Bloquear cualquier reemplazo de ítems en período cerrado:
frenaría toda edición de la compra desde el formulario. Una columna «No
gravado» para B/C (como el libro heredado): mezclaría el IVA incluido con el
no gravado real que sí declara el TXT.
