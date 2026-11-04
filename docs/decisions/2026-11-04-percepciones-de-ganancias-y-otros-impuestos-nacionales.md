# 2026-11-04 — Percepciones de Ganancias y otros impuestos nacionales en compras

**Decisión.** Las compras tienen una quinta parte de `imp_trib`:
`imp_perc_nacionales`, "percepciones o pagos a cuenta de otros impuestos
nacionales" (Ganancias y cualquier otro nacional que no es IVA). No es IVA:
nunca va a `iva_credito`, a la posición ni al estimado de IVA (queda entre los
"otros tributos que no se restan"). En el asiento va a "Percepciones y pagos a
cuenta de Ganancias" (rol nuevo `percepciones_ganancias`, 1.1.3.N, activo).
El cargo a un empleado no la incluye: como las otras percepciones, es crédito
de la empresa.

**Cuenta sin rol.** Si ninguna cuenta activa tiene el rol, se asienta en
`percepciones_iibb_pagadas`: sigue siendo un crédito fiscal (activo), es la
cuenta a la que iba todo `imp_trib` antes de #339 y la que usa el código
anterior en un rollback; nunca gasto (inflaría el costo y, a cargo de un
empleado, caería en anticipos) ni IVA. El monto no se pierde y el contador lo
reclasifica.

**Libro IVA Digital (RG 4597; diseño heredado de RG 3685 "CITI").** El
registro de comprobantes de compras tiene el campo 13 "Importe de
percepciones o pagos a cuenta de otros impuestos nacionales" (posiciones
165–179, entre las percepciones de IVA y las de IIBB; `features/libro-iva/lib/citi.ts`).
Fuentes: el diseño de registro que sigue el TXT del repo, y contadoresenred y
blogdelcontador, que lo describen como campo propio, distinto de IVA, IIBB,
municipales e internos, y no lo muestran en la vista ni en la impresión del
Libro IVA Digital. Por eso el TXT lo declara ahí (el total del registro tiene
que cerrar) y "Otros tributos" sigue en 0. La duda del owner ("creo que eso no
va en los libros") se confirma para la vista: no es una columna de IVA.

**Libro IVA Compras en pantalla, PDF y Excel.** Como el libro del sistema
anterior que usa el contador: una columna "Percepciones" con el código de cada
una (B = IIBB, I = IVA, G = Ganancias y otros nacionales, M = municipales) y
"Imp. int." aparte; sin columna propia para Ganancias. El Excel lleva la suma
en "Percepciones" y el detalle con códigos en "Detalle percepciones". La RPC
`libro_iva_compras` devuelve `perc_nacionales` y la suma en `imp_trib`.

**Descartado.** Meterla en "Otros tributos" del TXT (el campo 13 existe) y
crear una columna visible "Perc. Ganancias" (no figura en el libro del
contador ni en la vista de ARCA).
