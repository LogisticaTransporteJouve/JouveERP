# 2026-11-04 — Invitar usuario: roles por `set_user_access`

**Decisión.** `inviteUserAction` asigna los roles con `set_user_access`
(`p_expected_roles = []`), el mismo RPC que el diálogo de accesos, en vez de
leer y escribir `user_roles` desde la acción. Una regla nueva del RPC alcanza
también a la invitación, y una cuenta que ya tiene roles se rechaza en la misma
transacción (antes: una lectura y después la escritura). La tolerancia "antes
de que exista el RPC" no hace falta: `promote-to-production.yml` aplica las
migraciones antes del código, y el RPC (`20261028140000`) es anterior.
