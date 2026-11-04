# 2026-11-04 — Stamps de migración con `main` adelantado al reloj

**Decisión.** Una versión de migración nueva tiene que ser una fecha y hora
UTC reales: `scripts/check-migrations.sh` (pre-push y CI) rechaza minutos o
segundos de 60 o más, horas de 24 o más y días que no existen. Las futuras
siguen aceptándose hasta un día por delante, como antes: `main` ya llega a
`20261104096700` (minutos 60 a 67 en `096000`–`096700`), unas 13 h por
delante, y las migraciones mergeadas no se renombran. `pnpm db:restamp` deja
de negarse cuando `main` está adelantado: estampa el segundo siguiente al
máximo de `main` leído como hora real (`…096100` cuenta como 10:01:00, el
próximo es `…100101`).

**Descartado.** Rechazar toda versión más de una hora por delante del reloj:
con `main` adelantado bloquearía cada migración nueva hasta que el reloj lo
pase. Renombrar las mergeadas con minuto imposible: nunca se edita una
migración mergeada (`CLAUDE.md`), y la versión es la clave con la que cada
base la registra.
