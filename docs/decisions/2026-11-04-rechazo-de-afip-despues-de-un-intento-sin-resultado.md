# 2026-11-04 — Rechazo de AFIP después de un intento sin resultado

**Decisión.** Si un reintento del paso del CAE arranca con un número ya
enviado y sin resultado, un rechazo de AFIP queda reintentable (no
`NonRetriableError`). Antes de pedir un número nuevo, si el último autorizado
ya llegó al número enviado, se vuelve a consultar ese número.

**Por qué.** AFIP puede seguir procesando el pedido que se cortó: un rechazo
del reintento (por ejemplo un error interno) no prueba que no haya un CAE en
camino, y fallar al instante liberaba la liquidación para facturarla de nuevo.
Reintentando, la recuperación adopta el CAE cuando AFIP lo registra; al
agotarse, `onFailure` deja el comprobante a `issue-invoice-reconcile`.

**Descartado.** Una marca en la fila cuando el paso ve un error de
transporte: pide columna y migración, y el número ya guardado alcanza como
señal. Quitar el atajo de `onFailure` para todo rechazo: haría esperar 30 a
45 min a un rechazo del primer intento, que no deja nada en camino.
