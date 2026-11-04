# 2026-11-04 — Insights: regeneración atómica y lecturas que fallan

**Decisión.** El analista reemplaza las tarjetas en una sola transacción
(`regenerate_ai_insights`, advisory lock + índice único sobre el fingerprint
de las abiertas o vistas). Si la lectura de un tipo falla, ese tipo queda
fuera del reemplazo y conserva sus tarjetas. Las lecturas se drenan completas
en vez de marcarse parciales: el tope de drenado devuelve error, que también
conserva las tarjetas.
