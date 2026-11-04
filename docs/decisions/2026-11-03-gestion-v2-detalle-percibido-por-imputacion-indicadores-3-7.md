# 2026-11-03 — Gestión v2: detalle, percibido por imputación, indicadores (3.7)

**Decisión.** El resultado de gestión se arma por documento en una sola
función (`management_pnl_lines`) que suman la cifra (`get_management_pnl`) y
su detalle (`get_management_pnl_documents`): lo que abre un número siempre
suma ese número. En **percibido**, un recibo o una orden de pago se reparte
según lo que imputó: la parte cobrada de ventas de bienes de uso va a "Venta
de bienes de uso", la pagada de compras con cuenta de flota a "Inversión en
flota" y la de compras a cargo de un empleado a "Anticipos al personal". El
adelanto y el pago del empleado también van a "Anticipos al personal" (antes
contaban como sueldos pagados): queda debajo del margen operativo y dentro
de la generación de caja, y el descuento de planilla o la condonación pasan
ese importe a sueldos internos de su mes, igual que en devengado. Una cuota
con desglose paga capital y el resto (interés, cargos, IVA y percepción) es
costo financiero. Indicadores: margen operativo %, resultado operativo
(EBITDA aprox.) y generación de caja contra los mismos meses del año
anterior. La tabla mes a mes se exporta a CSV/Excel con la leyenda "Uso
interno", armada en el navegador y auditada; no entra en el paquete del
contador.

**Descartado.** Repartir lo cobrado o pagado a cuenta (no se sabe a qué va
hasta imputarlo); armar la exportación en una ruta de `/api/export` (es la
misma tabla que ya está en pantalla); margen por camión con los datos de hoy
(los costos no llevan el camión: queda pendiente).
