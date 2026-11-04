# 2026-11-03 — Guía del sidebar e impuestos como documento (6.5 + 6.6)

**Decisión (6.5).** Una sección "Guía" plegable al pie del sidebar
(`features/guide`): para la pantalla actual muestra qué es, los pasos
habituales y la sección del manual HTML (`docs/manual/<página>#<ancla>`)
que la cubre, citada por nombre porque el manual es un sitio estático que
la app no sirve. Debajo, el checklist de puesta en marcha: cuentas, puntos
de venta AFIP sincronizados, una corrida del importador, tarifas por
cliente, saldos iniciales, ajuste inicial (un asiento manual), más de un
usuario con rol, impuestos cargados. Cada ítem tiene el permiso de su
módulo (`userCanAll`), así una denegación por usuario lo oculta; se marca
hecho si hay al menos un registro (una lectura `limit 1` con el service
client, después del gate) o si el usuario lo marcó ("Ya está", deshacible).
El estado (plegado y marcados a mano) va en `user_guide_states`, una fila
por usuario con RLS propia, como `dashboard_layouts`; localStorage solo
evita el salto del primer render.

**Decisión (6.6).** Cada obligación es una fila de `tax_documents` (tipo,
título, jurisdicción, período, vencimiento, importe, estado, cuenta
contable, pago) con un estado pendiente → liquidado → pagado / anulado.
Pagar es un RPC propio (`pay_tax_document`) con el patrón de la cuota de
préstamo: un egreso en el canal fiscal desde una cuenta en pesos, dueño el
documento, re-asentado por `build_transaction_journal_lines` como Debe la
cuenta del impuesto (la deuda fiscal o el gasto, elegida en el documento) /
Haber caja o banco. El movimiento con dueño no se borra ni se edita desde
Caja, no lo adopta un préstamo (`transaction_is_loose`) y Caja lo marca
`tax_document`. Un pago con fecha en un período cerrado se rechaza con su
mensaje antes de postear. `guard_tax_document` deja un pagado con solo sus
notas editables, un anulado intocable y el estado pagado solo vía el RPC.
El IVA se estima en el servidor desde las acciones del libro IVA (débito −
crédito, NC restadas) menos las retenciones y percepciones de IVA sufridas
en recibos fiscales del período, y queda marcado como estimado. Las tareas
salen de `sync_automatic_tasks` (fuente `tax_documents`, 7 días antes), con
el techo de dinero de la RLS de tareas. Permisos nuevos `taxes:read`
(owner, admin, finance, fiscal_reader) y `taxes:write` (owner, admin,
finance): `accounting:*` no servía porque el contador lee contabilidad pero
no debe tocar pagos y finanzas paga sin ser contador.

**Por qué.** El arranque necesita saber qué falta cargar, y los impuestos
vivían en una planilla aparte: con fecha, importe y comprobante adentro del
ERP, vencen como tareas y el pago queda en caja y en el diario.

**Descartado.** Pagar con una orden de pago a un proveedor "ARCA" (asentaría
contra Proveedores, no contra la deuda fiscal, y obliga a un proveedor
ficticio); un asiento directo (salta el movimiento de caja y los guards de
movimientos con dueño); servir el manual HTML desde la app (CSP con nonce,
scripts y fuentes por CDN, empaquetado de `docs/`); calcular el vencimiento
por terminación de CUIT (cambia cada año por resolución: se carga y se copia
mes a mes); un catálogo configurable de tipos (alcanza "Otro" con nombre).
