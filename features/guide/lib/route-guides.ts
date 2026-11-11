// Short help per screen (roadmap 6.5): what the page is for and the usual
// steps. The sidebar block that showed it is no longer mounted. The full guide of each screen is in the user guide
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
    prefix: "/ai/pinned",
    title: "Fijados de IA",
    summary:
      "Las tablas y gráficos que fijaste desde el asistente, recalculados con los datos de hoy.",
  },
  {
    prefix: "/ai/tasks",
    title: "Tareas IA",
    summary:
      "Pedidos que el asistente corre solo cada día, semana o mes, con tus permisos de lectura; cada corrida deja su resultado.",
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
      "Ficha de cada cliente con su cuenta corriente, datos fiscales y adjuntos.",
    steps: [
      "Buscá el CUIT en el padrón para completar los datos.",
      "El saldo inicial se carga desde la ficha.",
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
      "Los comprobantes que tus proveedores informaron a ARCA: aceptá cada uno para cargarlo como compra o descartalo. Los que no se pudieron leer o no se cargan solos se cargan a mano.",
  },
  {
    prefix: "/purchases",
    title: "Comprobantes",
    summary:
      "Facturas, notas de crédito y débito de proveedores con su IVA, percepciones y rubro. Del lado interno son remitos de compra.",
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
    prefix: "/accounts",
    title: "Cuentas",
    summary:
      "Cajas, bancos y billeteras con su moneda y su saldo. Cada cuenta abre sus movimientos y, en un banco, su extracto para conciliar. También se crean pidiéndoselo al asistente.",
    steps: [
      "Subí el extracto que bajaste del banco con Subir extracto (entra a la cuenta y el mes elegidos).",
      "Aceptá las sugerencias o elegí los movimientos a mano.",
      "Creá el movimiento que falta (comisiones, intereses) desde la línea.",
    ],
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
    prefix: "/card-statements",
    title: "Tarjetas",
    summary:
      "Los resúmenes de las tarjetas de crédito: cada consumo es un gasto de la empresa o un adelanto de sueldo.",
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
    prefix: "/accounting/settings",
    title: "Configuración contable",
    summary:
      "El mes en que empieza el ejercicio: lo usan el EERR, el balance general y el resultado de gestión.",
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
    summary:
      "Choferes con su licencia y documentación. La página de cada chofer muestra sus viajes y km por día.",
  },
  {
    prefix: "/vehicles",
    title: "Vehículos",
    summary:
      "Camiones, acoplados y semis con su documentación y tarjeta de combustible. La página de cada vehículo muestra sus km por día y quién lo manejó.",
  },
  {
    prefix: "/trips",
    title: "Viajes",
    summary: "Cada viaje con su fecha, estado, chofer, vehículo y sus cargas.",
  },
  {
    prefix: "/cargas",
    title: "Cargas",
    summary:
      "Las cargas a transportar: cliente, descripción, fecha programada y dirección.",
  },
  {
    prefix: "/fleet-tariffs",
    title: "Tarifas de flete",
    summary:
      "Los precios de flete por período, para seguir los aumentos; no los toman las cargas.",
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
    prefix: "/pallets/trazabilidad",
    title: "Trazabilidad de pallets",
    summary:
      "Cuándo entró y salió cada pallet y cuántos días estuvo almacenado. Solo de consulta.",
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
      "Invitá usuarios y asignales roles. El owner puede ocultarle módulos o denegarle acciones a un usuario.",
  },
  {
    prefix: "/admin/padron",
    title: "Padrón AFIP",
    summary: "Consultá los datos fiscales de un CUIT.",
  },
  {
    prefix: "/admin/afip/puntos-de-venta",
    title: "Puntos de venta",
    summary:
      "Los puntos de venta habilitados en ARCA y su canal, y la Conciliación con ARCA: en Ventas la numeración de cada punto de venta, en Compras lo recibido contra las compras fiscales por año y mes.",
  },
  {
    prefix: "/admin/accesos",
    title: "Accesos",
    summary:
      "Los usuarios con los que JouveERP entra a ARCA (Mis Comprobantes) y a Strix (km de la flota).",
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
    summary:
      "Quién hizo qué y cuándo, en frases. Buscá por cliente, proveedor, número de comprobante o patente y filtrá por fechas, usuario y tipo de tarea.",
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
