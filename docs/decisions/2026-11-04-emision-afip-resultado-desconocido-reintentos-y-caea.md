# 2026-11-04 — Emisión AFIP: resultado desconocido, reintentos y CAEA

**Quién es dueño de un número.** Lo tiene quien lo guardó en `numero`. Un
`afip_attempted_numero` de otro comprobante no prueba nada: si el comprobante
que AFIP tiene en ese número coincide con este (total, fecha, receptor) y no con
el otro, se adopta. Si coincide con los dos, no se pide otro CAE: el paso falla
con reintento y, si sigue igual, queda en `emitting` para que alguien lo
resuelva. **Descartado:** borrar los intentos ajenos al reservar un número (un
pedido que llega tarde a AFIP dejaría un CAE sin dueño).

**Emisiones sin resultado.** `issue-invoice-reconcile` corre cada 15 minutos.
Una emisión fiscal en `emitting` con un número enviado y sin cambios hace más
de 30 minutos se consulta en AFIP: se emite con su CAE, o pasa a `failed` (con
compare-and-set sobre `updated_at`). Un run que vuelve después no pide el CAE:
`record-attempt` exige `emitting`. Un borrador de entre 15 minutos y 3 días con
ítems se vuelve a mandar con su propia clave (Inngest la deduplica 24 h). La
importación de ARCA sigue frenando el par mientras haya una emisión en curso:
importar ese número podría duplicar el CAE de la emisión trabada.

**`inngest.send` que falla.** No se borra el borrador (Inngest pudo haberlo
aceptado) y la acción lo devuelve igual, para que quien factura lo vincule en
vez de facturar de nuevo. Lo manda el reenvío con la misma clave o el cron.

**Límite de tiempo.** Cada llamada a AFIP corta a los 20 s; el login de WSAA,
a los 60 s (un TA que AFIP entrega después del corte se pierde, y AFIP no da
otro hasta que vence, 12 h sin CAE); el piso de numeración CAEA, a los 5 s.
Un login y cuatro llamadas entran en los 300 s de un paso.

**ARCA en período cerrado.** Un comprobante emitido con CAE que se inserta (la
importación) se guarda y su asiento queda en `pending_journal_entries`, como
ya pasaba al emitir. Antes la importación de ese par quedaba frenada.
