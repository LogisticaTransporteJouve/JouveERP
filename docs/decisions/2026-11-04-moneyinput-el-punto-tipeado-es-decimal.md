# 2026-11-04 — `MoneyInput`: el punto tipeado es la coma decimal

**Decisión (dueño).** No se le exige al usuario tipear el formato
"1.000,00". `MoneyInput` (`components/money-input.tsx`) agrupa los miles
solo mientras se tipea, así que:

- **Tipear:** un "." vale igual que una ",": es la coma decimal (la tecla
  decimal del teclado numérico manda "."). "1500.50" y "1500,50" muestran
  "1.500,50" y guardan 1500,5. Un segundo separador decimal se ignora: tipear
  "850.000,00" tecla por tecla deja "850,00", y eso es lo que se ve y se
  guarda.
- **Pegar** (o precargar un texto externo): una sola función,
  `normalizeAmountText` en `lib/format.ts`, decide cuál es el decimal:
  - con "." y "," a la vez, el último es el decimal ("1.234,56" y
    "1,234.56" → 1234,56);
  - solo ",": es el decimal (varias comas no se leen);
  - un solo ".": con exactamente 3 dígitos después es de miles ("15.000" →
    15000); con otra cantidad es decimal ("1500.5" → 1500,5);
  - varios ".": son de miles ("1.234.567" → 1234567).

`parseArAmount` usa la misma función, así que lee igual el texto que
muestra el campo y cualquier texto pegado o precargado. El texto que arma
`MoneyInput` o `amountToInput` siempre agrupa de a 3 con "." y usa "," como
decimal, y esas reglas lo leen igual que antes. `nextMoneyInputText` decide
qué muestra el campo después de cada cambio (tecla o pegado); `decimals` y
`allowNegative` siguen funcionando.

**Por qué.** La regla anterior descartaba el punto tipeado ("1500.50" →
150.050, a la vista). Evitaba guardar 100 veces el monto, pero obligaba a
tipear la coma, y en el teclado numérico eso no es natural.

**Descartado.** Decidir por posición si un "." tipeado es de miles (por
ejemplo, después de 3 dígitos): el campo ya pone los de miles, y una tecla
que cambia de sentido según dónde cae confunde más de lo que ayuda.
`moneyAmountPreprocess` (server) no cambia: recibe números o texto
es-AR armado por el campo.
