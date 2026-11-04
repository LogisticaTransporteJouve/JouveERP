# 2026-11-04 — Insights y propuestas: cortar después de ordenar, avisar antes de reofrecer

**Decisión.** `listInsightsAction` lee todas las tarjetas vivas (el set lo
acota la última corrida del analista), filtra las del dominio del usuario,
ordena por gravedad y recién ahí corta en 50, devolviendo el total para que
el panel diga "Mostrando 50 de N". Una propuesta aceptada cuyo pedido murió
se cierra como fallida y esa misma fila se devuelve, con "No se sabe si la
acción se completó"; la propuesta nueva se arma en la apertura siguiente.

**Por qué.** Una corrida comparte `generated_at`: el `limit(50)` en SQL
devolvía 50 cualesquiera, así que una crítica podía quedar afuera y un
usuario de operaciones podía no ver ninguna de las suyas. Reofrecer
"Aceptar" sin mostrar el aviso permitía repetir una escritura que quizás ya
se hizo (una tarea).

**Descartado.** Ordenar por gravedad en SQL (`severity` es texto: el orden
alfabético no es el de gravedad) y mostrar el aviso junto a la propuesta
nueva (dos tarjetas en el mismo diálogo).
