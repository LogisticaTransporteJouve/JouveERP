# 2026-11-03 — IA: propuestas para todo e indicadores (6.3 + 6.4)

**Decisión (6.3).** Las propuestas siguen siendo `defineAiProposal`, ahora con
`prepareDraft` separado de la tarjeta del chat. Las de fuera del chat (desde un
insight) se guardan en una tabla nueva, `ai_proposals` (`pending | accepted |
dismissed | failed | expired`, vence a las 24 h), y no en
`ai_chat_confirmations`, que está atada a sesión, tool call y revisiones y ya
está mergeada. Aceptar re-chequea `userCan`, re-valida con el Zod del
formulario y hace un compare-and-set; el trigger `guard_ai_proposal` refuerza
las transiciones en la base. El insight no prepara nada en segundo plano:
guarda `{ action, label, input }` y cada usuario lo prepara con sus permisos
al hacer click. Las escrituras nuevas (tarea, tarifa, conciliación, ND por
mora) pasaron a `lib/commands/` y el server action de cada feature llama a la
misma función; la ND recibe `issueFiscalInvoiceAction` inyectado, así `lib/`
no importa una action. La ND por mora se emite al aceptar (como "Generar ND")
y se rechaza si el interés cambió desde que se mostró.

**Decisión (6.4).** Ocho indicadores deterministas en el analyst, cada uno con
su permiso y su copy; los que apuntan a registros tienen fingerprint. Un
indicador cuyas lecturas fallan conserva su tarjeta anterior en vez de tumbar
la corrida o borrar la tarjeta. La visibilidad por tipo admite varios
permisos (se requieren todos), en sync con la política RLS.

**Por qué.** "Propuestas para todo" sin duplicar lógica de negocio ni cruzar
actions entre features; una tarjeta de insight necesita una propuesta sin
sesión de chat, y un doble click o una tarjeta vieja nunca deben ejecutar dos
veces.

**Descartado.** Generalizar `ai_chat_confirmations` (editar una tabla con
datos y semántica de revisiones). Preparar los borradores en el cron (correría
sin los permisos ni las denegaciones de quien acepta). Dejar la ND como
borrador sin emitir: no existe un borrador de ND en el ERP. Medir el
crecimiento de la mora sin fotos históricas del aging. Una propuesta de
"recategorizar gasto": no hay un server action puntual que envolver.
