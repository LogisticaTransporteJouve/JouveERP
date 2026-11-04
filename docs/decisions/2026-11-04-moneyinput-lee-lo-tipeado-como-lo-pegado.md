# 2026-11-04 — `MoneyInput`: lo tipeado se lee con las reglas del pegado

**Decisión (dueño).** No se le exige al usuario tipear el formato
"1.000,00", y el punto de miles tipeado por costumbre no puede cambiar el
monto. `MoneyInput` (`components/money-input.tsx`):

- **Mientras se tipea**, guarda el texto tal como se tipeó (solo dígitos,
  "." y ","), así que nada pelea con el cursor ni se pierden caracteres.
  `parseArAmount` lee ese texto entero con las reglas de
  `normalizeAmountText` (`lib/format.ts`), las mismas del pegado:
  - con "." y "," a la vez, el último es el decimal ("1.234,56" y
    "1,234.56" → 1234,56);
  - solo ",": es el decimal (una segunda coma, o un punto después de la
    coma, se ignoran al tipear; los decimales después de la coma se cortan
    en `decimals`);
  - un solo ".": con exactamente 3 dígitos después es de miles ("15.000" →
    15000); con 1–2 es decimal ("15.5" → 15,5; "1500.50" → 1500,5); "15."
    vale 15 y se ve tal cual;
  - varios ".": son de miles ("1.234.567" → 1234567).
- **Al editar un valor que el campo ya agrupó** ("1.500" después del blur,
  o un precargado "1.234,56"), sus puntos son de miles: un dígito más
  continúa el número ("1.500" + "0" → 15000) y un "." o "," tipeado ahí es
  el decimal. Por eso, tipeando, "1.234" seguido de otro dígito sigue siendo
  entero (12345); pegado, "1.2345" es decimal (1,2345).
- **Al pegar**, el texto se lee entero con esas reglas y se muestra en es-AR.
- **Al perder el foco**, el texto pasa a la forma es-AR canónica
  (`moneyInputBlurText`: "1500.50" → "1.500,50", "15." → "15").
- **Con `decimals: 4`** (ítems de factura y compra, cotizaciones) la regla
  es la misma: 3 dígitos después de un punto solo siguen siendo miles
  ("1.180" → 1180). Una cotización con 3 decimales se escribe con coma
  ("1,180").

`allowNegative` sigue igual: el "-" inicial se conserva solo con esa opción.
Reemplaza lo del punto tipeado de
`2026-11-04-montos-de-rrhh-con-formato-al-tipear-sueldo.md`.

**Por qué.** Una primera versión leía todo "." tipeado como decimal: tipear
"15.000" por costumbre dejaba 15,00, el mismo error de ×1000 en otra forma.
Leer lo tipeado igual que lo pegado hace que las dos costumbres (punto de
miles, punto decimal del teclado numérico) den el monto que el usuario
quiso, salvo "1.234" con 3 decimales, que es raro en plata.

**Descartado.** Reformatear en cada tecla: con el punto ambiguo hasta el
tercer dígito, el texto cambiaría bajo el cursor. `moneyAmountPreprocess`
(server) no cambia: los formularios mandan números.
