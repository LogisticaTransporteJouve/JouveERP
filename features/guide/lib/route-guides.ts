// Short help per screen for the sidebar guide (roadmap 6.5): what the page is
// for and the usual steps. The full guide of each screen is in the user guide
// (features/guide/manual), linked through /manual/para?ruta=<path>.

export type RouteGuide = {
  /** The route and everything under it ("/invoices" covers "/invoices/123"). */
  prefix: string;
  title: string;
  summary: string;
  steps?: readonly string[];
};

export const ROUTE_GUIDES: readonly RouteGuide[] = [
  {
    prefix: "/dashboard",
    title: "Dashboard",
    summary:
      "Lo que vence hoy y esta semana y los indicadores del mes. Cada usuario elige qué tarjetas ve.",
  },
  {
    prefix: "/tasks",
    title: "Tareas",
    summary:
      "Pendientes del equipo: manuales, recurrentes y automáticas que salen de los documentos por pagar, cobrar o renovar.",
    steps: [
      "Las automáticas se crean y se cierran solas cada mañana.",
      "Reasigná, mové el vencimiento o marcá hecha desde el detalle.",
    ],
  },
  {
    prefix: "/files",
    title: "Archivos",
    summary:
      "Todos los adjuntos del sistema en un lugar, filtrados por lo que podés ver.",
  },
  {
    prefix: "/chat",
    title: "Chat",
    summary: "Mensajes directos y grupos del equipo.",
  },
  {
    prefix: "/ai",
    title: "Asistente",
    summary:
      "Preguntale al asistente por ventas, cobranzas, costos o caja: responde con los datos que tu usuario puede ver.",
  },
  {
    prefix: "/documentos",
    title: "Documentos",
    summary:
      "Subí una factura o un recibo escaneado: se lee solo y podés crear el comprobante desde ahí.",
  },
  {
    prefix: "/clients",
    title: "Clientes",
    summary:
      "Ficha de cada cliente con su cuenta corriente, datos fiscales, tarifario y adjuntos.",
    steps: [
      "Buscá el CUIT en el padrón para completar los datos.",
      "El saldo inicial y el tarifario se cargan desde la ficha.",
    ],
  },
  {
    prefix: "/invoices",
    title: "Comprobantes",
    summary:
      "Facturas, notas de crédito y débito. Del lado fiscal se emiten con CAE de AFIP; del interno son remitos.",
    steps: [
      "Nuevo comprobante → cliente, ítems y punto de venta.",
      "Del lado fiscal, al guardar se pide el CAE; si AFIP rechaza, corregí la causa y emití uno nuevo.",
    ],
  },
  {
    prefix: "/receipts",
    title: "Recibos",
    summary:
      "Cobranzas: cada recibo junta los medios de pago, las retenciones sufridas y a qué comprobantes se imputa.",
  },
  {
    prefix: "/aging",
    title: "Aging clientes",
    summary:
      "Deuda de cada cliente por antigüedad, con lo cobrado a cuenta aparte.",
  },
  {
    prefix: "/aging/mora",
    title: "Intereses por mora",
    summary:
      "Comprobantes vencidos con el interés por mora calculado a una fecha, para cobrarlo con una nota de débito.",
    steps: [
      "Definí la tasa general mensual, o la de un cliente si tiene otra.",
      "Elegí hasta qué fecha calcular el interés.",
      "Generar ND emite la nota de débito de un comprobante; Generar varias ND, la de varios a la vez.",
    ],
  },
  {
    prefix: "/suppliers",
    title: "Proveedores",
    summary:
      "Ficha de cada proveedor con su cuenta corriente, categoría y adjuntos.",
  },
  {
    prefix: "/suppliers/categories",
    title: "Categorías de proveedores",
    summary:
      "Agrupan a los proveedores para los reportes y el rubro por defecto.",
  },
  {
    prefix: "/purchases/arca",
    title: "Recibidos de ARCA",
    summary:
      "Los comprobantes que tus proveedores informaron a ARCA: aceptá cada uno para cargarlo como compra o descartalo.",
  },
  {
    prefix: "/purchases",
    title: "Compras",
    summary:
      "Facturas de proveedores con su IVA, percepciones, rubro y centro de costo. Del lado interno son remitos de compra.",
  },
  {
    prefix: "/payment-orders",
    title: "Órdenes de pago",
    summary:
      "Pagos a proveedores: medios de pago, cheques propios y a qué facturas se imputa.",
  },
  {
    prefix: "/aging-suppliers",
    title: "Aging proveedores",
    summary: "Lo que se debe a cada proveedor por antigüedad.",
  },
  {
    prefix: "/treasury",
    title: "Tesorería",
    summary:
      "Saldos de todas las cuentas y accesos rápidos para cobrar a un cliente o pagar a un proveedor.",
  },
  {
    prefix: "/treasury/cash-flow",
    title: "Flujo de caja",
    summary:
      "Proyección de cobros y pagos por mes: aging, cheques, préstamos y pagos recurrentes.",
  },
  {
    prefix: "/treasury/reconciliation",
    title: "Conciliación bancaria",
    summary:
      "Por cuenta y mes: cada línea del extracto contra los movimientos de caja.",
    steps: [
      "Importá el extracto con el importador (tipo Extracto bancario).",
      "Aceptá las sugerencias o elegí los movimientos a mano.",
      "Creá el movimiento que falta (comisiones, intereses) desde la línea.",
    ],
  },
  {
    prefix: "/accounts",
    title: "Cuentas",
    summary: "Cajas, bancos y billeteras con su moneda y su saldo inicial.",
  },
  {
    prefix: "/transactions",
    title: "Caja",
    summary:
      "Todos los movimientos de las cuentas. Los generados por un documento (recibo, orden de pago, préstamo, impuesto) se editan desde su documento.",
  },
  {
    prefix: "/checks",
    title: "Cheques recibidos",
    summary:
      "La cartera de cheques de terceros: depositar, endosar, vender o rechazar.",
  },
  {
    prefix: "/issued-checks",
    title: "Cheques propios",
    summary: "Los cheques emitidos y cuándo se debitan.",
  },
  {
    prefix: "/recurring-payments",
    title: "Pagos recurrentes",
    summary:
      "Alquileres, servicios y otros pagos fijos: entran en el flujo de caja proyectado.",
  },
  {
    prefix: "/loans",
    title: "Préstamos",
    summary:
      "Préstamos y leasing con sus cuotas. Pagar una cuota registra el egreso y su asiento.",
  },
  {
    prefix: "/accounting/package",
    title: "Paquete del mes",
    summary:
      "Todo lo que el contador necesita del mes, para descargar de una vez.",
  },
  {
    prefix: "/accounting/chart",
    title: "Plan de cuentas",
    summary:
      "Las cuentas contables y su jerarquía. Los asientos usan solo cuentas hoja.",
  },
  {
    prefix: "/accounting/journal",
    title: "Libro diario",
    summary:
      "Los asientos que generan los documentos y los manuales (como el ajuste inicial).",
  },
  {
    prefix: "/accounting/libro-mayor",
    title: "Libro mayor",
    summary: "Movimientos y saldo de una cuenta contable.",
  },
  {
    prefix: "/accounting/libro-iva-ventas",
    title: "Libro IVA Ventas",
    summary:
      "Comprobantes fiscales del período por alícuota, con export para ARCA.",
  },
  {
    prefix: "/accounting/libro-iva-compras",
    title: "Libro IVA Compras",
    summary: "Compras fiscales del período por alícuota, con export para ARCA.",
  },
  {
    prefix: "/accounting/balance",
    title: "Balance / EERR",
    summary:
      "Balance de sumas y saldos y estado de resultados desde los asientos.",
  },
  {
    prefix: "/management",
    title: "Resultado de gestión",
    summary:
      "El resultado para el dueño, devengado o percibido, fiscal e interno juntos. No es el EERR.",
  },
  {
    prefix: "/accounting/cost-centers",
    title: "Centros de costo",
    summary: "Para ver costos por camión, depósito o área.",
  },
  {
    prefix: "/accounting/inflation",
    title: "Ajuste por inflación",
    summary: "Índices y el asiento RECPAM del ejercicio.",
  },
  {
    prefix: "/accounting/exchange-rates",
    title: "Cotización USD",
    summary: "El dólar oficial de cada día; se baja solo del BCRA.",
  },
  {
    prefix: "/taxes",
    title: "Impuestos",
    summary:
      "Cada obligación (IVA, IIBB, Ganancias, SICORE, F931…) es un documento con período, vencimiento, importe y estado.",
    steps: [
      "“Preparar el mes” copia los impuestos del mes anterior.",
      "En IVA, “Estimar” calcula el importe desde el libro IVA.",
      "Adjuntá el VEP o la DDJJ y marcalo liquidado.",
      "“Pagar” registra el egreso en caja y su asiento.",
    ],
  },
  {
    prefix: "/drivers",
    title: "Choferes",
    summary: "Choferes con su licencia y documentación.",
  },
  {
    prefix: "/vehicles",
    title: "Vehículos",
    summary:
      "Camiones, acoplados y semis con su documentación y tarjeta de combustible.",
  },
  {
    prefix: "/trips",
    title: "Viajes",
    summary:
      "Cada viaje con su chofer, vehículo, km, sus cargas y el ingreso manual si no tiene cargas facturadas.",
  },
  {
    prefix: "/cargas",
    title: "Cargas",
    summary: "Las cargas transportadas y su remito.",
  },
  {
    prefix: "/liquidaciones",
    title: "Liquidaciones",
    summary:
      "Liquidación de los fletes de cada cliente; lo de los choferes está en Rendiciones.",
  },
  {
    prefix: "/fleet-tariffs",
    title: "Tarifas de flete",
    summary:
      "Los precios de flete por período, para seguir los aumentos; no los toman las cargas.",
  },
  {
    prefix: "/rendiciones",
    title: "Rendiciones",
    summary: "Lo que cada chofer cobró contra entrega y rindió.",
  },
  {
    prefix: "/fuel",
    title: "Combustible",
    summary:
      "Cargas de combustible por vehículo; se importan los resúmenes de tarjeta.",
  },
  {
    prefix: "/vehicle-km",
    title: "Km recorridos",
    summary:
      "Los km de cada vehículo según Strix (GPS), por día y por rango de fechas.",
  },
  {
    prefix: "/maintenance",
    title: "Mantenimiento",
    summary: "Services y reparaciones de cada vehículo.",
  },
  {
    prefix: "/fleet-documents",
    title: "Vencimientos de flota",
    summary:
      "VTV, seguros y habilitaciones por vencer; generan tareas automáticas.",
  },
  {
    prefix: "/fleet-reports",
    title: "Rentabilidad",
    summary:
      "Ingreso y costo por vehículo y por viaje; el ingreso sale del flete facturado de las cargas.",
  },
  {
    prefix: "/warehouses",
    title: "Depósitos",
    summary: "Depósitos y sus áreas.",
  },
  {
    prefix: "/products",
    title: "Productos",
    summary: "Los productos que se guardan en los depósitos.",
  },
  {
    prefix: "/pallets",
    title: "Pallets",
    summary: "Ingresos, egresos, ubicación y bloqueo de pallets.",
  },
  {
    prefix: "/storage-tariffs",
    title: "Tarifas de depósito",
    summary: "Tarifas de almacenaje con su historial de aumentos.",
  },
  {
    prefix: "/storage-billing",
    title: "Facturación de depósito",
    summary: "La facturación mensual del almacenaje de cada cliente.",
  },
  {
    prefix: "/employees",
    title: "Empleados",
    summary:
      "Legajo, sueldo, documentación y cuenta corriente de cada empleado.",
  },
  {
    prefix: "/hr/payroll",
    title: "Sueldos",
    summary: "La planilla de cada mes y sus pagos.",
  },
  {
    prefix: "/hr/vacations",
    title: "Vacaciones",
    summary: "Días que corresponden por ley (LCT) y los tomados.",
  },
  {
    prefix: "/hr/attendance",
    title: "Asistencia",
    summary: "Presentismo y licencias del mes.",
  },
  {
    prefix: "/hr/document-expirations",
    title: "Vencimientos de personal",
    summary: "Licencias y documentación de empleados por vencer.",
  },
  {
    prefix: "/admin/users",
    title: "Usuarios",
    summary:
      "Invitá usuarios y asignales roles. El owner puede ocultarle módulos a un usuario.",
  },
  {
    prefix: "/admin/padron",
    title: "Padrón AFIP",
    summary: "Consultá los datos fiscales de un CUIT.",
  },
  {
    prefix: "/admin/afip/puntos-de-venta",
    title: "Puntos de venta",
    summary: "Los puntos de venta habilitados en ARCA y su canal.",
  },
  {
    prefix: "/admin/afip/preview-pdf",
    title: "Preview PDF",
    summary: "Cómo sale el PDF de un comprobante, sin emitirlo.",
  },
  {
    prefix: "/admin/imports",
    title: "Importador",
    summary:
      "Cargá planillas de clientes, proveedores, empleados, vehículos, tarifas, préstamos, cheques, saldos y extractos. Cada corrida se puede deshacer mientras nada la use.",
    steps: [
      "Elegí el tipo, subí la planilla y asigná las columnas.",
      "Revisá la vista previa: errores y avisos por fila.",
      "Importá: entra todo en una sola transacción.",
    ],
  },
  {
    prefix: "/admin/audit",
    title: "Auditoría",
    summary: "Quién hizo qué y cuándo.",
  },
  {
    prefix: "/admin/backups",
    title: "Backups",
    summary: "Estado de las copias de seguridad.",
  },
  {
    prefix: "/profile",
    title: "Perfil",
    summary: "Tu nombre, avatar y avisos.",
  },
];

/** The deepest guide whose prefix is the path or one of its ancestors. */
export function guideForPath(pathname: string): RouteGuide | undefined {
  let best: RouteGuide | undefined;
  for (const guide of ROUTE_GUIDES) {
    const matches =
      pathname === guide.prefix || pathname.startsWith(`${guide.prefix}/`);
    if (matches && (!best || guide.prefix.length > best.prefix.length)) {
      best = guide;
    }
  }
  return best;
}
