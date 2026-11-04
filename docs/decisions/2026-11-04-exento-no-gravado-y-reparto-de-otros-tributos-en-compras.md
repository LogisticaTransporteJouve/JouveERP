# 2026-11-04 — Exento, no gravado y reparto de otros tributos en compras

**Decisión.** Toda compra guarda aparte el no gravado y el exento
(`imp_no_gravado`, `imp_op_exentas`) y reparte sus otros tributos en
percepción de IVA, percepción de IIBB, municipales e impuestos internos; la
persona los reparte a mano, porque ni el comprobante escaneado ni el archivo
de ARCA dicen de qué es cada tributo. `imp_trib` queda como la suma de las
cuatro partes. En el asiento, el no gravado, el exento, los municipales y los
internos son gasto; la percepción de IVA va a "Percepciones IVA sufridas"
(rol nuevo `percepciones_iva_pagadas`) y la de IIBB a "Percepciones IIBB
sufridas", como todo `imp_trib` antes. El TXT para ARCA declara cada importe en
su campo y deja "Otros tributos" en 0; el libro IVA (pantalla, Excel, PDF)
muestra no gravado, exento, percepciones de IVA y de IIBB aparte, y junta
municipales e internos en "Otros trib.". El estimado de IVA resta las percepciones de
IVA de las compras. En facturas B y C el IVA, el exento y el no gravado van
dentro del neto.

**Por qué.** El libro IVA declaraba el exento como neto al 0% y todas las
percepciones como un solo "Otros tributos", y el estimado de IVA no podía
restar las percepciones de IVA.

**Cambia lo ya cargado.** Las compras existentes pasan su `imp_trib` a
percepción de IIBB: su asiento no cambia, pero el TXT de un período ya
presentado con tributos ahora los declara en el campo de IIBB y no en "Otros
tributos". Lo aprueban el dueño y el contador.

**Descartado.** Ítems sin alícuota para el exento (hay compras sin ítems) y
dejar todo como antes con un aviso.
