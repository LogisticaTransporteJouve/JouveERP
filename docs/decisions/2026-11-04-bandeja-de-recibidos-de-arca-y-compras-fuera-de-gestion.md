# 2026-11-04 — Bandeja de Recibidos de ARCA y compras fuera de gestión

**Decisión.** Lo que ARCA lista en Mis Comprobantes → Recibidos entra a una
bandeja propia (`arca_received_vouchers`, `/purchases/arca`) y no a Compras:
una persona acepta cada comprobante (cuenta, centro de costo y reparto de
otros tributos) o lo descarta. Los importes y la identidad (CUIT, tipo,
número) vienen de ARCA y no se editan; el servidor los vuelve a controlar al
aceptar. Un comprobante que ya está cargado como compra fiscal (no anulada) se
vincula solo, al
subir el archivo o después, cuando alguien lo carga a mano. El archivo se sube
a mano por ahora; traerlo solo desde ARCA es el paso siguiente (robot,
pendiente de grabar el flujo de login). Reemplaza al script
`import:afip-purchases`, que cargaba todo sin revisión.

**Fuera de gestión.** Una compra que no es costo de la empresa se carga a una
cuenta de gasto que el dueño asigna a «Neutro (no suma)» en Gestión → cajas:
no suma ni en devengado ni en caja (la OP que la paga suma solo lo que pagó
de otras compras). No se crea esa cuenta sola: la elige el dueño.

**Por qué.** Cargar todo lo de ARCA sin mirar mete comprobantes que no son
costo y deja sin elegir cuenta, centro y reparto de tributos.

**Descartado.** Importar todo y corregir después (lo que hacía el script);
una marca «fuera de gestión» en cada compra (la cuenta ya lo dice y lo usan
los reportes).
